import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireBusinessActor } from "@/lib/business-actor";
import { getCommandRole } from "@/lib/command-access";
import { getSql, type SqlRow } from "@/lib/db";
import { canPerform } from "@/lib/page-access";
import { getRouteMeta } from "@/lib/page-metadata";

const route = "/command/finance-control";
const id = z.string().trim().min(1).max(160);
const reference = z.string().trim().min(1).max(500);
const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const money = z.number().finite().min(-1_000_000_000_000).max(1_000_000_000_000);

async function requireView() {
  const role = await getCommandRole();
  if (!role || !canPerform(role, "view", getRouteMeta(route))) {
    throw new Error("Cash reconciliation view permission denied.");
  }
}

async function requireActor(permission: "edit" | "approve") {
  const actor = await requireBusinessActor(permission);
  if (!canPerform(actor.role, permission, getRouteMeta(route))) {
    throw new Error(`Cash reconciliation ${permission} permission denied.`);
  }
  return actor;
}

export const getCashReconciliationTruth = createServerFn({ method: "GET" }).handler(async () => {
  await requireView();
  const sql = await getSql();
  return sql.query<SqlRow>(`
    select r.id,r.bank_account_ref,r.period,r.plan_month,r.opening_balance_inr,r.closing_balance_inr,
           r.statement_movement_inr,r.book_movement_inr,r.book_closing_balance_inr,r.difference_inr,
           r.status,r.evidence_reference,r.prepared_by,r.prepared_at::text as prepared_at,
           r.approved_by,r.approved_at::text as approved_at,
           case when a.verified=true and a.closing_cash is not null then round(a.closing_cash*100000,2) else null end as canonical_closing_cash_inr,
           case when r.book_closing_balance_inr is null then null else round(r.closing_balance_inr-r.book_closing_balance_inr,2) end as statement_gl_difference_inr,
           case when a.verified=true and a.closing_cash is not null then round(r.closing_balance_inr-a.closing_cash*100000,2) else null end as statement_canonical_difference_inr
      from epr_finance_bank_reconciliation_sessions r
      left join vyndi_monthly_actuals a on a.plan_month=r.plan_month
     order by r.period desc,r.prepared_at desc
     limit 100`);
});

export const prepareCashReconciliation = createServerFn({ method: "POST" })
  .validator(z.object({
    id,
    bankAccountRef: id,
    period,
    planMonth: z.number().int().min(1).max(36),
    openingBalanceInr: money,
    closingBalanceInr: money,
    evidenceReference: reference,
  }))
  .handler(async ({ data }) => {
    const actor = await requireActor("edit");
    const sql = await getSql();

    const [prior] = await sql.query<Record<string, unknown>>(
      `select period,closing_balance_inr
         from epr_finance_bank_reconciliation_sessions
        where bank_account_ref=$1 and period<$2 and status='reconciled' and approved_by is not null
        order by period desc,approved_at desc limit 1`,
      [data.bankAccountRef, data.period],
    );
    if (prior && Math.abs(Number(prior.closing_balance_inr)-data.openingBalanceInr)>0.01) {
      throw new Error(`Opening balance does not continue the latest approved reconciliation (${String(prior.period)} closing ${Number(prior.closing_balance_inr).toFixed(2)}).`);
    }

    const [summary] = await sql.query<Record<string, unknown>>(
      `select coalesce(sum(amount_inr),0)::numeric(18,2) as statement_movement,
              count(*) filter(where matched_journal_id is null)::int as unmatched,
              count(*)::int as line_count
         from epr_finance_bank_statement_lines
        where bank_account_ref=$1 and to_char(statement_date,'YYYY-MM')=$2`,
      [data.bankAccountRef, data.period],
    );
    const lineCount = Number(summary?.line_count ?? 0);
    const unmatched = Number(summary?.unmatched ?? 0);
    const statementMovement = Number(summary?.statement_movement ?? 0);
    if (unmatched > 0) throw new Error(`${unmatched} bank statement line(s) remain unmatched for ${data.period}.`);
    if (lineCount === 0 && Math.abs(data.openingBalanceInr-data.closingBalanceInr)>0.01) {
      throw new Error("A zero-activity bank period requires identical opening and closing balances.");
    }
    const expectedClosing = data.openingBalanceInr + statementMovement;
    if (Math.abs(expectedClosing-data.closingBalanceInr)>0.01) {
      throw new Error(`Statement arithmetic does not close. Expected ${expectedClosing.toFixed(2)}, supplied ${data.closingBalanceInr.toFixed(2)}.`);
    }

    const [book] = await sql.query<Record<string, unknown>>(
      `select coalesce(sum(l.debit_inr-l.credit_inr),0)::numeric(18,2) as book_movement,
              count(distinct j.id) filter(where not exists(
                select 1 from epr_finance_bank_statement_lines b
                 where b.bank_account_ref=$1 and to_char(b.statement_date,'YYYY-MM')=$2 and b.matched_journal_id=j.id
              ))::int as unmatched_book_journals
         from epr_finance_journal_lines l join epr_finance_journals j on j.id=l.journal_id
        where l.account_code='1000' and j.status='posted' and to_char(j.entry_date,'YYYY-MM')=$2`,
      [data.bankAccountRef, data.period],
    );
    const unmatchedBook = Number(book?.unmatched_book_journals ?? 0);
    if (unmatchedBook > 0) throw new Error(`${unmatchedBook} posted Bank journal(s) are not represented by matched statement lines for ${data.period}.`);
    const bookMovement = Number(book?.book_movement ?? 0);
    const movementDifference = Math.round((statementMovement-bookMovement)*100)/100;
    if (Math.abs(movementDifference)>0.01) {
      throw new Error(`Bank statement movement differs from Bank-GL movement by ${movementDifference.toFixed(2)}.`);
    }
    const bookClosing = Math.round((data.openingBalanceInr+bookMovement)*100)/100;
    if (Math.abs(bookClosing-data.closingBalanceInr)>0.01) {
      throw new Error(`Bank GL closing balance ${bookClosing.toFixed(2)} does not equal statement closing balance ${data.closingBalanceInr.toFixed(2)}.`);
    }

    await sql.query(
      `insert into epr_finance_bank_reconciliation_sessions(
         id,bank_account_ref,period,plan_month,opening_balance_inr,closing_balance_inr,
         statement_movement_inr,book_movement_inr,book_closing_balance_inr,difference_inr,
         status,evidence_reference,prepared_by)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'reconciled',$11,$12)
       on conflict(bank_account_ref,period,status) do update set
         id=excluded.id,plan_month=excluded.plan_month,opening_balance_inr=excluded.opening_balance_inr,
         closing_balance_inr=excluded.closing_balance_inr,statement_movement_inr=excluded.statement_movement_inr,
         book_movement_inr=excluded.book_movement_inr,book_closing_balance_inr=excluded.book_closing_balance_inr,
         difference_inr=excluded.difference_inr,evidence_reference=excluded.evidence_reference,
         prepared_by=excluded.prepared_by,prepared_at=now(),approved_by=null,approved_at=null`,
      [
        data.id,data.bankAccountRef,data.period,data.planMonth,data.openingBalanceInr,data.closingBalanceInr,
        statementMovement,bookMovement,bookClosing,movementDifference,data.evidenceReference,actor.userId,
      ],
    );
    return { ok: true, differenceInr: movementDifference, bookClosingBalanceInr: bookClosing, planMonth: data.planMonth };
  });

export const approveCashReconciliation = createServerFn({ method: "POST" })
  .validator(z.object({ id, evidenceReference: reference }))
  .handler(async ({ data }) => {
    const actor = await requireActor("approve");
    const sql = await getSql();
    const [row] = await sql.query<Record<string, unknown>>(
      `select id,period,plan_month,closing_balance_inr,book_closing_balance_inr,prepared_by
         from epr_finance_bank_reconciliation_sessions
        where id=$1 and status='reconciled' for update`,
      [data.id],
    );
    if (!row) throw new Error("Reconciled bank session not found.");
    if (String(row.prepared_by) === actor.userId) throw new Error("Bank reconciliation approval requires a different authorised user.");
    const planMonth = Number(row.plan_month ?? 0);
    if (!Number.isInteger(planMonth) || planMonth < 1 || planMonth > 36) {
      throw new Error("Bank reconciliation has no explicit governed VIBPE plan-month mapping.");
    }
    const statementClosing = Number(row.closing_balance_inr ?? 0);
    const bookClosing = Number(row.book_closing_balance_inr ?? NaN);
    if (!Number.isFinite(bookClosing) || Math.abs(statementClosing-bookClosing)>0.01) {
      throw new Error("Statement closing balance does not reconcile to Bank GL closing balance.");
    }
    const [actual] = await sql.query<Record<string, unknown>>(
      `select closing_cash,verified from vyndi_monthly_actuals
        where plan_month=$1 and verified=true and closing_cash is not null`,
      [planMonth],
    );
    if (!actual) throw new Error(`M${planMonth} has no verified canonical closing-cash evidence.`);
    const canonicalCashInr = Number(actual.closing_cash)*100000;
    if (Math.abs(statementClosing-canonicalCashInr)>0.01) {
      throw new Error(`Bank closing ${statementClosing.toFixed(2)} does not equal M${planMonth} canonical cash ${canonicalCashInr.toFixed(2)}.`);
    }
    const [otherPeriod] = await sql.query<Record<string, unknown>>(
      `select id from epr_finance_bank_reconciliation_sessions
        where period=$1 and status='reconciled' and approved_by is not null and id<>$2 limit 1`,
      [String(row.period), data.id],
    );
    if (otherPeriod) throw new Error(`Period ${String(row.period)} already has another approved bank reconciliation.`);
    const [otherMonth] = await sql.query<Record<string, unknown>>(
      `select id,period from epr_finance_bank_reconciliation_sessions
        where plan_month=$1 and status='reconciled' and approved_by is not null and id<>$2 limit 1`,
      [planMonth, data.id],
    );
    if (otherMonth) throw new Error(`M${planMonth} is already mapped to approved reconciliation ${String(otherMonth.id)} for ${String(otherMonth.period)}.`);

    const rows = await sql.query<SqlRow>(
      `update epr_finance_bank_reconciliation_sessions
          set approved_by=$2,approved_at=now(),evidence_reference=$3
        where id=$1 and status='reconciled' returning id`,
      [data.id,actor.userId,data.evidenceReference],
    );
    if (!rows[0]) throw new Error("Reconciled bank session not found.");
    return { ok: true, id: data.id, planMonth, canonicalCashInr };
  });
