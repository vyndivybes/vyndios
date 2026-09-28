import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireBusinessActor } from "@/lib/business-actor";
import { getCommandRole } from "@/lib/command-access";
import { getSql, type Sql, type SqlRow } from "@/lib/db";
import {
  EXTERNAL_SUPPORT_DESTINATIONS,
  MANUAL_EXPENSE_CATEGORIES,
  REPAYMENT_STATUSES,
  THIRD_PARTY_PAYER_TYPES,
  manualExpenseCategory,
  thirdPartyLiabilityAccount,
  type RepaymentStatus,
} from "@/lib/finance/expense-classification";
import { canPerform } from "@/lib/page-access";
import { getRouteMeta } from "@/lib/page-metadata";

const PERMISSION_ROUTE = "/command/accounting";
const identifier = z.string().trim().min(1).max(160);
const reference = z.string().trim().min(3).max(500);
const money = z.number().finite().positive().max(1_000_000_000_000);

export const PEOPLE_OFFICE_ACTUAL_SOURCE_TYPES = ["cost_item", "asset", "manual_expense"] as const;
export const PEOPLE_OFFICE_FUNDING_SOURCES = ["company_bank", "founder_personal", "third_party"] as const;
export const FOUNDER_PERSONAL = "founder_personal" as const;


type SourceAuthority = {
  label: string;
  category: string;
  debitAccountCode: string;
};

async function resolveDirectSource(sql: Sql, sourceType: "cost_item" | "asset" | "manual_expense", sourceId: string): Promise<SourceAuthority> {
  if (sourceType === "manual_expense") {
    const category = manualExpenseCategory(sourceId);
    if (!category) throw new Error("Unsupported manual operating expense category.");
    return {
      label: category.label,
      category: category.sourceCategory,
      debitAccountCode: category.debitAccountCode,
    };
  }

  if (sourceType === "cost_item") {
    const rows = await sql.query<SqlRow>(
      `select id,name,cost_group from vyndi_people_office_cost_items where id=$1 and lifecycle_status='approved'`,
      [sourceId],
    );
    const row = rows[0];
    if (!row) throw new Error("Actual cost requires an approved People & Office cost item.");
    const category = String(row.cost_group ?? "");
    const debitAccountCode = sourceId === "office-travel"
      ? "6250"
      : category === "payroll" ? "6100"
      : category === "office" ? "6200"
      : category === "statutory" ? "6300"
      : category === "outsourcing" ? "6400"
      : "";
    if (!debitAccountCode) throw new Error(`No controlled accounting map exists for source ${sourceId}.`);
    return { label: String(row.name ?? sourceId), category, debitAccountCode };
  }

  const rows = await sql.query<SqlRow>(
    `select id,name,asset_class from vyndi_people_office_assets where id=$1 and lifecycle_status='approved'`,
    [sourceId],
  );
  const row = rows[0];
  if (!row) throw new Error("Actual asset spend requires an approved People & Office asset item.");
  const category = String(row.asset_class ?? "");
  return {
    label: String(row.name ?? sourceId),
    category,
    debitAccountCode: category === "office_admin" ? "1500" : "6200",
  };
}

function governanceMarkerForFunding(fundingSource: string, repaymentStatus?: RepaymentStatus) {
  if (fundingSource === "third_party") {
    return repaymentStatus === "required"
      ? "THIRD_PARTY_REIMBURSEMENT_REQUIRED"
      : "EXTERNAL_SUPPORT_PENDING_CLASSIFICATION";
  }
  return null;
}

async function requireView() {
  const role = await getCommandRole();
  if (!role || !canPerform(role, "view", getRouteMeta(PERMISSION_ROUTE))) {
    throw new Error("People & Office actual expenditure view permission denied.");
  }
  return role;
}

async function requireActor(permission: "edit" | "approve") {
  const actor = await requireBusinessActor(permission);
  if (!canPerform(actor.role, permission, getRouteMeta(PERMISSION_ROUTE))) {
    throw new Error(`People & Office actual expenditure ${permission} permission denied.`);
  }
  return actor;
}

export const listPeopleOfficeActualSpend = createServerFn({ method: "GET" }).handler(async () => {
  await requireView();
  const sql = await getSql();
  const [costItems, assets, expenditures, payments, founderReimbursements, thirdPartyReimbursements, externalSupportReceipts, cashAuthority] = await Promise.all([
    sql.query<SqlRow>(`
      select id,name,cost_group,stage,start_month,end_month,one_time_month,source_ref
        from vyndi_people_office_cost_items
       where lifecycle_status='approved'
       order by cost_group,name,id
    `),
    sql.query<SqlRow>(`
      select id,name,category,asset_class,purchase_month,useful_life_months,source_ref
        from vyndi_people_office_assets
       where lifecycle_status='approved'
       order by asset_class,name,id
    `),
    sql.query<SqlRow>(`
      select * from vyndi_people_office_actual_spend_authority
       order by case lifecycle_status when 'pending_approval' then 0 when 'approved' then 1 when 'part_paid' then 2 when 'draft' then 3 else 4 end,
                plan_month,incurred_on desc,created_at desc
    `),
    sql.query<SqlRow>(`
      select p.*,e.source_label,e.description,e.plan_month as accrual_plan_month,e.liability_account_code
        from vyndi_people_office_actual_payments p
        join vyndi_people_office_actual_expenditures e on e.id=p.expenditure_id
       order by p.paid_on desc,p.created_at desc,p.id desc
    `),
    sql.query<SqlRow>(`
      select r.*,e.source_label,e.description,e.plan_month as accrual_plan_month,e.liability_account_code
        from vyndi_founder_reimbursements r
        join vyndi_people_office_actual_expenditures e on e.id=r.expenditure_id
       order by r.reimbursed_on desc,r.created_at desc,r.id desc
    `),
    sql.query<SqlRow>(`
      select r.*,e.source_label,e.description,e.plan_month as accrual_plan_month,
             e.liability_account_code,e.third_party_payer_name,e.third_party_payer_type
        from vyndi_third_party_reimbursements r
        join vyndi_people_office_actual_expenditures e on e.id=r.expenditure_id
       order by r.reimbursed_on desc,r.created_at desc,r.id desc
    `),
    sql.query<SqlRow>(`
      select s.*,e.description as related_expenditure_description,e.source_label as related_expenditure_source
        from vyndi_external_support_receipts s
        left join vyndi_people_office_actual_expenditures e on e.id=s.related_expenditure_id
       order by s.received_on desc,s.created_at desc,s.id desc
    `),
    sql.query<SqlRow>(`
      select plan_month,closing_cash_lakh,source_reference,verified
        from vyndi_cash_authority
       where verified=true
       order by plan_month desc
    `),
  ]);
  return {
    costItems,
    assets,
    expenditures,
    payments,
    founderReimbursements,
    thirdPartyReimbursements,
    externalSupportReceipts,
    cashAuthority,
  };
});

export const createPeopleOfficeActualExpenditure = createServerFn({ method: "POST" })
  .validator(
    z.object({
      sourceType: z.enum(PEOPLE_OFFICE_ACTUAL_SOURCE_TYPES),
      sourceId: identifier,
      planMonth: z.number().int().min(1).max(36),
      incurredOn: z.string().date(),
      description: z.string().trim().min(3).max(500),
      amountInr: money,
      sourceReference: reference,
      notes: z.string().trim().max(2000).default(""),
      fundingSource: z.enum(PEOPLE_OFFICE_FUNDING_SOURCES).default("company_bank"),
      thirdPartyPayerName: z.string().trim().max(160).default(""),
      thirdPartyPayerType: z.enum(THIRD_PARTY_PAYER_TYPES).optional(),
      thirdPartyRepaymentStatus: z.enum(REPAYMENT_STATUSES).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const actor = await requireActor("edit");
    const sql = await getSql();
    const id = `POEXP-${crypto.randomUUID()}`;

    if (data.fundingSource === "third_party") {
      if (!data.thirdPartyPayerName || !data.thirdPartyPayerType || !data.thirdPartyRepaymentStatus) {
        throw new Error("Third-party paid expenditure requires payer name, payer type, and repayment status.");
      }
    }

    const directInsert = data.sourceType === "manual_expense" || data.fundingSource === "third_party";
    if (directInsert) {
      const source = await resolveDirectSource(sql, data.sourceType, data.sourceId);
      const repaymentStatus = data.thirdPartyRepaymentStatus;
      const liabilityAccount =
        data.fundingSource === "founder_personal" ? "2400"
        : data.fundingSource === "third_party" && repaymentStatus ? thirdPartyLiabilityAccount(repaymentStatus)
        : "2000";
      const governanceMarker = governanceMarkerForFunding(data.fundingSource, repaymentStatus);

      const rows = await sql.query<{ id: string }>(
        `with expenditure as (
           insert into vyndi_people_office_actual_expenditures(
             id,source_type,source_id,source_label,source_category,plan_month,incurred_on,description,
             amount_inr,debit_account_code,liability_account_code,lifecycle_status,source_reference,notes,
             funding_source,governance_marker,third_party_payer_name,third_party_payer_type,
             third_party_repayment_status,created_by)
           values(
             $1,$2,$3,$4,$5,$6,$7::date,$8,round($9::numeric,2),$10,$11,'draft',$12,$13,
             $14,$15,$16,$17,$18,$19)
           returning id
         ),
         audit as (
           insert into vyndi_audit_events(
             id,entity_type,entity_id,action,actor_user_id,actor_role,source_reference,payload_json)
           select
             'AUD-'||id||'-DRAFT','people_office_actual_expenditure',id,
             case when $2='manual_expense' then 'manual_expense_draft_created' else 'third_party_expense_draft_created' end,
             $19,$20,$12,
             jsonb_build_object(
               'sourceType',$2,
               'sourceId',$3,
               'sourceLabel',$4,
               'accrualPlanMonth',$6,
               'amountInr',round($9::numeric,2),
               'debitAccount',$10,
               'liabilityAccount',$11,
               'fundingSource',$14,
               'thirdPartyPayerName',nullif($16,''),
               'thirdPartyPayerType',$17,
               'thirdPartyRepaymentStatus',$18,
               'companyCashMoved',false
             )
           from expenditure
           returning id
         )
         select id from expenditure`,
        [
          id,
          data.sourceType,
          data.sourceId,
          source.label,
          source.category,
          data.planMonth,
          data.incurredOn,
          data.description.trim(),
          data.amountInr,
          source.debitAccountCode,
          liabilityAccount,
          data.sourceReference.trim(),
          data.notes.trim(),
          data.fundingSource,
          governanceMarker,
          data.fundingSource === "third_party" ? data.thirdPartyPayerName : null,
          data.fundingSource === "third_party" ? data.thirdPartyPayerType : null,
          data.fundingSource === "third_party" ? data.thirdPartyRepaymentStatus : null,
          actor.userId,
          actor.role,
        ],
      );
      return { ok: true, id: rows[0]?.id ?? id };
    }

    const rows = await sql.query<{ create_vyndi_people_office_actual_expenditure_v2: string }>(
      `select create_vyndi_people_office_actual_expenditure_v2($1,$2,$3,$4,$5::date,$6,$7,$8,$9,$10,$11,$12)`,
      [
        id,
        data.sourceType,
        data.sourceId,
        data.planMonth,
        data.incurredOn,
        data.description,
        data.amountInr,
        data.sourceReference,
        data.notes,
        data.fundingSource,
        actor.userId,
        actor.role,
      ],
    );
    return { ok: true, id: rows[0]?.create_vyndi_people_office_actual_expenditure_v2 ?? id };
  });

export const submitPeopleOfficeActualExpenditure = createServerFn({ method: "POST" })
  .validator(z.object({ id: identifier }))
  .handler(async ({ data }) => {
    const actor = await requireActor("edit");
    const sql = await getSql();
    await sql.query(`select submit_vyndi_people_office_actual_expenditure($1,$2,$3)`, [
      data.id,
      actor.userId,
      actor.role,
    ]);
    return { ok: true, id: data.id };
  });

export const approvePeopleOfficeActualExpenditure = createServerFn({ method: "POST" })
  .validator(z.object({ id: identifier, soleOperatorSelfApproval: z.boolean().default(false) }))
  .handler(async ({ data }) => {
    const actor = await requireActor("approve");
    const sql = await getSql();
    await sql.query(`select approve_vyndi_people_office_actual_expenditure_v2($1,$2,$3,$4)`, [
      data.id,
      actor.userId,
      actor.role,
      data.soleOperatorSelfApproval,
    ]);
    return { ok: true, id: data.id };
  });

export const postPeopleOfficeActualPayment = createServerFn({ method: "POST" })
  .validator(
    z.object({
      expenditureId: identifier,
      paymentPlanMonth: z.number().int().min(1).max(36),
      paidOn: z.string().date(),
      amountInr: money,
      evidenceReference: reference,
    }),
  )
  .handler(async ({ data }) => {
    const actor = await requireActor("approve");
    const sql = await getSql();
    const id = `POPAY-${crypto.randomUUID()}`;
    const rows = await sql.query<{
      payment_id: string;
      journal_id: string;
      new_closing_cash_lakh: number | string;
      actual_revision: number | string;
      expenditure_status: string;
    }>(
      `select * from post_vyndi_people_office_actual_payment($1,$2,$3,$4::date,$5,$6,$7,$8)`,
      [
        id,
        data.expenditureId,
        data.paymentPlanMonth,
        data.paidOn,
        data.amountInr,
        data.evidenceReference,
        actor.userId,
        actor.role,
      ],
    );
    const posted = rows[0];
    if (!posted) throw new Error("People & Office payment did not return a posted transaction.");
    return {
      ok: true,
      paymentId: posted.payment_id,
      journalId: posted.journal_id,
      paymentPlanMonth: data.paymentPlanMonth,
      newClosingCashLakh: Number(posted.new_closing_cash_lakh),
      actualRevision: Number(posted.actual_revision),
      expenditureStatus: posted.expenditure_status,
    };
  });

export const postFounderReimbursement = createServerFn({ method: "POST" })
  .validator(
    z.object({
      expenditureId: identifier,
      paymentPlanMonth: z.number().int().min(1).max(36),
      reimbursedOn: z.string().date(),
      amountInr: money,
      evidenceReference: reference,
    }),
  )
  .handler(async ({ data }) => {
    const actor = await requireActor("approve");
    const sql = await getSql();
    const id = `FOREIMB-${crypto.randomUUID()}`;
    const rows = await sql.query<{
      reimbursement_id: string;
      journal_id: string;
      new_closing_cash_lakh: number | string;
      actual_revision: number | string;
      expenditure_status: string;
    }>(
      `select * from post_vyndi_founder_reimbursement($1,$2,$3,$4::date,$5,$6,$7,$8)`,
      [
        id,
        data.expenditureId,
        data.paymentPlanMonth,
        data.reimbursedOn,
        data.amountInr,
        data.evidenceReference,
        actor.userId,
        actor.role,
      ],
    );
    const posted = rows[0];
    if (!posted) throw new Error("Founder reimbursement did not return a posted transaction.");
    return {
      ok: true,
      reimbursementId: posted.reimbursement_id,
      journalId: posted.journal_id,
      paymentPlanMonth: data.paymentPlanMonth,
      newClosingCashLakh: Number(posted.new_closing_cash_lakh),
      actualRevision: Number(posted.actual_revision),
      expenditureStatus: posted.expenditure_status,
    };
  });
