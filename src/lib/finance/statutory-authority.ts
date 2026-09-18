import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireBusinessActor } from "@/lib/business-actor";
import { getCommandRole } from "@/lib/command-access";
import { getSql, type SqlRow } from "@/lib/db";
import { canPerform } from "@/lib/page-access";
import { getRouteMeta } from "@/lib/page-metadata";

const permissionRoute = "/command/finance-control";
const id = z.string().trim().min(1).max(160);
const reference = z.string().trim().min(1).max(500);
const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const money = z.number().finite().min(-1_000_000_000_000).max(1_000_000_000_000);
const gstin = z.string().trim().toUpperCase().regex(/^[0-9A-Z]{15}$/);
const stateCode = z.string().trim().regex(/^[0-9]{2}$/);

async function requireView() {
  const role = await getCommandRole();
  if (!role || !canPerform(role, "view", getRouteMeta(permissionRoute))) {
    throw new Error("Statutory finance view permission denied.");
  }
}

async function requireEdit() {
  const actor = await requireBusinessActor("edit");
  if (!canPerform(actor.role, "edit", getRouteMeta(permissionRoute))) {
    throw new Error("Statutory finance edit permission denied.");
  }
  return actor;
}

async function requireApprove() {
  const actor = await requireBusinessActor("approve");
  if (!canPerform(actor.role, "approve", getRouteMeta(permissionRoute))) {
    throw new Error("Statutory finance approval permission denied.");
  }
  return actor;
}

async function periodBlockers(periodValue: string) {
  const sql = await getSql();
  const [row] = await sql.query<Record<string, unknown>>(
    `select
       (select count(*) from epr_finance_bank_statement_lines
          where to_char(statement_date,'YYYY-MM')=$1 and matched_journal_id is null)::int as unmatched_bank,
       (select count(*) from epr_finance_gst_ledger
          where period=$1 and status='active' and gst_inr>0 and trim(coalesce(evidence_reference,''))='')::int as gst_evidence,
       (select count(*) from epr_finance_gst_ledger
          where period=$1 and direction='input' and status='active' and gst_inr>0 and eligible_itc is null)::int as unverified_input_itc,
       (select count(*) from vyndi_supplier_invoices
          where to_char(invoice_on,'YYYY-MM')=$1 and status<>'void' and gst_inr>0 and itc_control_status='pending')::int as pending_supplier_itc,
       (select count(*) from vyndi_invoices
          where status='issued' and to_char(issued_at,'YYYY-MM')=$1 and tax_profile_status<>'complete')::int as invoice_tax,
       (select count(*) from vyndi_invoices
          where status='issued' and to_char(issued_at,'YYYY-MM')=$1 and e_invoice_required=true and trim(coalesce(irn,''))='')::int as irn,
       (select count(*) from epr_finance_payroll_controls
          where period=$1 and (trim(coalesce(payment_reference,''))='' or
            (statutory_payable_inr>0 and trim(coalesce(return_evidence_reference,''))='')))::int as payroll,
       (select count(*) from epr_finance_posting_exceptions where resolved=false)::int as posting,
       (select count(*) from epr_finance_fixed_assets
          where status<>'disposed' and trim(coalesce(source_reference,''))='')::int as assets,
       abs(coalesce((select sum(l.debit_inr-l.credit_inr)
          from epr_finance_journal_lines l join epr_finance_journals j on j.id=l.journal_id
         where j.status='posted' and to_char(j.entry_date,'YYYY-MM')=$1),0))::numeric(18,2) as tb_difference,
       (select count(*) from epr_finance_bank_reconciliation_sessions
          where period=$1 and status='reconciled' and approved_by is not null)::int as approved_bank_reconciliations,
       (select count(*) from epr_inventory_stocktakes
          where period=$1 and status='posted')::int as posted_stocktakes,
       (select count(*) from epr_inventory_stocktakes
          where period=$1 and status in ('draft','submitted','approved'))::int as open_stocktakes`,
    [periodValue],
  );
  const values = row ?? {};
  const blockers = {
    unmatchedBank: Number(values.unmatched_bank ?? 0),
    gstEvidence: Number(values.gst_evidence ?? 0),
    unverifiedInputItc: Number(values.unverified_input_itc ?? 0),
    pendingSupplierItc: Number(values.pending_supplier_itc ?? 0),
    invoiceTax: Number(values.invoice_tax ?? 0),
    missingIrn: Number(values.irn ?? 0),
    payrollEvidence: Number(values.payroll ?? 0),
    postingExceptions: Number(values.posting ?? 0),
    assetEvidence: Number(values.assets ?? 0),
    trialBalanceDifferenceInr: Number(values.tb_difference ?? 0),
    approvedBankReconciliations: Number(values.approved_bank_reconciliations ?? 0),
    postedStocktakes: Number(values.posted_stocktakes ?? 0),
    openStocktakes: Number(values.open_stocktakes ?? 0),
  };
  const blockerCount = blockers.unmatchedBank + blockers.gstEvidence + blockers.unverifiedInputItc +
    blockers.pendingSupplierItc + blockers.invoiceTax + blockers.missingIrn + blockers.payrollEvidence +
    blockers.postingExceptions + blockers.assetEvidence + blockers.openStocktakes +
    (Math.abs(blockers.trialBalanceDifferenceInr) > 0.01 ? 1 : 0) +
    (blockers.approvedBankReconciliations > 0 ? 0 : 1) +
    (blockers.postedStocktakes > 0 ? 0 : 1);
  return { blockers, blockerCount };
}

export const getStatutoryFinanceControl = createServerFn({ method: "GET" }).handler(async () => {
  await requireView();
  const sql = await getSql();
  const [registration, readiness, gstSummary, closures, bankSessions, packs, stocktakes] = await Promise.all([
    sql.query<SqlRow>(`select * from epr_finance_tax_registration where id='PRIMARY'`),
    sql.query<SqlRow>(`select * from epr_finance_ca_readiness`),
    sql.query<SqlRow>(`select * from epr_finance_gst_period_summary limit 36`),
    sql.query<SqlRow>(`select period,status,evidence_reference,updated_by,updated_at::text as updated_at from epr_finance_period_closures order by period desc limit 36`),
    sql.query<SqlRow>(`select id,bank_account_ref,period,opening_balance_inr,closing_balance_inr,statement_movement_inr,book_movement_inr,difference_inr,status,evidence_reference,prepared_by,prepared_at::text as prepared_at,approved_by,approved_at::text as approved_at from epr_finance_bank_reconciliation_sessions order by period desc,prepared_at desc limit 100`),
    sql.query<SqlRow>(`select id,period,status,blocker_count,summary_json,evidence_reference,generated_by,generated_at::text as generated_at,approved_by,approved_at::text as approved_at from epr_finance_ca_evidence_packs order by period desc,generated_at desc limit 100`),
    sql.query<SqlRow>(`select id,period,status,effective_on::text as effective_on,evidence_reference,prepared_by,approved_by,posted_by,posted_at::text as posted_at,variance_line_count,gain_value_inr,loss_value_inr,finance_journal_id from epr_inventory_stocktakes order by period desc,prepared_at desc limit 36`),
  ]);
  return { registration: registration[0] ?? null, readiness: readiness[0] ?? {}, gstSummary, closures, bankSessions, packs, stocktakes };
});

export const saveTaxRegistration = createServerFn({ method: "POST" })
  .validator(z.object({
    legalName: z.string().trim().min(2).max(250), tradeName: z.string().trim().max(250).optional(), gstin,
    registeredAddress: z.string().trim().min(5).max(1000), stateCode,
    pan: z.string().trim().toUpperCase().max(20).optional(),
    aatoInr: z.number().finite().min(0).max(100_000_000_000_000).optional(),
    eInvoiceApplicable: z.boolean(), effectiveFrom: z.string().date(), sourceReference: reference,
  }))
  .handler(async ({ data }) => {
    const actor = await requireApprove();
    if (!data.gstin.startsWith(data.stateCode)) throw new Error("GSTIN State code does not match the controlled registration State code.");
    const sql = await getSql();
    await sql.query(
      `insert into epr_finance_tax_registration(id,legal_name,trade_name,gstin,registered_address,state_code,pan,aato_inr,e_invoice_applicable,effective_from,source_reference,updated_by,updated_at)
       values('PRIMARY',$1,$2,$3,$4,$5,$6,$7,$8,$9::date,$10,$11,now())
       on conflict(id) do update set legal_name=excluded.legal_name,trade_name=excluded.trade_name,gstin=excluded.gstin,registered_address=excluded.registered_address,state_code=excluded.state_code,pan=excluded.pan,aato_inr=excluded.aato_inr,e_invoice_applicable=excluded.e_invoice_applicable,effective_from=excluded.effective_from,source_reference=excluded.source_reference,updated_by=excluded.updated_by,updated_at=now()`,
      [data.legalName,data.tradeName ?? null,data.gstin,data.registeredAddress,data.stateCode,data.pan ?? null,data.aatoInr ?? null,data.eInvoiceApplicable,data.effectiveFrom,data.sourceReference,actor.userId],
    );
    return { ok: true };
  });

export const closeBankReconciliation = createServerFn({ method: "POST" })
  .validator(z.object({ id, bankAccountRef: id, period, openingBalanceInr: money, closingBalanceInr: money, evidenceReference: reference }))
  .handler(async ({ data }) => {
    const actor = await requireEdit();
    const sql = await getSql();
    const [summary] = await sql.query<Record<string, unknown>>(
      `select coalesce(sum(amount_inr),0)::numeric(18,2) as statement_movement,
              count(*) filter(where matched_journal_id is null)::int as unmatched,
              count(*)::int as line_count
         from epr_finance_bank_statement_lines
        where bank_account_ref=$1 and to_char(statement_date,'YYYY-MM')=$2`, [data.bankAccountRef,data.period],
    );
    const lineCount = Number(summary?.line_count ?? 0);
    const unmatched = Number(summary?.unmatched ?? 0);
    const statementMovement = Number(summary?.statement_movement ?? 0);
    if (unmatched > 0) throw new Error(`${unmatched} bank statement line(s) remain unmatched for ${data.period}.`);
    if (lineCount === 0 && Math.abs(data.openingBalanceInr-data.closingBalanceInr) > 0.01) {
      throw new Error("A zero-activity bank period requires identical opening and closing balances.");
    }
    const expectedClosing = data.openingBalanceInr + statementMovement;
    if (Math.abs(expectedClosing-data.closingBalanceInr) > 0.01) {
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
      [data.bankAccountRef,data.period],
    );
    const unmatchedBook = Number(book?.unmatched_book_journals ?? 0);
    if (unmatchedBook > 0) throw new Error(`${unmatchedBook} posted Bank journal(s) are not represented by matched statement lines for ${data.period}.`);
    const bookMovement = Number(book?.book_movement ?? 0);
    const difference = Math.round((statementMovement-bookMovement)*100)/100;
    if (Math.abs(difference)>0.01) throw new Error(`Bank statement movement differs from Bank-GL movement by ${difference.toFixed(2)}.`);
    await sql.query(
      `insert into epr_finance_bank_reconciliation_sessions(id,bank_account_ref,period,opening_balance_inr,closing_balance_inr,statement_movement_inr,book_movement_inr,difference_inr,status,evidence_reference,prepared_by)
       values($1,$2,$3,$4,$5,$6,$7,$8,'reconciled',$9,$10)
       on conflict(bank_account_ref,period,status) do update set id=excluded.id,opening_balance_inr=excluded.opening_balance_inr,closing_balance_inr=excluded.closing_balance_inr,statement_movement_inr=excluded.statement_movement_inr,book_movement_inr=excluded.book_movement_inr,difference_inr=excluded.difference_inr,evidence_reference=excluded.evidence_reference,prepared_by=excluded.prepared_by,prepared_at=now(),approved_by=null,approved_at=null`,
      [data.id,data.bankAccountRef,data.period,data.openingBalanceInr,data.closingBalanceInr,statementMovement,bookMovement,difference,data.evidenceReference,actor.userId],
    );
    return { ok: true, differenceInr: difference };
  });

export const approveBankReconciliation = createServerFn({ method: "POST" })
  .validator(z.object({ id, evidenceReference: reference }))
  .handler(async ({ data }) => {
    const actor = await requireApprove();
    const sql = await getSql();
    const rows = await sql.query<SqlRow>(`update epr_finance_bank_reconciliation_sessions set approved_by=$2,approved_at=now(),evidence_reference=$3 where id=$1 and status='reconciled' returning id`,[data.id,actor.userId,data.evidenceReference]);
    if (!rows[0]) throw new Error("Reconciled bank session not found.");
    return { ok:true,id:data.id };
  });

export const setFinancePeriodStatus = createServerFn({ method: "POST" })
  .validator(z.object({ period, status:z.enum(["open","soft_closed","hard_closed"]), evidenceReference:reference }))
  .handler(async ({ data }) => {
    const sql = await getSql();
    const [current] = await sql.query<{status:string}>(`select status from epr_finance_period_closures where period=$1`,[data.period]);
    const needsApproval = data.status === "hard_closed" || current?.status === "hard_closed";
    const actor = needsApproval ? await requireApprove() : await requireEdit();
    if (data.status === "hard_closed") {
      const { blockers, blockerCount } = await periodBlockers(data.period);
      if (blockerCount>0) throw new Error(`Period cannot hard-close with ${blockerCount} blocker(s): ${JSON.stringify(blockers)}.`);
    }
    await sql.query(
      `insert into epr_finance_period_closures(period,status,evidence_reference,updated_by,updated_at) values($1,$2,$3,$4,now())
       on conflict(period) do update set status=excluded.status,evidence_reference=excluded.evidence_reference,updated_by=excluded.updated_by,updated_at=now()`,
      [data.period,data.status,data.evidenceReference,actor.userId],
    );
    await sql.query(`insert into epr_finance_period_close_events(period,from_status,to_status,evidence_reference,actor_user_id) values($1,$2,$3,$4,$5)`,[data.period,current?.status ?? null,data.status,data.evidenceReference,actor.userId]);
    return { ok:true,period:data.period,status:data.status };
  });

export const captureCaEvidencePack = createServerFn({ method: "POST" })
  .validator(z.object({ id, period, evidenceReference:reference }))
  .handler(async ({ data }) => {
    const actor = await requireEdit();
    const sql = await getSql();
    const { blockers, blockerCount } = await periodBlockers(data.period);
    const [closure] = await sql.query<SqlRow>(`select status,evidence_reference from epr_finance_period_closures where period=$1`,[data.period]);
    const [gst] = await sql.query<SqlRow>(`select * from epr_finance_gst_period_summary where period=$1`,[data.period]);
    const [bank] = await sql.query<SqlRow>(`select id,status,difference_inr,approved_by,approved_at::text as approved_at,evidence_reference from epr_finance_bank_reconciliation_sessions where period=$1 and status='reconciled' order by prepared_at desc limit 1`,[data.period]);
    const [stocktake] = await sql.query<SqlRow>(`select id,status,effective_on::text as effective_on,evidence_reference,prepared_by,approved_by,posted_by,posted_at::text as posted_at,variance_line_count,gain_value_inr,loss_value_inr,finance_journal_id from epr_inventory_stocktakes where period=$1 and status='posted' order by posted_at desc limit 1`,[data.period]);
    const packStatus = blockerCount===0 && ["soft_closed","hard_closed"].includes(String(closure?.status ?? "")) ? "review_ready" : "draft";
    const summary = { period:data.period,blockers,closure:closure ?? null,gst:gst ?? null,bank:bank ?? null,stocktake:stocktake ?? null,capturedAt:new Date().toISOString() };
    await sql.query(
      `insert into epr_finance_ca_evidence_packs(id,period,status,blocker_count,summary_json,evidence_reference,generated_by) values($1,$2,$3,$4,$5::jsonb,$6,$7)`,
      [data.id,data.period,packStatus,blockerCount,JSON.stringify(summary),data.evidenceReference,actor.userId],
    );
    return { ok:true,id:data.id,status:packStatus,blockerCount };
  });

export const approveCaEvidencePack = createServerFn({ method: "POST" })
  .validator(z.object({ id, evidenceReference:reference }))
  .handler(async ({ data }) => {
    const actor = await requireApprove();
    const sql = await getSql();
    const rows = await sql.query<SqlRow>(`update epr_finance_ca_evidence_packs set status='approved',approved_by=$2,approved_at=now(),evidence_reference=$3 where id=$1 and status='review_ready' and blocker_count=0 returning id`,[data.id,actor.userId,data.evidenceReference]);
    if (!rows[0]) throw new Error("Only a blocker-free review-ready CA evidence pack can be approved.");
    return { ok:true,id:data.id };
  });
