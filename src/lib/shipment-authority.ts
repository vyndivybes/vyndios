import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getSql } from "@/lib/db";
import { requireBusinessActor } from "@/lib/business-actor";
import { getCommandRole } from "@/lib/command-access";
import { canPerform } from "@/lib/page-access";
import { postDispatch, reverseDispatch } from "@/lib/dispatch-authority";

const id = z.string().trim().min(1).max(120);
const sourceReference = z.string().trim().min(1).max(500);
const month = z.number().int().min(1).max(36);
const optionalText = z.string().trim().max(1000).optional();

export type ShipmentRecord = {
  id: string;
  salesOrderId: string;
  planMonth: number;
  units: number;
  status: "posted" | "reversed";
  sourceReference: string;
};
export type InvoiceRecord = {
  id: string;
  shipmentId: string;
  salesOrderId: string;
  planMonth: number;
  units: number;
  aspLakh: number;
  amountLakh: number;
  grossAmountLakh: number;
  taxableValueInr: number;
  gstInr: number;
  taxRatePct: number;
  taxMode: "pending" | "cgst_sgst" | "igst" | "zero_rated" | "exempt";
  taxProfileStatus: "pending" | "complete";
  recipientName: string;
  recipientGstin: string;
  placeOfSupplyCode: string;
  hsnSac: string;
  eInvoiceRequired: boolean;
  irn: string;
  status: "issued" | "void";
  sourceReference: string;
};
export type CollectionRecord = {
  id: string;
  invoiceId: string;
  planMonth: number;
  amountLakh: number;
  status: "posted" | "reversed";
  sourceReference: string;
};
export type TaxRegistrationRecord = {
  legalName: string;
  tradeName: string;
  gstin: string;
  stateCode: string;
  eInvoiceApplicable: boolean;
};

async function requireView() {
  const role = await getCommandRole();
  if (!role || !canPerform(role, "view")) throw new Error("Shipment/revenue view permission denied.");
}

export const listShipmentRevenueLedger = createServerFn({ method: "GET" }).handler(async () => {
  await requireView();
  const sql = await getSql();
  const shipments = await sql.query<Record<string, unknown>>(
    `select id,sales_order_id,plan_month,units,status,source_reference from vyndi_shipments order by plan_month,id`,
  );
  const invoices = await sql.query<Record<string, unknown>>(
    `select id,shipment_id,sales_order_id,plan_month,units,asp_lakh,amount_lakh,status,source_reference,
      taxable_value_inr,gst_inr,gross_amount_inr,tax_rate_pct,tax_mode,tax_profile_status,
      recipient_name,recipient_gstin,place_of_supply_code,hsn_sac,e_invoice_required,irn
      from vyndi_invoices order by plan_month,id`,
  );
  const collections = await sql.query<Record<string, unknown>>(
    `select id,invoice_id,plan_month,amount_lakh,status,source_reference from vyndi_collections order by plan_month,id`,
  );
  const registration = await sql.query<Record<string, unknown>>(
    `select legal_name,trade_name,gstin,state_code,e_invoice_applicable from epr_finance_tax_registration where id='PRIMARY'`,
  );
  const taxRow = registration[0];
  return {
    shipments: shipments.map((r) => ({ id:String(r.id),salesOrderId:String(r.sales_order_id),planMonth:Number(r.plan_month),units:Number(r.units),status:r.status as ShipmentRecord["status"],sourceReference:String(r.source_reference) })),
    invoices: invoices.map((r) => {
      const amountLakh = Number(r.amount_lakh);
      const grossAmountInr = Number(r.gross_amount_inr ?? 0);
      return {
        id:String(r.id),shipmentId:String(r.shipment_id),salesOrderId:String(r.sales_order_id),planMonth:Number(r.plan_month),units:Number(r.units),
        aspLakh:Number(r.asp_lakh),amountLakh,grossAmountLakh:grossAmountInr>0?grossAmountInr/100000:amountLakh,
        taxableValueInr:Number(r.taxable_value_inr ?? amountLakh*100000),gstInr:Number(r.gst_inr ?? 0),taxRatePct:Number(r.tax_rate_pct ?? 0),
        taxMode:String(r.tax_mode ?? "pending") as InvoiceRecord["taxMode"],taxProfileStatus:String(r.tax_profile_status ?? "pending") as InvoiceRecord["taxProfileStatus"],
        recipientName:String(r.recipient_name ?? ""),recipientGstin:String(r.recipient_gstin ?? ""),placeOfSupplyCode:String(r.place_of_supply_code ?? ""),
        hsnSac:String(r.hsn_sac ?? ""),eInvoiceRequired:Boolean(r.e_invoice_required),irn:String(r.irn ?? ""),
        status:r.status as InvoiceRecord["status"],sourceReference:String(r.source_reference),
      };
    }),
    collections: collections.map((r) => ({ id:String(r.id),invoiceId:String(r.invoice_id),planMonth:Number(r.plan_month),amountLakh:Number(r.amount_lakh),status:r.status as CollectionRecord["status"],sourceReference:String(r.source_reference) })),
    taxRegistration: taxRow ? {
      legalName:String(taxRow.legal_name),tradeName:String(taxRow.trade_name ?? ""),gstin:String(taxRow.gstin),stateCode:String(taxRow.state_code),
      eInvoiceApplicable:Boolean(taxRow.e_invoice_applicable),
    } satisfies TaxRegistrationRecord : null,
  };
});

/** @deprecated Shipment execution is Operations-owned; compatibility alias retained for current callers. */
export const postShipment = postDispatch;
/** @deprecated Shipment execution is Operations-owned; compatibility alias retained for current callers. */
export const reverseShipment = reverseDispatch;

export const issueInvoice = createServerFn({ method: "POST" })
  .validator(z.object({
    id,
    shipmentId:id,
    sourceReference,
    recipientName:z.string().trim().min(2).max(250),
    recipientGstin:z.string().trim().toUpperCase().max(15).optional(),
    recipientAddress:z.string().trim().min(5).max(1000),
    deliveryAddress:z.string().trim().min(5).max(1000),
    placeOfSupplyCode:z.string().trim().regex(/^[0-9]{2}$/),
    hsnSac:z.string().trim().min(2).max(20),
    itemDescription:z.string().trim().min(2).max(500),
    unitCode:z.string().trim().min(1).max(20).default("NOS"),
    taxRatePct:z.number().finite().min(0).max(100),
    taxMode:z.enum(["cgst_sgst","igst","zero_rated","exempt"]),
    reverseCharge:z.boolean().default(false),
    eInvoiceRequired:z.boolean().default(false),
    irn:optionalText,
    irnAckNumber:optionalText,
    irnAckAt:optionalText,
    taxEvidenceReference:sourceReference,
  }))
  .handler(async ({ data }) => {
    const actor = await requireBusinessActor("edit");
    if (data.eInvoiceRequired && (!data.irn || !data.irnAckNumber || !data.irnAckAt)) {
      throw new Error("IRN, acknowledgement number and acknowledgement timestamp are required for an e-invoice.");
    }
    const sql = await getSql();
    const rows = await sql.query<{ invoice_id:string; amount_lakh:number|string; gross_amount_inr:number|string }>(
      `select * from issue_vyndi_tax_invoice($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::timestamptz,$19,$20,$21)`,
      [data.id,data.shipmentId,data.sourceReference,data.recipientName,data.recipientGstin ?? null,
       data.recipientAddress,data.deliveryAddress,data.placeOfSupplyCode,data.hsnSac,data.itemDescription,data.unitCode,
       data.taxRatePct,data.taxMode,data.reverseCharge,data.eInvoiceRequired,data.irn || null,data.irnAckNumber || null,
       data.irnAckAt || null,data.taxEvidenceReference,actor.userId,actor.role],
    );
    if (!rows[0]) throw new Error("Tax invoice issue did not return a controlled record.");
    return { id:rows[0].invoice_id, amountLakh:Number(rows[0].amount_lakh), grossAmountInr:Number(rows[0].gross_amount_inr) };
  });

export const voidInvoice = createServerFn({ method: "POST" })
  .validator(z.object({ id, reason:z.string().trim().min(1).max(500) }))
  .handler(async ({ data }) => {
    const actor = await requireBusinessActor("edit");
    const sql = await getSql();
    const rows = await sql.query<{ revision:number|string }>(`select void_vyndi_invoice($1,$2,$3,$4) as revision`,[data.id,data.reason,actor.userId,actor.role]);
    return { id:data.id, revision:Number(rows[0]?.revision ?? 0) };
  });

export const postCollection = createServerFn({ method: "POST" })
  .validator(z.object({ id, invoiceId:id, planMonth:month, amountLakh:z.number().positive(), sourceReference }))
  .handler(async ({ data }) => {
    const actor = await requireBusinessActor("edit");
    const sql = await getSql();
    const rows = await sql.query<{ post_vyndi_collection:string }>(`select post_vyndi_collection($1,$2,$3,$4,$5,$6,$7)`,[data.id,data.invoiceId,data.planMonth,data.amountLakh,data.sourceReference,actor.userId,actor.role]);
    return { id:rows[0]?.post_vyndi_collection ?? data.id };
  });

export const reverseCollection = createServerFn({ method: "POST" })
  .validator(z.object({ id, reason:z.string().trim().min(1).max(500) }))
  .handler(async ({ data }) => {
    const actor = await requireBusinessActor("edit");
    const sql = await getSql();
    const rows = await sql.query<{ revision:number|string }>(`select reverse_vyndi_collection($1,$2,$3,$4) as revision`,[data.id,data.reason,actor.userId,actor.role]);
    return { id:data.id, revision:Number(rows[0]?.revision ?? 0) };
  });
