import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireBusinessActor } from "@/lib/business-actor";
import { getCommandRole } from "@/lib/command-access";
import { getSql, type SqlRow } from "@/lib/db";
import { canPerform } from "@/lib/page-access";
import { getRouteMeta } from "@/lib/page-metadata";

const permissionRoute = "/command/finance-control";
const id = z.string().trim().min(1).max(160);

async function requireView() {
  const role = await getCommandRole();
  if (!role || !canPerform(role, "view", getRouteMeta(permissionRoute))) {
    throw new Error("Input-tax control view permission denied.");
  }
}

async function requireEdit() {
  const actor = await requireBusinessActor("edit");
  if (!canPerform(actor.role, "edit", getRouteMeta(permissionRoute))) {
    throw new Error("Input-tax control edit permission denied.");
  }
  return actor;
}

export const getInputTaxControl = createServerFn({ method: "GET" }).handler(async () => {
  await requireView();
  const sql = await getSql();
  const invoices = await sql.query<SqlRow>(`
    select i.id,i.purchase_order_id,i.invoice_number,i.invoice_on::text as invoice_on,
           i.amount_ex_gst_inr,i.gst_inr,i.status,i.source_reference,
           i.supplier_gstin,i.hsn_sac,i.tax_rate_pct,i.cgst_inr,i.sgst_inr,i.igst_inr,i.cess_inr,
           i.itc_eligible,i.itc_control_status,i.itc_evidence_reference,i.gstr2b_reference,
           s.name as supplier_name
      from vyndi_supplier_invoices i
      join vyndi_purchase_orders p on p.id=i.purchase_order_id
      join vyndi_suppliers s on s.id=p.supplier_id
     where i.gst_inr>0
     order by case i.itc_control_status when 'pending' then 0 when 'verified' then 1 else 2 end,
              i.invoice_on desc,i.id
  `);
  return { invoices };
});

export const classifySupplierInvoiceItc = createServerFn({ method: "POST" })
  .validator(z.object({
    id,
    supplierGstin: z.string().trim().toUpperCase().max(15).optional(),
    hsnSac: z.string().trim().max(20).optional(),
    taxRatePct: z.number().finite().min(0).max(100),
    cgstInr: z.number().finite().min(0).max(1_000_000_000_000),
    sgstInr: z.number().finite().min(0).max(1_000_000_000_000),
    igstInr: z.number().finite().min(0).max(1_000_000_000_000),
    cessInr: z.number().finite().min(0).max(1_000_000_000_000),
    itcEligible: z.boolean(),
    itcEvidenceReference: z.string().trim().max(500).optional(),
    gstr2bReference: z.string().trim().max(500).optional(),
  }))
  .handler(async ({ data }) => {
    const actor = await requireEdit();
    if (data.itcEligible && !data.itcEvidenceReference) {
      throw new Error("Eligible ITC requires an evidence reference.");
    }
    const componentTotal = data.cgstInr + data.sgstInr + data.igstInr + data.cessInr;
    const sql = await getSql();
    const [invoice] = await sql.query<{ gst_inr: number | string; status: string }>(
      `select gst_inr,status from vyndi_supplier_invoices where id=$1`, [data.id],
    );
    if (!invoice) throw new Error("Supplier invoice not found.");
    if (Math.abs(componentTotal - Number(invoice.gst_inr)) > 0.01) {
      throw new Error(`Tax component total ${componentTotal.toFixed(2)} does not equal supplier invoice GST ${Number(invoice.gst_inr).toFixed(2)}.`);
    }
    await sql.query(
      `select set_vyndi_supplier_invoice_itc_profile($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [data.id,data.supplierGstin ?? null,data.hsnSac ?? null,data.taxRatePct,
       data.cgstInr,data.sgstInr,data.igstInr,data.cessInr,data.itcEligible,
       data.itcEvidenceReference ?? null,data.gstr2bReference ?? null,actor.userId,actor.role],
    );
    return { ok: true, id: data.id, itcEligible: data.itcEligible };
  });
