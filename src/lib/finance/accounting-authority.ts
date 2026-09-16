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
const money = z.number().finite().min(-1_000_000_000_000).max(1_000_000_000_000);

async function requireView() {
  const role = await getCommandRole();
  if (!role || !canPerform(role, "view", getRouteMeta(permissionRoute))) {
    throw new Error("Accounting workbench view permission denied.");
  }
  return role;
}

async function requireEdit() {
  const actor = await requireBusinessActor("edit");
  if (!canPerform(actor.role, "edit", getRouteMeta(permissionRoute))) {
    throw new Error("Accounting workbench edit permission denied.");
  }
  return actor;
}

export const getAccountingWorkbench = createServerFn({ method: "GET" }).handler(async () => {
  await requireView();
  const sql = await getSql();
  const [summary, trialBalance, generalLedger, journals, jobCosts, gst, bank, assets, payroll, exceptions] = await Promise.all([
    sql.query<SqlRow>(`select * from epr_finance_control_summary`),
    sql.query<SqlRow>(`select * from epr_finance_trial_balance order by account_code`),
    sql.query<SqlRow>(`select * from epr_finance_general_ledger limit 500`),
    sql.query<SqlRow>(`
      select j.id,j.entry_date::text as entry_date,j.source_type,j.source_id,j.description,j.status,
             j.posted_at::text as posted_at,j.reversed_entry_id,
             round(sum(l.debit_inr),2) as debit_inr,round(sum(l.credit_inr),2) as credit_inr
        from epr_finance_journals j
        join epr_finance_journal_lines l on l.journal_id=j.id
       group by j.id,j.entry_date,j.source_type,j.source_id,j.description,j.status,j.posted_at,j.reversed_entry_id
       order by j.entry_date desc,j.posted_at desc limit 250`),
    sql.query<SqlRow>(`
      select id,job_card_id,model,planned_quantity,completed_quantity,material_actual_inr,material_standard_inr,
             material_variance_inr,direct_labour_inr,outsourcing_inr,manufacturing_consumables_inr,
             manufacturing_depreciation_inr,support_depreciation_inr,overhead_inr,scrap_inr,rework_inr,
             total_actual_cost_inr,unit_actual_cost_inr,finished_goods_value_inr,wip_value_inr,
             source_action_id,captured_at::text as captured_at
        from epr_job_cost_snapshots order by captured_at desc limit 250`),
    sql.query<SqlRow>(`
      select id,period,direction,source_type,source_id,taxable_value_inr,gst_inr,eligible_itc,evidence_reference,
             created_at::text as created_at
        from epr_finance_gst_ledger order by period desc,created_at desc limit 500`),
    sql.query<SqlRow>(`
      select id,bank_account_ref,statement_date::text as statement_date,amount_inr,reference,matched_journal_id,
             matched_at::text as matched_at,imported_at::text as imported_at
        from epr_finance_bank_statement_lines order by statement_date desc,imported_at desc limit 500`),
    sql.query<SqlRow>(`
      select asset_id,description,capitalization_date::text as capitalization_date,acquisition_cost_inr,useful_life_months,
             accumulated_depreciation_inr,location,custodian,source_reference,status,
             disposal_date::text as disposal_date,disposal_reference
        from epr_finance_fixed_assets order by capitalization_date desc,asset_id`),
    sql.query<SqlRow>(`
      select payroll_id,period,gross_pay_inr,deductions_inr,employer_cost_inr,statutory_payable_inr,
             payment_reference,return_evidence_reference,approved_by,approved_at::text as approved_at,
             created_at::text as created_at
        from epr_finance_payroll_controls order by period desc,payroll_id`),
    sql.query<SqlRow>(`
      select id,source_type,source_id,severity,message,resolved,resolved_reference,
             created_at::text as created_at,resolved_at::text as resolved_at
        from epr_finance_posting_exceptions order by resolved asc,
          case severity when 'critical' then 1 when 'high' then 2 when 'medium' then 3 else 4 end,created_at desc`),
  ]);
  return {
    summary: summary[0] ?? {},
    trialBalance,
    generalLedger,
    journals,
    jobCosts,
    gst,
    bank,
    assets,
    payroll,
    exceptions,
  };
});

export const importBankStatementLine = createServerFn({ method: "POST" })
  .validator(z.object({
    id,
    bankAccountRef: id,
    statementDate: z.string().date(),
    amountInr: money.refine((value) => value !== 0, "Bank statement amount cannot be zero."),
    reference,
  }))
  .handler(async ({ data }) => {
    await requireEdit();
    const sql = await getSql();
    await sql.query(
      `insert into epr_finance_bank_statement_lines(id,bank_account_ref,statement_date,amount_inr,reference)
       values($1,$2,$3::date,$4,$5)
       on conflict (id) do update set bank_account_ref=excluded.bank_account_ref,
         statement_date=excluded.statement_date,amount_inr=excluded.amount_inr,reference=excluded.reference
       where epr_finance_bank_statement_lines.matched_journal_id is null`,
      [data.id, data.bankAccountRef, data.statementDate, data.amountInr, data.reference],
    );
    return { ok: true, id: data.id };
  });

export const matchBankStatementLine = createServerFn({ method: "POST" })
  .validator(z.object({ statementLineId: id, journalId: id }))
  .handler(async ({ data }) => {
    await requireEdit();
    const sql = await getSql();
    const [statement] = await sql.query<{ amount_inr: number | string; matched_journal_id: string | null }>(
      `select amount_inr,matched_journal_id from epr_finance_bank_statement_lines where id=$1 for update`,
      [data.statementLineId],
    );
    if (!statement) throw new Error("Bank statement line not found.");
    if (statement.matched_journal_id) throw new Error("Bank statement line is already reconciled.");
    const [journal] = await sql.query<{ bank_delta: number | string }>(
      `select coalesce(sum(debit_inr-credit_inr),0) as bank_delta
         from epr_finance_journal_lines l join epr_finance_journals j on j.id=l.journal_id
        where j.id=$1 and j.status='posted' and l.account_code='1000'`,
      [data.journalId],
    );
    const bankDelta = Number(journal?.bank_delta ?? 0);
    if (Math.abs(bankDelta - Number(statement.amount_inr)) > 0.01) {
      throw new Error(`Bank amount does not reconcile to journal bank movement. Statement ${Number(statement.amount_inr).toFixed(2)}, journal ${bankDelta.toFixed(2)}.`);
    }
    await sql.query(
      `update epr_finance_bank_statement_lines set matched_journal_id=$2,matched_at=now() where id=$1`,
      [data.statementLineId, data.journalId],
    );
    return { ok: true, statementLineId: data.statementLineId, journalId: data.journalId };
  });

export const saveFixedAsset = createServerFn({ method: "POST" })
  .validator(z.object({
    assetId: id,
    description: z.string().trim().min(2).max(300),
    capitalizationDate: z.string().date(),
    acquisitionCostInr: z.number().finite().min(0).max(1_000_000_000_000),
    usefulLifeMonths: z.number().int().min(1).max(1200),
    accumulatedDepreciationInr: z.number().finite().min(0).max(1_000_000_000_000).default(0),
    location: z.string().trim().max(200).optional(),
    custodian: z.string().trim().max(200).optional(),
    sourceReference: reference,
    status: z.enum(["active", "idle", "disposed"]).default("active"),
  }))
  .handler(async ({ data }) => {
    await requireEdit();
    if (data.accumulatedDepreciationInr > data.acquisitionCostInr) {
      throw new Error("Accumulated depreciation cannot exceed acquisition cost.");
    }
    const sql = await getSql();
    await sql.query(
      `insert into epr_finance_fixed_assets
        (asset_id,description,capitalization_date,acquisition_cost_inr,useful_life_months,
         accumulated_depreciation_inr,location,custodian,source_reference,status)
       values($1,$2,$3::date,$4,$5,$6,$7,$8,$9,$10)
       on conflict (asset_id) do update set description=excluded.description,capitalization_date=excluded.capitalization_date,
         acquisition_cost_inr=excluded.acquisition_cost_inr,useful_life_months=excluded.useful_life_months,
         accumulated_depreciation_inr=excluded.accumulated_depreciation_inr,location=excluded.location,
         custodian=excluded.custodian,source_reference=excluded.source_reference,status=excluded.status,updated_at=now()`,
      [data.assetId, data.description, data.capitalizationDate, data.acquisitionCostInr, data.usefulLifeMonths,
       data.accumulatedDepreciationInr, data.location ?? null, data.custodian ?? null, data.sourceReference, data.status],
    );
    return { ok: true, assetId: data.assetId };
  });

export const savePayrollControl = createServerFn({ method: "POST" })
  .validator(z.object({
    payrollId: id,
    period: z.string().regex(/^\d{4}-\d{2}$/),
    grossPayInr: z.number().finite().min(0).max(1_000_000_000_000),
    deductionsInr: z.number().finite().min(0).max(1_000_000_000_000),
    employerCostInr: z.number().finite().min(0).max(1_000_000_000_000),
    statutoryPayableInr: z.number().finite().min(0).max(1_000_000_000_000),
    paymentReference: z.string().trim().max(500).optional(),
    returnEvidenceReference: z.string().trim().max(500).optional(),
  }))
  .handler(async ({ data }) => {
    const actor = await requireEdit();
    const sql = await getSql();
    await sql.query(
      `insert into epr_finance_payroll_controls
        (payroll_id,period,gross_pay_inr,deductions_inr,employer_cost_inr,statutory_payable_inr,
         payment_reference,return_evidence_reference,approved_by,approved_at)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9,now())
       on conflict (payroll_id) do update set period=excluded.period,gross_pay_inr=excluded.gross_pay_inr,
         deductions_inr=excluded.deductions_inr,employer_cost_inr=excluded.employer_cost_inr,
         statutory_payable_inr=excluded.statutory_payable_inr,payment_reference=excluded.payment_reference,
         return_evidence_reference=excluded.return_evidence_reference,approved_by=excluded.approved_by,approved_at=now()`,
      [data.payrollId, data.period, data.grossPayInr, data.deductionsInr, data.employerCostInr,
       data.statutoryPayableInr, data.paymentReference ?? null, data.returnEvidenceReference ?? null, actor.userId],
    );
    return { ok: true, payrollId: data.payrollId };
  });

export const resolveFinancePostingException = createServerFn({ method: "POST" })
  .validator(z.object({ id, reference }))
  .handler(async ({ data }) => {
    await requireEdit();
    const sql = await getSql();
    await sql.query(
      `update epr_finance_posting_exceptions set resolved=true,resolved_reference=$2,resolved_at=now()
        where id=$1 and resolved=false`,
      [data.id, data.reference],
    );
    return { ok: true, id: data.id };
  });
