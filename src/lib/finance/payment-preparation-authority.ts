import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireBusinessActor } from "@/lib/business-actor";
import { getSql } from "@/lib/db";
import { canPerform } from "@/lib/page-access";
import { getRouteMeta } from "@/lib/page-metadata";

const route = "/command/finance-control";
const id = z.string().trim().min(1).max(160);
const reference = z.string().trim().min(1).max(500);

async function requireFinance(permission: "edit" | "approve") {
  const actor = await requireBusinessActor(permission);
  if (!canPerform(actor.role, permission, getRouteMeta(route))) {
    throw new Error(`Supplier-payment ${permission} permission denied.`);
  }
  return actor;
}

export const prepareSupplierPayment = createServerFn({ method: "POST" })
  .validator(z.object({
    id,
    idempotencyKey: z.string().trim().min(8).max(300),
    supplierInvoiceId: id,
    paymentPlanMonth: z.number().int().min(1).max(36),
    proposedPaidOn: z.string().date(),
    amountInr: z.number().finite().positive().max(1_000_000_000_000),
    sourceReference: reference,
    notes: z.string().trim().max(1000).optional(),
  }))
  .handler(async ({ data }) => {
    const actor = await requireFinance("edit");
    const sql = await getSql();
    const rows = await sql.query<{
      payment_preparation_id: string;
      record_revision: number | string;
      status: string;
      open_payable_inr: number | string;
    }>(
      `select * from prepare_vyndi_supplier_payment($1,$2,$3,$4,$5::date,$6,$7,$8,$9,$10)`,
      [
        data.id,
        data.idempotencyKey,
        data.supplierInvoiceId,
        data.paymentPlanMonth,
        data.proposedPaidOn,
        data.amountInr,
        data.sourceReference,
        data.notes ?? "",
        actor.userId,
        actor.role,
      ],
    );
    const row = rows[0];
    if (!row) throw new Error("Supplier-payment preparation did not return a controlled receipt.");
    return {
      ok: true,
      id: row.payment_preparation_id,
      recordRevision: Number(row.record_revision),
      status: row.status,
      openPayableInr: Number(row.open_payable_inr),
    };
  });

export const approveSupplierPaymentPreparation = createServerFn({ method: "POST" })
  .validator(z.object({
    id,
    expectedRevision: z.number().int().positive(),
    sourceReference: reference,
  }))
  .handler(async ({ data }) => {
    const actor = await requireFinance("approve");
    const sql = await getSql();
    const rows = await sql.query<{
      payment_preparation_id: string;
      record_revision: number | string;
      status: string;
    }>(
      `select * from approve_vyndi_supplier_payment_preparation($1,$2,$3,$4,$5)`,
      [data.id, data.expectedRevision, data.sourceReference, actor.userId, actor.role],
    );
    const row = rows[0];
    if (!row) throw new Error("Supplier-payment approval did not return a controlled receipt.");
    return {
      ok: true,
      id: row.payment_preparation_id,
      recordRevision: Number(row.record_revision),
      status: row.status,
    };
  });

export const executeSupplierPaymentPreparation = createServerFn({ method: "POST" })
  .validator(z.object({
    id,
    expectedRevision: z.number().int().positive(),
    bankEvidenceReference: reference,
  }))
  .handler(async ({ data }) => {
    const actor = await requireFinance("approve");
    const sql = await getSql();
    const rows = await sql.query<{
      payment_preparation_id: string;
      payment_id: string;
      record_revision: number | string;
      invoice_status: string;
    }>(
      `select * from execute_vyndi_supplier_payment_preparation($1,$2,$3,$4,$5)`,
      [data.id, data.expectedRevision, data.bankEvidenceReference, actor.userId, actor.role],
    );
    const row = rows[0];
    if (!row) throw new Error("Supplier-payment execution did not return a controlled receipt.");
    return {
      ok: true,
      id: row.payment_preparation_id,
      paymentId: row.payment_id,
      recordRevision: Number(row.record_revision),
      invoiceStatus: row.invoice_status,
    };
  });
