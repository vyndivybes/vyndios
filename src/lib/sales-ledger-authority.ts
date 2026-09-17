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

export type SalesLedgerRow = {
  invoice_id: string;
  issued_on: string;
  plan_month: number;
  sale_type: "bicycle" | "spare_component";
  channel: string;
  customer_name: string;
  customer_gstin: string;
  sales_order_id: string;
  shipment_id: string;
  spare_sale_id: string;
  item_reference: string;
  item_description: string;
  quantity: number;
  unit_code: string;
  vyndi_identity: string;
  oem_part_number: string;
  oem_serial_number: string;
  supplier_lot: string;
  allocation_identity_refs: string;
  taxable_value_inr: number;
  gst_inr: number;
  gross_amount_inr: number;
  collected_inr: number;
  balance_inr: number;
  payment_status: string;
  credit_terms_days: number | null;
  due_on: string;
  aging_bucket: string;
  fifo_cogs_inr: number | null;
  gross_margin_inr: number | null;
  invoice_status: string;
  source_reference: string;
};

export type SpareSaleRow = {
  id: string;
  plan_month: number;
  sku: string;
  item_name: string;
  unit: string;
  quantity: number;
  unit_price_inr: number;
  channel: string;
  traceability_class: "A" | "B" | "C";
  selected_identity_uid: string;
  allocated_identity_refs: string;
  fifo_cost_inr: number;
  status: "dispatched" | "reversed";
  source_reference: string;
  dispatch_on: string;
  posted_at: string;
  invoice_id: string;
  invoice_status: string;
};

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

const nullableNumber = (value: unknown) => (value == null ? null : Number(value));

function toSalesLedgerRow(row: Record<string, unknown>): SalesLedgerRow {
  return {
    invoice_id: String(row.invoice_id),
    issued_on: String(row.issued_on ?? ""),
    plan_month: Number(row.plan_month),
    sale_type: String(row.sale_type) as SalesLedgerRow["sale_type"],
    channel: String(row.channel ?? ""),
    customer_name: String(row.customer_name ?? ""),
    customer_gstin: String(row.customer_gstin ?? ""),
    sales_order_id: String(row.sales_order_id ?? ""),
    shipment_id: String(row.shipment_id ?? ""),
    spare_sale_id: String(row.spare_sale_id ?? ""),
    item_reference: String(row.item_reference ?? ""),
    item_description: String(row.item_description ?? ""),
    quantity: Number(row.quantity ?? 0),
    unit_code: String(row.unit_code ?? ""),
    vyndi_identity: String(row.vyndi_identity ?? ""),
    oem_part_number: String(row.oem_part_number ?? ""),
    oem_serial_number: String(row.oem_serial_number ?? ""),
    supplier_lot: String(row.supplier_lot ?? ""),
    allocation_identity_refs: JSON.stringify(row.allocation_identity_refs ?? []),
    taxable_value_inr: Number(row.taxable_value_inr ?? 0),
    gst_inr: Number(row.gst_inr ?? 0),
    gross_amount_inr: Number(row.gross_amount_inr ?? 0),
    collected_inr: Number(row.collected_inr ?? 0),
    balance_inr: Number(row.balance_inr ?? 0),
    payment_status: String(row.payment_status ?? ""),
    credit_terms_days: nullableNumber(row.credit_terms_days),
    due_on: String(row.due_on ?? ""),
    aging_bucket: String(row.aging_bucket ?? ""),
    fifo_cogs_inr: nullableNumber(row.fifo_cogs_inr),
    gross_margin_inr: nullableNumber(row.gross_margin_inr),
    invoice_status: String(row.invoice_status ?? ""),
    source_reference: String(row.source_reference ?? ""),
  };
}

function toSpareSaleRow(row: Record<string, unknown>): SpareSaleRow {
  return {
    id: String(row.id),
    plan_month: Number(row.plan_month),
    sku: String(row.sku),
    item_name: String(row.item_name),
    unit: String(row.unit),
    quantity: Number(row.quantity),
    unit_price_inr: Number(row.unit_price_inr),
    channel: String(row.channel),
    traceability_class: String(row.traceability_class ?? "C") as SpareSaleRow["traceability_class"],
    selected_identity_uid: String(row.selected_identity_uid ?? ""),
    allocated_identity_refs: JSON.stringify(row.allocated_identity_refs ?? []),
    fifo_cost_inr: Number(row.fifo_cost_inr ?? 0),
    status: String(row.status) as SpareSaleRow["status"],
    source_reference: String(row.source_reference ?? ""),
    dispatch_on: String(row.dispatch_on ?? ""),
    posted_at: String(row.posted_at ?? ""),
    invoice_id: String(row.invoice_id ?? ""),
    invoice_status: String(row.invoice_status ?? ""),
  };
}

export const getSalesLedgerWorkspace = createServerFn({ method: "GET" })
  .middleware([optionalAuthMiddleware])
  .handler(async ({ context }) => {
    await requireBusinessActor("view", actorInput(context));
    const sql = await getSql();
    const [ledger, spareSales, inventory, identities] = await Promise.all([
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
    ]);

    return {
      ledger: ledger.map(toSalesLedgerRow),
      spareSales: spareSales.map(toSpareSaleRow),
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
