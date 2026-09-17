import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware, optionalAuthMiddleware } from "@/lib/auth/middleware";
import { requireBusinessActor } from "@/lib/business-actor";
import { getSql } from "@/lib/db";

const id = z.string().trim().min(1).max(120);
const reference = z.string().trim().min(1).max(500);
const optionalText = z.string().trim().max(1000).optional();

const actorInput = (context: { userId?: string | null; userEmail?: string | null }) =>
  context.userId ? { userId: context.userId, email: context.userEmail ?? undefined } : undefined;

export type SalesLedgerRow = Record<string, unknown>;
export type SpareInventoryOption = {
  id: string;
  sku: string;
  name: string;
  category: string;
  unit: string;
  traceabilityClass: "A" | "B" | "C";
  availableToPromise: number;
  physicalQuantity: number;
  reservedQuantity: number;
};
export type SpareIdentityOption = {
  identityUid: string;
  visibleId: string;
  partSku: string;
  identityKind: string;
  manufacturer: string;
  brand: string;
  oemPartNumber: string;
  oemSerialNumber: string;
  supplierLot: string;
};

export const getSalesLedgerWorkspace = createServerFn({ method: "GET" })
  .middleware([optionalAuthMiddleware])
  .handler(async ({ context }) => {
    await requireBusinessActor("view", actorInput(context));
    const sql = await getSql();
    const [ledger, spareSales, inventory, identities, summary] = await Promise.all([
      sql.query<Record<string, unknown>>(
        `select * from vyndi_report_sales_ledger order by issued_on desc,invoice_id desc`,
      ),
      sql.query<Record<string, unknown>>(
        `select s.id,s.plan_month,s.sku,s.item_name,s.unit,s.quantity,s.unit_price_inr,s.channel,
                s.traceability_class,s.selected_identity_uid,s.allocated_identity_refs,s.fifo_cost_inr,
                s.status,s.source_reference,s.dispatch_on::text as dispatch_on,s.posted_at::text as posted_at,
                i.id as invoice_id,i.status as invoice_status
           from vyndi_spare_sales s
           left join vyndi_invoices i on i.spare_sale_id=s.id
          order by s.dispatch_on desc,s.id desc`,
      ),
      sql.query<Record<string, unknown>>(
        `select i.id,i.sku,i.name,i.category,vyndi_canonical_unit(i.unit) as unit,i.traceability_class,
                coalesce(a.physical_quantity,0) as physical_quantity,
                coalesce(a.reserved_quantity,0) as reserved_quantity,
                coalesce(a.available_to_promise,0) as available_to_promise
           from master_inventory_items i
           left join vyndi_inventory_available_to_promise a
             on a.sku=i.sku and a.unit=vyndi_canonical_unit(i.unit)
          where i.active=true and i.ledger_id='components'
          order by i.category,i.name,i.sku`,
      ),
      sql.query<Record<string, unknown>>(
        `select identity_uid::text,visible_id,part_sku,identity_kind,manufacturer,brand,
                oem_part_number,oem_serial_number,supplier_lot
           from vyndi_identity_registry
          where status='active' and part_sku<>''
          order by part_sku,visible_id`,
      ),
      sql.query<Record<string, unknown>>(
        `select sale_type,
                count(*) filter(where invoice_status='issued')::int as invoice_count,
                coalesce(sum(taxable_value_inr) filter(where invoice_status='issued'),0) as taxable_sales_inr,
                coalesce(sum(gst_inr) filter(where invoice_status='issued'),0) as output_gst_inr,
                coalesce(sum(gross_amount_inr) filter(where invoice_status='issued'),0) as gross_sales_inr,
                coalesce(sum(collected_inr) filter(where invoice_status='issued'),0) as collected_inr,
                coalesce(sum(balance_inr) filter(where invoice_status='issued'),0) as open_receivable_inr
           from vyndi_report_sales_ledger
          group by sale_type
          order by sale_type`,
      ),
    ]);

    return {
      ledger,
      spareSales,
      inventory: inventory.map((row) => ({
        id: String(row.id),
        sku: String(row.sku),
        name: String(row.name),
        category: String(row.category),
        unit: String(row.unit),
        traceabilityClass: String(row.traceability_class ?? "C") as SpareInventoryOption["traceabilityClass"],
        availableToPromise: Number(row.available_to_promise ?? 0),
        physicalQuantity: Number(row.physical_quantity ?? 0),
        reservedQuantity: Number(row.reserved_quantity ?? 0),
      })) satisfies SpareInventoryOption[],
      identities: identities.map((row) => ({
        identityUid: String(row.identity_uid),
        visibleId: String(row.visible_id),
        partSku: String(row.part_sku),
        identityKind: String(row.identity_kind),
        manufacturer: String(row.manufacturer ?? ""),
        brand: String(row.brand ?? ""),
        oemPartNumber: String(row.oem_part_number ?? ""),
        oemSerialNumber: String(row.oem_serial_number ?? ""),
        supplierLot: String(row.supplier_lot ?? ""),
      })) satisfies SpareIdentityOption[],
      summary,
    };
  });

export const postSpareSaleDispatch = createServerFn({ method: "POST" })
  .validator(
    z.object({
      id,
      planMonth: z.number().int().min(1).max(36),
      inventoryItemId: id,
      quantity: z.number().positive(),
      unitPriceInr: z.number().positive(),
      channel: z.enum(["direct", "dealer", "online"]),
      dispatchOn: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
      sourceReference: reference,
      selectedIdentityUid: z.string().uuid().optional(),
    }),
  )
  .middleware([authMiddleware])
  .handler(async ({ data, context }) => {
    const actor = await requireBusinessActor("edit", actorInput(context));
    const sql = await getSql();
    const rows = await sql.query<{
      spare_sale_id: string;
      resulting_balance: number | string;
      fifo_cost_inr: number | string;
    }>(
      `select * from post_vyndi_spare_sale_dispatch($1,$2,$3,$4,$5,$6,$7::date,$8,$9::uuid,$10,$11)`,
      [
        data.id,
        data.planMonth,
        data.inventoryItemId,
        data.quantity,
        data.unitPriceInr,
        data.channel,
        data.dispatchOn,
        data.sourceReference,
        data.selectedIdentityUid ?? null,
        actor.userId,
        actor.role,
      ],
    );
    const row = rows[0];
    if (!row) throw new Error("Spare/component dispatch did not return a controlled receipt.");
    return {
      id: row.spare_sale_id,
      resultingBalance: Number(row.resulting_balance),
      fifoCostInr: Number(row.fifo_cost_inr),
    };
  });

export const reverseSpareSaleDispatch = createServerFn({ method: "POST" })
  .validator(z.object({ id, reason: z.string().trim().min(1).max(500) }))
  .middleware([authMiddleware])
  .handler(async ({ data, context }) => {
    const actor = await requireBusinessActor("edit", actorInput(context));
    const sql = await getSql();
    const rows = await sql.query<{ revision: number | string }>(
      `select reverse_vyndi_spare_sale_dispatch($1,$2,$3,$4) as revision`,
      [data.id, data.reason, actor.userId, actor.role],
    );
    return { id: data.id, revision: Number(rows[0]?.revision ?? 0) };
  });

export const issueSpareSaleInvoice = createServerFn({ method: "POST" })
  .validator(
    z.object({
      id,
      spareSaleId: id,
      sourceReference: reference,
      recipientName: z.string().trim().min(2).max(250),
      recipientGstin: z.string().trim().toUpperCase().max(15).optional(),
      recipientAddress: z.string().trim().min(5).max(1000),
      deliveryAddress: z.string().trim().min(5).max(1000),
      placeOfSupplyCode: z.string().trim().regex(/^[0-9]{2}$/),
      hsnSac: z.string().trim().min(2).max(20),
      itemDescription: z.string().trim().min(2).max(500),
      unitCode: z.string().trim().min(1).max(20).default("NOS"),
      taxRatePct: z.number().finite().min(0).max(100),
      taxMode: z.enum(["cgst_sgst", "igst", "zero_rated", "exempt"]),
      reverseCharge: z.boolean().default(false),
      eInvoiceRequired: z.boolean().default(false),
      irn: optionalText,
      irnAckNumber: optionalText,
      irnAckAt: optionalText,
      taxEvidenceReference: reference,
      creditTermsDays: z.number().int().min(0).max(365),
      creditTermsReference: reference,
    }),
  )
  .middleware([authMiddleware])
  .handler(async ({ data, context }) => {
    const actor = await requireBusinessActor("edit", actorInput(context));
    if (data.eInvoiceRequired && (!data.irn || !data.irnAckNumber || !data.irnAckAt)) {
      throw new Error("IRN, acknowledgement number and acknowledgement timestamp are required for an e-invoice.");
    }
    const sql = await getSql();
    const rows = await sql.query<{
      invoice_id: string;
      amount_lakh: number | string;
      gross_amount_inr: number | string;
      due_on: string;
    }>(
      `select * from issue_vyndi_spare_credit_tax_invoice($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::timestamptz,$19,$20,$21,$22,$23)`,
      [
        data.id,
        data.spareSaleId,
        data.sourceReference,
        data.recipientName,
        data.recipientGstin ?? null,
        data.recipientAddress,
        data.deliveryAddress,
        data.placeOfSupplyCode,
        data.hsnSac,
        data.itemDescription,
        data.unitCode,
        data.taxRatePct,
        data.taxMode,
        data.reverseCharge,
        data.eInvoiceRequired,
        data.irn || null,
        data.irnAckNumber || null,
        data.irnAckAt || null,
        data.taxEvidenceReference,
        data.creditTermsDays,
        data.creditTermsReference,
        actor.userId,
        actor.role,
      ],
    );
    const row = rows[0];
    if (!row) throw new Error("Spare/component tax invoice did not return a controlled record.");
    return {
      id: row.invoice_id,
      amountLakh: Number(row.amount_lakh),
      grossAmountInr: Number(row.gross_amount_inr),
      dueOn: String(row.due_on),
    };
  });
