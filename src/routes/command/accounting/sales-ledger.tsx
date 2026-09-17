import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useMemo, useState, type ReactNode } from "react";
import { Kpi, Panel } from "@/components/kpi";
import {
  getSalesLedgerWorkspace,
  issueSpareSaleInvoice,
  postSpareSaleDispatch,
  reverseSpareSaleDispatch,
} from "@/lib/sales-ledger-authority";

export const Route = createFileRoute("/command/accounting/sales-ledger")({
  loader: () => getSalesLedgerWorkspace(),
  component: SalesLedgerWorkspace,
});

const text = (row: Record<string, unknown>, key: string) => String(row[key] ?? "");
const num = (row: Record<string, unknown>, key: string) => Number(row[key] ?? 0);
const money = (value: unknown) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(Number(value ?? 0));
const today = () => new Date().toISOString().slice(0, 10);

type TaxMode = "cgst_sgst" | "igst" | "zero_rated" | "exempt";

function SalesLedgerWorkspace() {
  const data = Route.useLoaderData();
  const router = useRouter();
  const firstItem = data.inventory[0];
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [dispatch, setDispatch] = useState({
    planMonth: 1,
    inventoryItemId: firstItem?.id ?? "",
    quantity: 1,
    unitPriceInr: 0,
    channel: "direct" as "direct" | "dealer" | "online",
    dispatchOn: today(),
    sourceReference: "",
    selectedIdentityUid: "",
  });
  const uninvoiced = data.spareSales.filter((row) => text(row, "status") === "dispatched" && !text(row, "invoice_id"));
  const [invoice, setInvoice] = useState({
    spareSaleId: text(uninvoiced[0] ?? {}, "id"),
    sourceReference: "",
    recipientName: "",
    recipientGstin: "",
    recipientAddress: "",
    deliveryAddress: "",
    placeOfSupplyCode: "",
    hsnSac: "8714",
    itemDescription: "",
    unitCode: "NOS",
    taxRatePct: 18,
    taxMode: "cgst_sgst" as TaxMode,
    creditTermsDays: 0,
    creditTermsReference: "",
    taxEvidenceReference: "",
  });

  const selectedItem = data.inventory.find((item) => item.id === dispatch.inventoryItemId);
  const identityOptions = useMemo(
    () => data.identities.filter((identity) => identity.partSku.toUpperCase() === (selectedItem?.sku ?? "").toUpperCase()),
    [data.identities, selectedItem?.sku],
  );
  const bicycle = data.ledger.filter((row) => text(row, "sale_type") === "bicycle" && text(row, "invoice_status") === "issued");
  const spares = data.ledger.filter((row) => text(row, "sale_type") === "spare_component" && text(row, "invoice_status") === "issued");
  const totalSales = data.ledger
    .filter((row) => text(row, "invoice_status") === "issued")
    .reduce((sum, row) => sum + num(row, "taxable_value_inr"), 0);
  const bicycleSales = bicycle.reduce((sum, row) => sum + num(row, "taxable_value_inr"), 0);
  const spareSales = spares.reduce((sum, row) => sum + num(row, "taxable_value_inr"), 0);
  const openAr = data.ledger
    .filter((row) => text(row, "invoice_status") === "issued")
    .reduce((sum, row) => sum + num(row, "balance_inr"), 0);

  async function run(task: () => Promise<unknown>, success: string) {
    setBusy(true);
    setMessage("");
    try {
      await task();
      setMessage(success);
      await router.invalidate();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Sales action could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  async function createSpareDispatch() {
    if (!selectedItem) return;
    const saleId = `SP-${crypto.randomUUID()}`;
    await run(
      () =>
        postSpareSaleDispatch({
          data: {
            id: saleId,
            planMonth: dispatch.planMonth,
            inventoryItemId: selectedItem.id,
            quantity: dispatch.quantity,
            unitPriceInr: dispatch.unitPriceInr,
            channel: dispatch.channel,
            dispatchOn: dispatch.dispatchOn,
            sourceReference: dispatch.sourceReference,
            selectedIdentityUid: dispatch.selectedIdentityUid || undefined,
          },
        }),
      `${saleId} posted as a controlled spare/component dispatch. FIFO inventory and COGS were posted; revenue is not recognized until invoice issue.`,
    );
  }

  async function createSpareInvoice() {
    const sale = data.spareSales.find((row) => text(row, "id") === invoice.spareSaleId);
    if (!sale) return;
    const invoiceId = `INV-SP-${crypto.randomUUID()}`;
    await run(
      () =>
        issueSpareSaleInvoice({
          data: {
            id: invoiceId,
            spareSaleId: invoice.spareSaleId,
            sourceReference: invoice.sourceReference,
            recipientName: invoice.recipientName,
            recipientGstin: invoice.recipientGstin || undefined,
            recipientAddress: invoice.recipientAddress,
            deliveryAddress: invoice.deliveryAddress,
            placeOfSupplyCode: invoice.placeOfSupplyCode,
            hsnSac: invoice.hsnSac,
            itemDescription: invoice.itemDescription || `${text(sale, "item_name")} · ${text(sale, "sku")}`,
            unitCode: invoice.unitCode,
            taxRatePct: invoice.taxMode === "zero_rated" || invoice.taxMode === "exempt" ? 0 : invoice.taxRatePct,
            taxMode: invoice.taxMode,
            reverseCharge: false,
            eInvoiceRequired: false,
            taxEvidenceReference: invoice.taxEvidenceReference,
            creditTermsDays: invoice.creditTermsDays,
            creditTermsReference: invoice.creditTermsReference,
          },
        }),
      `${invoiceId} issued. Sales Ledger, GST, Trade Receivable and credit due date are now transaction-derived from the invoice.`,
    );
  }

  async function reverseDispatch(row: Record<string, unknown>) {
    const reason = window.prompt("Controlled reversal reason", "")?.trim();
    if (!reason) return;
    await run(
      () => reverseSpareSaleDispatch({ data: { id: text(row, "id"), reason } }),
      `${text(row, "id")} reversed. Inventory was returned at governed FIFO cost and the COGS journal was reversed.`,
    );
  }

  return (
    <main className="mx-auto max-w-7xl space-y-6">
      <header className="flex flex-col gap-4 border-b border-border pb-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-green">Finance · actual invoiced sales authority</p>
          <h1 className="mt-2 font-display text-4xl text-accent">Sales Ledger</h1>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-muted">
            One actual-sales register for complete bicycles and spare/components. Leads, forecasts and un-invoiced orders are excluded.
            Spare sales reuse Master Inventory, FIFO costing and controlled identity lineage; OEM identities remain unchanged.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/command/sales" className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-muted hover:border-accent hover:text-accent">Demand & Orders</Link>
          <Link to="/command/receivables" className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-muted hover:border-accent hover:text-accent">Receivables & Collections</Link>
          <Link to="/command/accounting" className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-muted hover:border-accent hover:text-accent">Accounting</Link>
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Actual taxable sales" value={money(totalSales)} hint="Issued invoices only" />
        <Kpi label="Bicycle sales" value={money(bicycleSales)} hint={`${bicycle.length} issued invoice(s)`} />
        <Kpi label="Spare/component sales" value={money(spareSales)} hint={`${spares.length} issued invoice(s)`} />
        <Kpi label="Open receivable" value={money(openAr)} hint="Gross invoice less posted collections" tone={openAr > 0 ? "warn" : "ok"} />
      </div>

      {message ? <div role="status" className="rounded-lg border border-border bg-surface px-4 py-3 text-sm text-muted">{message}</div> : null}

      <Panel title="Spare / component dispatch" kicker="Master Inventory → FIFO issue → COGS · no production job card">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Field label="Plan month"><input className="control mt-1.5" type="number" min="1" max="36" value={dispatch.planMonth} onChange={(e) => setDispatch({ ...dispatch, planMonth: Number(e.target.value) })} /></Field>
          <Field label="Component / spare">
            <select className="control mt-1.5" value={dispatch.inventoryItemId} onChange={(e) => setDispatch({ ...dispatch, inventoryItemId: e.target.value, selectedIdentityUid: "" })}>
              <option value="">Select controlled component</option>
              {data.inventory.map((item) => <option key={item.id} value={item.id}>{item.sku} · {item.name} · ATP {item.availableToPromise}</option>)}
            </select>
          </Field>
          <Field label="Quantity"><input className="control mt-1.5" type="number" min="0.0001" step="0.0001" value={dispatch.quantity} onChange={(e) => setDispatch({ ...dispatch, quantity: Number(e.target.value) })} /></Field>
          <Field label="Unit sale price · ₹"><input className="control mt-1.5" type="number" min="0.01" step="0.01" value={dispatch.unitPriceInr} onChange={(e) => setDispatch({ ...dispatch, unitPriceInr: Number(e.target.value) })} /></Field>
          <Field label="Channel"><select className="control mt-1.5" value={dispatch.channel} onChange={(e) => setDispatch({ ...dispatch, channel: e.target.value as typeof dispatch.channel })}><option value="direct">Direct</option><option value="dealer">Dealer</option><option value="online">Online</option></select></Field>
          <Field label="Dispatch date"><input className="control mt-1.5" type="date" value={dispatch.dispatchOn} onChange={(e) => setDispatch({ ...dispatch, dispatchOn: e.target.value })} /></Field>
          <Field label="Evidence / dispatch reference"><input className="control mt-1.5" value={dispatch.sourceReference} onChange={(e) => setDispatch({ ...dispatch, sourceReference: e.target.value })} placeholder="Dispatch note / customer order" /></Field>
          <Field label={`Controlled identity${selectedItem?.traceabilityClass === "A" ? " · required by FIFO" : " · optional"}`}>
            <select className="control mt-1.5" value={dispatch.selectedIdentityUid} onChange={(e) => setDispatch({ ...dispatch, selectedIdentityUid: e.target.value })}>
              <option value="">{selectedItem?.traceabilityClass === "A" ? "Infer exact FIFO identity" : "No manual identity selection"}</option>
              {identityOptions.map((identity) => <option key={identity.identityUid} value={identity.identityUid}>{identity.visibleId} · OEM {identity.oemSerialNumber || identity.oemPartNumber || "n/a"}</option>)}
            </select>
          </Field>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="button" disabled={busy || !selectedItem || dispatch.quantity <= 0 || dispatch.unitPriceInr <= 0 || !dispatch.sourceReference} onClick={() => void createSpareDispatch()} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-bg disabled:opacity-40">Post spare dispatch</button>
          <p className="text-xs text-muted">ATP {selectedItem?.availableToPromise ?? 0} · reserved {selectedItem?.reservedQuantity ?? 0} · traceability {selectedItem?.traceabilityClass ?? "—"}. FIFO authority cannot be bypassed by serial selection.</p>
        </div>
      </Panel>

      <Panel title="Spare tax invoice" kicker="Dispatch → Sales Ledger → GST → Trade Receivable">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Field label="Un-invoiced spare dispatch"><select className="control mt-1.5" value={invoice.spareSaleId} onChange={(e) => setInvoice({ ...invoice, spareSaleId: e.target.value })}><option value="">Select dispatch</option>{uninvoiced.map((row) => <option key={text(row, "id")} value={text(row, "id")}>{text(row, "id")} · {text(row, "sku")} · {text(row, "quantity")}</option>)}</select></Field>
          <Field label="Customer"><input className="control mt-1.5" value={invoice.recipientName} onChange={(e) => setInvoice({ ...invoice, recipientName: e.target.value })} /></Field>
          <Field label="Customer GSTIN"><input className="control mt-1.5" value={invoice.recipientGstin} onChange={(e) => setInvoice({ ...invoice, recipientGstin: e.target.value.toUpperCase() })} /></Field>
          <Field label="Place of supply · State code"><input className="control mt-1.5" maxLength={2} value={invoice.placeOfSupplyCode} onChange={(e) => setInvoice({ ...invoice, placeOfSupplyCode: e.target.value })} placeholder="33" /></Field>
          <Field label="Invoice address"><input className="control mt-1.5" value={invoice.recipientAddress} onChange={(e) => setInvoice({ ...invoice, recipientAddress: e.target.value })} /></Field>
          <Field label="Delivery address"><input className="control mt-1.5" value={invoice.deliveryAddress} onChange={(e) => setInvoice({ ...invoice, deliveryAddress: e.target.value })} /></Field>
          <Field label="HSN"><input className="control mt-1.5" value={invoice.hsnSac} onChange={(e) => setInvoice({ ...invoice, hsnSac: e.target.value })} /></Field>
          <Field label="Description"><input className="control mt-1.5" value={invoice.itemDescription} onChange={(e) => setInvoice({ ...invoice, itemDescription: e.target.value })} placeholder="Defaults to controlled item name / SKU" /></Field>
          <Field label="Tax mode"><select className="control mt-1.5" value={invoice.taxMode} onChange={(e) => setInvoice({ ...invoice, taxMode: e.target.value as TaxMode })}><option value="cgst_sgst">CGST + SGST</option><option value="igst">IGST</option><option value="zero_rated">Zero rated</option><option value="exempt">Exempt</option></select></Field>
          <Field label="GST rate %"><input className="control mt-1.5" type="number" min="0" max="100" step="0.01" disabled={invoice.taxMode === "zero_rated" || invoice.taxMode === "exempt"} value={invoice.taxRatePct} onChange={(e) => setInvoice({ ...invoice, taxRatePct: Number(e.target.value) })} /></Field>
          <Field label="Credit terms · days"><input className="control mt-1.5" type="number" min="0" max="365" value={invoice.creditTermsDays} onChange={(e) => setInvoice({ ...invoice, creditTermsDays: Number(e.target.value) })} /></Field>
          <Field label="Credit terms evidence"><input className="control mt-1.5" value={invoice.creditTermsReference} onChange={(e) => setInvoice({ ...invoice, creditTermsReference: e.target.value })} placeholder="PO / quotation / payment terms" /></Field>
          <Field label="Invoice source reference"><input className="control mt-1.5" value={invoice.sourceReference} onChange={(e) => setInvoice({ ...invoice, sourceReference: e.target.value })} /></Field>
          <Field label="Tax evidence reference"><input className="control mt-1.5" value={invoice.taxEvidenceReference} onChange={(e) => setInvoice({ ...invoice, taxEvidenceReference: e.target.value })} /></Field>
        </div>
        <button type="button" disabled={busy || !invoice.spareSaleId || !invoice.recipientName || !invoice.recipientAddress || !invoice.deliveryAddress || !/^\d{2}$/.test(invoice.placeOfSupplyCode) || !invoice.sourceReference || !invoice.taxEvidenceReference || !invoice.creditTermsReference} onClick={() => void createSpareInvoice()} className="mt-4 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-bg disabled:opacity-40">Issue spare tax invoice</button>
      </Panel>

      <Panel title="Actual Sales Ledger" kicker="Issued tax invoices only · bicycle and aftermarket kept separately visible">
        <div className="overflow-x-auto">
          <table className="min-w-[1400px] w-full text-left text-xs">
            <thead className="border-b border-border text-[10px] uppercase tracking-wider text-subtle"><tr><Th>Invoice</Th><Th>Date</Th><Th>Type</Th><Th>Customer</Th><Th>Item / identity</Th><Th>Qty</Th><Th>Taxable</Th><Th>GST</Th><Th>Gross</Th><Th>Collected</Th><Th>Balance</Th><Th>Due</Th><Th>Status</Th></tr></thead>
            <tbody>
              {data.ledger.map((row) => (
                <tr key={text(row, "invoice_id")} className="border-b border-border/60 align-top">
                  <Td><span className="font-mono text-accent">{text(row, "invoice_id")}</span></Td>
                  <Td>{text(row, "issued_on")}</Td>
                  <Td><span className="font-semibold">{text(row, "sale_type") === "spare_component" ? "Spare / component" : "Bicycle"}</span><div className="text-muted">{text(row, "channel")}</div></Td>
                  <Td>{text(row, "customer_name")}<div className="text-muted">{text(row, "customer_gstin")}</div></Td>
                  <Td>{text(row, "item_reference")}<div className="text-muted">{text(row, "vyndi_identity") || "—"}</div><div className="text-muted">OEM {text(row, "oem_serial_number") || text(row, "oem_part_number") || "—"}</div></Td>
                  <Td>{text(row, "quantity")} {text(row, "unit_code")}</Td>
                  <Td>{money(row.taxable_value_inr)}</Td>
                  <Td>{money(row.gst_inr)}</Td>
                  <Td>{money(row.gross_amount_inr)}</Td>
                  <Td>{money(row.collected_inr)}</Td>
                  <Td>{money(row.balance_inr)}</Td>
                  <Td>{text(row, "due_on") || "Legacy"}<div className="text-muted">{text(row, "aging_bucket")}</div></Td>
                  <Td>{text(row, "invoice_status")}<div className="text-muted">{text(row, "payment_status")}</div></Td>
                </tr>
              ))}
              {!data.ledger.length ? <tr><td colSpan={13} className="py-6 text-center text-muted">No actual invoiced sales yet.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Spare dispatch register" kicker="Physical stock / FIFO lineage before invoice">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data.spareSales.map((row) => (
            <article key={text(row, "id")} className="rounded-xl border border-border p-4">
              <div className="flex items-start justify-between gap-3"><div><p className="font-mono text-xs text-accent">{text(row, "id")}</p><p className="mt-1 font-semibold">{text(row, "sku")} · {text(row, "item_name")}</p></div><span className="text-[10px] font-semibold uppercase text-muted">{text(row, "status")}</span></div>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-xs text-muted"><Stat label="Quantity" value={`${text(row, "quantity")} ${text(row, "unit")}`} /><Stat label="Sale value" value={money(num(row, "quantity") * num(row, "unit_price_inr"))} /><Stat label="FIFO COGS" value={money(row.fifo_cost_inr)} /><Stat label="Invoice" value={text(row, "invoice_id") || "Pending"} /></dl>
              {text(row, "status") === "dispatched" && !text(row, "invoice_id") ? <button type="button" disabled={busy} onClick={() => void reverseDispatch(row)} className="mt-3 text-xs font-semibold text-warn">Reverse dispatch</button> : null}
            </article>
          ))}
          {!data.spareSales.length ? <p className="text-sm text-muted">No spare/component dispatch has been posted.</p> : null}
        </div>
      </Panel>

      <div className="rounded-xl border border-green/30 bg-green/5 p-4 text-xs leading-5 text-muted">
        <p className="font-semibold text-green">Accounting path</p>
        <p className="mt-1">Spare dispatch: Master Inventory − quantity → FIFO COGS Dr 5000 / Cr 1200. Invoice: Dr 1100 Trade Receivable / Cr 4000 Product Revenue + Cr 2100 Output GST. Collection remains in Receivables: Dr 1000 Bank / Cr 1100 Trade Receivable → verified canonical cash → VIBPE.</p>
      </div>
    </main>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="text-xs font-medium text-muted"><span>{label}</span>{children}</label>;
}
function Stat({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-[10px] uppercase tracking-wider text-subtle">{label}</dt><dd className="mt-1 break-words font-medium text-fg">{value}</dd></div>;
}
function Th({ children }: { children: ReactNode }) { return <th className="px-2 py-2">{children}</th>; }
function Td({ children }: { children: ReactNode }) { return <td className="px-2 py-3">{children}</td>; }
