import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireBusinessActor } from "@/lib/business-actor";
import { getCommandRole } from "@/lib/command-access";
import { getSql, type SqlRow } from "@/lib/db";
import { canPerform } from "@/lib/page-access";
import { getRouteMeta } from "@/lib/page-metadata";

const route = "/command/payables";
const id = z.string().trim().min(1).max(160);
const reference = z.string().trim().min(1).max(500);

async function requireView() {
  const role = await getCommandRole();
  if (!role || !canPerform(role, "view", getRouteMeta(route))) {
    throw new Error("Supplier-payment view permission denied.");
  }
  return role;
}

async function requireActor(permission: "edit" | "approve") {
  const actor = await requireBusinessActor(permission);
  if (!canPerform(actor.role, permission, getRouteMeta(route))) {
    throw new Error(`Supplier-payment ${permission} permission denied.`);
  }
  return actor;
}

export const getSupplierPaymentHistory = createServerFn({ method: "GET" }).handler(async () => {
  await requireView();
  const sql = await getSql();
  return sql.query<SqlRow>(`
    select p.id,p.supplier_invoice_id,p.plan_month,p.paid_on::text as paid_on,p.amount_inr,
           p.source_reference,p.cash_evidence_reference,p.journal_id,p.cash_actual_revision,
           p.new_closing_cash_lakh,p.status,p.revision,p.reversed_by,p.reversed_at::text as reversed_at,
           p.reversal_reason,p.cash_reversal_revision,p.reversed_closing_cash_lakh,p.created_by,
           p.created_at::text as created_at,i.invoice_number,s.name as supplier_name
      from vyndi_supplier_payments p
      join vyndi_supplier_invoices i on i.id=p.supplier_invoice_id
      join vyndi_purchase_orders po on po.id=i.purchase_order_id
      join vyndi_suppliers s on s.id=po.supplier_id
     order by p.created_at desc,p.id desc
     limit 500`);
});

export const postSupplierPaymentCash = createServerFn({ method: "POST" })
  .validator(z.object({
    id,
    supplierInvoiceId: id,
    paymentPlanMonth: z.number().int().min(1).max(36),
    paidOn: z.string().date(),
    amountInr: z.number().positive().max(1_000_000_000_000),
    sourceReference: reference,
  }))
  .handler(async ({ data }) => {
    const actor = await requireActor("edit");
    const sql = await getSql();
    const rows = await sql.query<{
      payment_id: string;
      journal_id: string;
      new_closing_cash_lakh: number | string;
      actual_revision: number | string;
      invoice_status: string;
    }>(
      `select * from post_vyndi_supplier_payment($1,$2,$3,$4::date,$5,$6,$7,$8)`,
      [
        data.id.toUpperCase(),
        data.supplierInvoiceId,
        data.paymentPlanMonth,
        data.paidOn,
        data.amountInr,
        data.sourceReference,
        actor.userId,
        actor.role,
      ],
    );
    if (!rows[0]) throw new Error("Supplier payment did not return a controlled cash result.");
    return {
      ok: true,
      id: rows[0].payment_id,
      journalId: rows[0].journal_id,
      newClosingCashLakh: Number(rows[0].new_closing_cash_lakh),
      actualRevision: Number(rows[0].actual_revision),
      invoiceStatus: rows[0].invoice_status,
    };
  });

export const reverseSupplierPaymentCash = createServerFn({ method: "POST" })
  .validator(z.object({
    id,
    reversedOn: z.string().date(),
    reason: reference,
  }))
  .handler(async ({ data }) => {
    const actor = await requireActor("approve");
    const sql = await getSql();
    const rows = await sql.query<{ reverse_vyndi_supplier_payment: number | string }>(
      `select reverse_vyndi_supplier_payment($1,$2::date,$3,$4,$5)`,
      [data.id, data.reversedOn, data.reason, actor.userId, actor.role],
    );
    return { ok: true, id: data.id, revision: Number(rows[0]?.reverse_vyndi_supplier_payment ?? 0) };
  });
