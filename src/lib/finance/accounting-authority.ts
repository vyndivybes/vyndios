import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireBusinessActor } from "@/lib/business-actor";
import { getCommandRole } from "@/lib/command-access";
import { getSql, type SqlRow } from "@/lib/db";
import { canPerform } from "@/lib/page-access";
import { getRouteMeta } from "@/lib/page-metadata";
import {
  buildFinancialStatements,
  type StatementJobCost,
  type StatementLedgerLine,
} from "@/lib/finance/financial-statements";

const permissionRoute = "/command/finance-control";
const id = z.string().trim().min(1).max(160);
const reference = z.string().trim().min(1).max(500);
const money = z.number().finite().min(-1_000_000_000_000).max(1_000_000_000_000);
const toolingType = z.enum([
  "frame_mould",
  "fork_mould",
  "seatpost_mould",
  "bladder_eps_mandrel",
  "trim_drill_fixture",
  "bonding_fixture",
  "curing_fixture",
  "inspection_gauge",
  "other_tooling",
]);
const conversionCategory = z.enum([
  "direct_labour",
  "outsourcing",
  "manufacturing_consumables",
  "manufacturing_depreciation",
  "support_depreciation",
  "overhead",
  "scrap",
  "rework",
]);

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
  const [summary, trialBalance, generalLedger, journals, jobCosts, conversionCosts, openJobs, sourceCostLines, toolingProfiles, toolingRecovery, toolingRuns, gst, bank, assets, payroll, exceptions] = await Promise.all([
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
      select id,job_card_id,category,amount_inr,source_journal_id,source_line_no,source_reference,status,
             created_by,created_at::text as created_at,approved_by,approved_at::text as approved_at
        from epr_job_conversion_cost_allocations
       order by created_at desc limit 500`),
    sql.query<SqlRow>(`
      select id,coalesce(variant_id,product_label,product_id,'unknown') as model,status,units,sales_order_id
        from epr_production_job_cards
       where status<>'complete'
       order by updated_at desc,id limit 250`),
    sql.query<SqlRow>(`
      select j.id as journal_id,l.line_no,l.account_code,l.debit_inr,l.memo,j.entry_date::text as entry_date,
             j.source_type,j.source_id,j.description
        from epr_finance_journals j
        join epr_finance_journal_lines l on l.journal_id=j.id
       where j.status='posted'
         and l.debit_inr>0
         and l.account_code in ('5000','5100','5200','6100','6200','6300','6400','6500')
       order by j.entry_date desc,j.posted_at desc,l.line_no
       limit 500`),
    sql.query<SqlRow>(`
      select p.id,p.asset_id,p.tool_type,p.product_id,p.variant_id,p.frame_size,p.process,
             p.residual_value_inr,p.commercial_recovery_basis_inr,p.target_recovery_quantity,
             p.source_reference,p.status,p.created_at::text as created_at,p.approved_at::text as approved_at,
             a.description,a.acquisition_cost_inr,a.useful_life_months,a.accumulated_depreciation_inr
        from vyndi_tooling_cost_profiles p
        join epr_finance_fixed_assets a on a.asset_id=p.asset_id
       order by p.created_at desc,p.id`),
    sql.query<SqlRow>(`
      select * from vyndi_tooling_recovery_status
       order by commercial_recovery_remaining_inr desc,profile_id`),
    sql.query<SqlRow>(`
      select id,profile_id,asset_id,period,depreciation_inr,journal_id,allocation_status,
             source_reference,posted_by,posted_at::text as posted_at
        from vyndi_tooling_depreciation_runs
       order by period desc,posted_at desc,id limit 250`),
    sql.query<SqlRow>(`
      select id,period,direction,source_type,source_id,taxable_value_inr,gst_inr,eligible_itc,evidence_reference,
             document_date::text as document_date,document_number,counterparty_gstin,place_of_supply_code,hsn_sac,
             tax_rate_pct,cgst_inr,sgst_inr,igst_inr,cess_inr,irn,status,created_at::text as created_at
        from epr_finance_gst_ledger order by period desc,created_at desc limit 500`),
    sql.query<SqlRow>(`
      select id,bank_account_ref,statement_date::text as statement_date,amount_inr,reference,matched_journal_id,
             matched_by,match_reference,matched_at::text as matched_at,unmatched_by,unmatched_at::text as unmatched_at,
             unmatch_reason,imported_at::text as imported_at
        from epr_finance_bank_statement_lines order by statement_date desc,imported_at desc limit 500`),
    sql.query<SqlRow>(`
      select asset_id,source_expenditure_id,description,capitalization_date::text as capitalization_date,acquisition_cost_inr,useful_life_months,
             accumulated_depreciation_inr,location,custodian,source_reference,status,
             disposal_date::text as disposal_date,disposal_reference
        from epr_finance_fixed_assets order by capitalization_date desc,asset_id`),
    sql.query<SqlRow>(`
      select payroll_id,source_expenditure_id,period,gross_pay_inr,deductions_inr,employer_cost_inr,statutory_payable_inr,
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
    conversionCosts,
    openJobs,
    sourceCostLines,
    toolingProfiles,
    toolingRecovery,
    toolingRuns,
    gst,
    bank,
    assets,
    payroll,
    exceptions,
  };
});


const statementRange = z.object({
  fromDate: z.string().date(),
  toDate: z.string().date(),
});

export const getAccountingStatements = createServerFn({ method: "GET" })
  .validator(statementRange)
  .handler(async ({ data }) => {
    await requireView();
    if (data.fromDate > data.toDate) throw new Error("Statement start date must not be after the end date.");
    const sql = await getSql();
    const [ledgerRows, costRows] = await Promise.all([
      sql.query<SqlRow>(
        `select journal_id,entry_date::text as entry_date,source_type,source_id,account_code,debit_inr,credit_inr
           from epr_finance_general_ledger
          where entry_date <= $1::date
          order by entry_date,journal_id,line_no`,
        [data.toDate],
      ),
      sql.query<SqlRow>(
        `select distinct on (job_card_id)
                job_card_id,model,planned_quantity,completed_quantity,material_actual_inr,material_standard_inr,
                material_variance_inr,direct_labour_inr,outsourcing_inr,manufacturing_consumables_inr,
                manufacturing_depreciation_inr,support_depreciation_inr,overhead_inr,scrap_inr,rework_inr,
                total_actual_cost_inr,finished_goods_value_inr,wip_value_inr
           from epr_job_cost_snapshots
          where captured_at::date between $1::date and $2::date
          order by job_card_id,captured_at desc`,
        [data.fromDate, data.toDate],
      ),
    ]);

    const lines: StatementLedgerLine[] = ledgerRows.map((row) => ({
      journalId: String(row.journal_id ?? ""),
      entryDate: String(row.entry_date ?? ""),
      sourceType: String(row.source_type ?? ""),
      sourceId: String(row.source_id ?? ""),
      accountCode: String(row.account_code ?? ""),
      debitInr: Number(row.debit_inr ?? 0),
      creditInr: Number(row.credit_inr ?? 0),
    }));
    const jobCosts: StatementJobCost[] = costRows.map((row) => ({
      jobCardId: String(row.job_card_id ?? ""),
      model: String(row.model ?? ""),
      plannedQuantity: Number(row.planned_quantity ?? 0),
      completedQuantity: Number(row.completed_quantity ?? 0),
      materialActualInr: Number(row.material_actual_inr ?? 0),
      materialStandardInr: Number(row.material_standard_inr ?? 0),
      materialVarianceInr: Number(row.material_variance_inr ?? 0),
      directLabourInr: Number(row.direct_labour_inr ?? 0),
      outsourcingInr: Number(row.outsourcing_inr ?? 0),
      manufacturingConsumablesInr: Number(row.manufacturing_consumables_inr ?? 0),
      manufacturingDepreciationInr: Number(row.manufacturing_depreciation_inr ?? 0),
      supportDepreciationInr: Number(row.support_depreciation_inr ?? 0),
      overheadInr: Number(row.overhead_inr ?? 0),
      scrapInr: Number(row.scrap_inr ?? 0),
      reworkInr: Number(row.rework_inr ?? 0),
      totalActualCostInr: Number(row.total_actual_cost_inr ?? 0),
      finishedGoodsValueInr: Number(row.finished_goods_value_inr ?? 0),
      wipValueInr: Number(row.wip_value_inr ?? 0),
    }));

    return buildFinancialStatements({
      lines,
      jobCosts,
      fromDate: data.fromDate,
      toDate: data.toDate,
    });
  });

export const importBankStatementLine = createServerFn({ method: "POST" })
  .validator(z.object({ id, bankAccountRef: id, statementDate: z.string().date(), amountInr: money.refine((value) => value !== 0, "Bank statement amount cannot be zero."), reference }))
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
  .validator(z.object({ statementLineId: id, journalId: id, matchReference: z.string().trim().max(500).optional() }))
  .handler(async ({ data }) => {
    const actor = await requireEdit();
    const sql = await getSql();
    const [statement] = await sql.query<{ amount_inr: number | string; matched_journal_id: string | null }>(
      `select amount_inr,matched_journal_id from epr_finance_bank_statement_lines where id=$1 for update`, [data.statementLineId],
    );
    if (!statement) throw new Error("Bank statement line not found.");
    if (statement.matched_journal_id) throw new Error("Bank statement line is already reconciled.");
    const [used] = await sql.query<{ id: string }>(
      `select id from epr_finance_bank_statement_lines where matched_journal_id=$1 and id<>$2 limit 1`, [data.journalId, data.statementLineId],
    );
    if (used) throw new Error(`Journal ${data.journalId} is already matched to bank statement line ${used.id}.`);
    const [journal] = await sql.query<{ bank_delta: number | string }>(
      `select coalesce(sum(debit_inr-credit_inr),0) as bank_delta
         from epr_finance_journal_lines l join epr_finance_journals j on j.id=l.journal_id
        where j.id=$1 and j.status='posted' and l.account_code='1000'`, [data.journalId],
    );
    const bankDelta = Number(journal?.bank_delta ?? 0);
    if (bankDelta === 0) throw new Error("Selected journal has no posted Bank account movement.");
    if (Math.abs(bankDelta - Number(statement.amount_inr)) > 0.01) {
      throw new Error(`Bank amount does not reconcile to journal bank movement. Statement ${Number(statement.amount_inr).toFixed(2)}, journal ${bankDelta.toFixed(2)}.`);
    }
    await sql.query(
      `update epr_finance_bank_statement_lines
          set matched_journal_id=$2,matched_at=now(),matched_by=$3,match_reference=$4,
              unmatched_by=null,unmatched_at=null,unmatch_reason=null
        where id=$1`,
      [data.statementLineId, data.journalId, actor.userId, data.matchReference ?? null],
    );
    await sql.query(
      `insert into epr_finance_bank_match_audit(statement_line_id,journal_id,action,reason,actor_user_id)
       values($1,$2,'matched',$3,$4)`,
      [data.statementLineId, data.journalId, data.matchReference ?? null, actor.userId],
    );
    return { ok: true, statementLineId: data.statementLineId, journalId: data.journalId };
  });

export const unmatchBankStatementLine = createServerFn({ method: "POST" })
  .validator(z.object({ statementLineId: id, reason: reference }))
  .handler(async ({ data }) => {
    const actor = await requireEdit();
    const sql = await getSql();
    const [statement] = await sql.query<{ matched_journal_id: string | null }>(
      `select matched_journal_id from epr_finance_bank_statement_lines where id=$1 for update`, [data.statementLineId],
    );
    if (!statement?.matched_journal_id) throw new Error("Bank statement line is not currently matched.");
    const journalId = statement.matched_journal_id;
    await sql.query(
      `update epr_finance_bank_statement_lines
          set matched_journal_id=null,matched_at=null,unmatched_by=$2,unmatched_at=now(),unmatch_reason=$3
        where id=$1`, [data.statementLineId, actor.userId, data.reason],
    );
    await sql.query(
      `insert into epr_finance_bank_match_audit(statement_line_id,journal_id,action,reason,actor_user_id)
       values($1,$2,'unmatched',$3,$4)`, [data.statementLineId, journalId, data.reason, actor.userId],
    );
    return { ok: true, statementLineId: data.statementLineId };
  });

export const savePayrollControl = createServerFn({ method: "POST" })
  .validator(z.object({
    payrollId: id,
    sourceExpenditureId: id,
    period: z.string().regex(/^[0-9]{4}-(0[1-9]|1[0-2])$/),
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
    const [row] = await sql.query<{ payroll_id: string }>(
      `select save_vyndi_linked_payroll_control(
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11
      ) as payroll_id`,
      [
        data.payrollId,
        data.sourceExpenditureId,
        data.period,
        data.grossPayInr,
        data.deductionsInr,
        data.employerCostInr,
        data.statutoryPayableInr,
        data.paymentReference ?? null,
        data.returnEvidenceReference ?? null,
        actor.userId,
        actor.role,
      ],
    );
    return { ok: true, payrollId: row?.payroll_id ?? data.payrollId };
  });

export const resolveFinancePostingException = createServerFn({ method: "POST" })
  .validator(z.object({ id, reference }))
  .handler(async ({ data }) => {
    await requireEdit();
    const sql = await getSql();
    await sql.query(
      `update epr_finance_posting_exceptions set resolved=true,resolved_reference=$2,resolved_at=now() where id=$1 and resolved=false`,
      [data.id, data.reference],
    );
    return { ok: true, id: data.id };
  });


export const createJobConversionCostAllocation = createServerFn({ method: "POST" })
  .validator(z.object({
    id,
    jobCardId: id,
    category: conversionCategory,
    amountInr: z.number().finite().positive().max(1_000_000_000_000),
    sourceJournalId: id,
    sourceLineNo: z.number().int().positive(),
    sourceReference: reference,
  }))
  .handler(async ({ data }) => {
    const actor = await requireEdit();
    const sql = await getSql();
    await sql.query(
      `insert into epr_job_conversion_cost_allocations(
         id,job_card_id,category,amount_inr,source_journal_id,source_line_no,source_reference,created_by
       ) values($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        data.id,
        data.jobCardId,
        data.category,
        data.amountInr,
        data.sourceJournalId,
        data.sourceLineNo,
        data.sourceReference,
        actor.userId,
      ],
    );
    return { ok: true, id: data.id, status: "draft" as const };
  });

export const approveJobConversionCostAllocation = createServerFn({ method: "POST" })
  .validator(z.object({ id }))
  .handler(async ({ data }) => {
    const actor = await requireBusinessActor("approve");
    if (!canPerform(actor.role, "approve", getRouteMeta(permissionRoute))) {
      throw new Error("Job conversion cost approval permission denied.");
    }
    const sql = await getSql();
    const rows = await sql.query<{ approved_id: string }>(
      `select approve_vyndi_job_conversion_cost($1,$2,$3) as approved_id`,
      [data.id, actor.userId, actor.role],
    );
    return { ok: true, id: rows[0]?.approved_id ?? data.id, status: "approved" as const };
  });

export const rejectJobConversionCostAllocation = createServerFn({ method: "POST" })
  .validator(z.object({ id, reason: reference }))
  .handler(async ({ data }) => {
    const actor = await requireBusinessActor("approve");
    if (!canPerform(actor.role, "approve", getRouteMeta(permissionRoute))) {
      throw new Error("Job conversion cost rejection permission denied.");
    }
    const sql = await getSql();
    await sql.query(
      `update epr_job_conversion_cost_allocations
          set status='rejected',rejected_by=$2,rejected_at=now(),rejection_reason=$3
        where id=$1 and status='draft'`,
      [data.id, actor.userId, data.reason],
    );
    return { ok: true, id: data.id, status: "rejected" as const };
  });


export const createToolingCostProfile = createServerFn({ method: "POST" })
  .validator(z.object({
    id,
    assetId: id,
    toolType: toolingType,
    productId: z.string().trim().max(120).optional(),
    variantId: z.string().trim().max(160).optional(),
    frameSize: z.string().trim().max(40).optional(),
    process: z.string().trim().max(160).optional(),
    residualValueInr: z.number().finite().min(0).max(1_000_000_000_000),
    commercialRecoveryBasisInr: z.number().finite().positive().max(1_000_000_000_000),
    targetRecoveryQuantity: z.number().finite().positive().max(1_000_000_000),
    sourceReference: reference,
  }).refine(
    (data) => Boolean(data.productId || data.variantId || data.frameSize),
    "Tooling recovery requires product, variant or frame-size applicability.",
  ))
  .handler(async ({ data }) => {
    const actor = await requireEdit();
    const sql = await getSql();
    await sql.query(
      `insert into vyndi_tooling_cost_profiles(
         id,asset_id,tool_type,product_id,variant_id,frame_size,process,residual_value_inr,
         commercial_recovery_basis_inr,target_recovery_quantity,source_reference,created_by
       ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        data.id,
        data.assetId,
        data.toolType,
        data.productId || null,
        data.variantId || null,
        data.frameSize || null,
        data.process || null,
        data.residualValueInr,
        data.commercialRecoveryBasisInr,
        data.targetRecoveryQuantity,
        data.sourceReference,
        actor.userId,
      ],
    );
    return { ok: true, id: data.id, status: "draft" as const };
  });

export const approveToolingCostProfile = createServerFn({ method: "POST" })
  .validator(z.object({ id }))
  .handler(async ({ data }) => {
    const actor = await requireBusinessActor("approve");
    if (!canPerform(actor.role, "approve", getRouteMeta(permissionRoute))) {
      throw new Error("Tooling profile approval permission denied.");
    }
    const sql = await getSql();
    const rows = await sql.query<{ approved_id: string }>(
      `select approve_vyndi_tooling_cost_profile($1,$2,$3) as approved_id`,
      [data.id, actor.userId, actor.role],
    );
    return { ok: true, id: rows[0]?.approved_id ?? data.id };
  });

export const postToolingDepreciation = createServerFn({ method: "POST" })
  .validator(z.object({
    profileId: id,
    period: z.string().regex(/^[0-9]{4}-(0[1-9]|1[0-2])$/),
    sourceReference: reference,
  }))
  .handler(async ({ data }) => {
    const actor = await requireBusinessActor("approve");
    if (!canPerform(actor.role, "approve", getRouteMeta(permissionRoute))) {
      throw new Error("Tooling depreciation posting permission denied.");
    }
    const sql = await getSql();
    const rows = await sql.query<{
      run_id: string;
      journal_id: string;
      depreciation_inr: number | string;
      draft_allocations: number | string;
    }>(
      `select * from post_vyndi_tooling_depreciation($1,$2,$3,$4,$5)`,
      [data.profileId, data.period, data.sourceReference, actor.userId, actor.role],
    );
    const row = rows[0];
    if (!row) throw new Error("Tooling depreciation posting did not return a controlled result.");
    return {
      ok: true,
      runId: row.run_id,
      journalId: row.journal_id,
      depreciationInr: Number(row.depreciation_inr),
      draftAllocations: Number(row.draft_allocations),
    };
  });
