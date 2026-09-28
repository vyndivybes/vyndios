import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireBusinessActor } from "@/lib/business-actor";
import { getCommandRole } from "@/lib/command-access";
import { getSql, type SqlRow } from "@/lib/db";
import { canPerform } from "@/lib/page-access";
import { getRouteMeta } from "@/lib/page-metadata";

const PERMISSION_ROUTE = "/command/accounting";
const identifier = z.string().trim().min(1).max(160);
const reference = z.string().trim().min(3).max(500);
const money = z.number().finite().positive().max(1_000_000_000_000);

export const PEOPLE_OFFICE_ACTUAL_SOURCE_TYPES = ["cost_item", "asset", "manual_expense"] as const;
export const PEOPLE_OFFICE_FUNDING_SOURCES = ["company_bank", "founder_personal"] as const;
export const FOUNDER_PERSONAL = "founder_personal" as const;

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
  const [costItems, assets, expenditures, payments, founderReimbursements, cashAuthority] = await Promise.all([
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
      select plan_month,closing_cash_lakh,source_reference,verified
        from vyndi_cash_authority
       where verified=true
       order by plan_month desc
    `),
  ]);
  return { costItems, assets, expenditures, payments, founderReimbursements, cashAuthority };
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
    }),
  )
  .handler(async ({ data }) => {
    const actor = await requireActor("edit");
    const sql = await getSql();
    const id = `POEXP-${crypto.randomUUID()}`;
    const rows = await sql.query<{ create_vyndi_people_office_actual_expenditure_v3: string }>(
      `select create_vyndi_people_office_actual_expenditure_v3($1,$2,$3,$4,$5::date,$6,$7,$8,$9,$10,$11,$12)`,
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
    return { ok: true, id: rows[0]?.create_vyndi_people_office_actual_expenditure_v3 ?? id };
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
    await sql.query(`select approve_vyndi_people_office_actual_expenditure_v3($1,$2,$3,$4)`, [
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
