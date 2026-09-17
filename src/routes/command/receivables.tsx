import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { ArrowRight, Banknote, FileText, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Kpi, Panel } from "@/components/kpi";
import { issueInvoice, listShipmentRevenueLedger, postCollection } from "@/lib/shipment-authority";

export const Route = createFileRoute("/command/receivables")({
  loader: () => listShipmentRevenueLedger(),
  component: Receivables,
});
const moneyLakh = (value: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value * 100_000);
const moneyInr = (value: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value);

type TaxMode = "" | "cgst_sgst" | "igst" | "zero_rated" | "exempt";

function Receivables() {
  const data = Route.useLoaderData();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const activeInvoices = data.invoices.filter((invoice) => invoice.status === "issued");
  const postedCollections = data.collections.filter((collection) => collection.status === "posted");
  const collectedByInvoice = new Map<string, number>();
  for (const collection of postedCollections)
    collectedByInvoice.set(collection.invoiceId, (collectedByInvoice.get(collection.invoiceId) ?? 0) + collection.amountLakh);
  const outstanding = activeInvoices.reduce(
    (sum, invoice) => sum + Math.max(invoice.grossAmountLakh - (collectedByInvoice.get(invoice.id) ?? 0), 0),
    0,
  );
  const uninvoiced = data.shipments.filter(
    (shipment) => shipment.status === "posted" && !activeInvoices.some((invoice) => invoice.shipmentId === shipment.id),
  );
  const [invoice, setInvoice] = useState({
    id: "",
    shipmentId: "",
    sourceReference: "",
    recipientName: "",
    recipientGstin: "",
    recipientAddress: "",
    deliveryAddress: "",
    placeOfSupplyCode: data.taxRegistration?.stateCode ?? "",
    hsnSac: "",
    itemDescription: "",
    unitCode: "NOS",
    taxRatePct: 0,
    taxMode: "" as TaxMode,
    reverseCharge: false,
    eInvoiceRequired: false,
    irn: "",
    irnAckNumber: "",
    irnAckAt: "",
    taxEvidenceReference: "",
    creditTermsDays: 0,
    creditTermsReference: "",
  });
  const [collection, setCollection] = useState({ id: "", invoiceId: "", planMonth: 1, amountLakh: 0, sourceReference: "" });

  async function run(task: () => Promise<unknown>, success: string) {
    setBusy(true);
    setMessage("");
    try {
      await task();
      setMessage(success);
      await router.invalidate();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Receivable transaction could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  const invoiceReady = Boolean(
    data.taxRegistration && invoice.id && invoice.shipmentId && invoice.sourceReference && invoice.recipientName &&
    invoice.recipientAddress && invoice.deliveryAddress && invoice.placeOfSupplyCode && invoice.hsnSac &&
    invoice.itemDescription && invoice.taxMode && invoice.taxEvidenceReference && invoice.creditTermsReference &&
    (!invoice.eInvoiceRequired || (invoice.irn && invoice.irnAckNumber && invoice.irnAckAt)),
  );

  return (
    <main className="mx-auto max-w-7xl space-y-6">
      <header className="flex flex-col gap-4 border-b border-border pb-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-green">Finance · order to cash</p>
          <h1 className="mt-2 font-display text-4xl text-accent">Accounts Receivable</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
            A confirmed order does not create revenue or cash. Dispatch releases inventory/COGS; the controlled tax invoice creates the gross customer receivable;
            only an evidenced collection moves Bank and verified canonical cash for VIBPE.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/command/accounting/statutory" className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-semibold text-muted hover:border-accent hover:text-accent">
            Statutory controls <ShieldCheck className="size-4" />
          </Link>
          <Link to="/command/sales" className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-semibold text-muted hover:border-accent hover:text-accent">
            Commercial orders <ArrowRight className="size-4" />
          </Link>
        </div>
      </header>

      <div className="rounded-xl border border-border bg-surface p-4 text-sm leading-6 text-muted">
        <span className="font-semibold text-fg">Controlled credit path:</span> Confirmed order → Dispatch → Tax invoice → <span className="font-mono text-xs">Dr 1100 Trade Receivable</span> / <span className="font-mono text-xs">Cr 4000 Revenue + Cr 2100 Output GST</span> → Due-date ageing → Bank/UTR collection → <span className="font-mono text-xs">Dr 1000 Bank / Cr 1100 Trade Receivable</span> → Canonical cash → VIBPE.
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Open gross receivables" value={moneyLakh(outstanding)} hint={`${activeInvoices.length} active invoices`} tone={outstanding ? "warn" : "ok"} />
        <Kpi label="Uninvoiced shipments" value={String(uninvoiced.length)} hint="Dispatch posted, invoice pending" tone={uninvoiced.length ? "warn" : "ok"} />
        <Kpi label="Collections posted" value={moneyLakh(postedCollections.reduce((sum, row) => sum + row.amountLakh, 0))} hint={`${postedCollections.length} bank receipts`} />
        <Kpi label="Invoice register" value={String(data.invoices.length)} hint="Tax + credit controlled records" />
      </div>
      {!data.taxRegistration ? (
        <div className="rounded-xl border border-warn/40 bg-surface p-4 text-sm text-muted">
          <span className="font-semibold text-warn">Tax invoice issuance is locked.</span> Configure the approved GST/tax registration in Statutory Controls first.
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-surface p-4 text-sm text-muted">
          <span className="font-semibold text-fg">Controlled supplier:</span> {data.taxRegistration.legalName} · GSTIN {data.taxRegistration.gstin} · State {data.taxRegistration.stateCode}. E-invoice entity setting: {data.taxRegistration.eInvoiceApplicable ? "enabled" : "not enabled"}.
        </div>
      )}
      {message ? <div role="status" className="rounded-lg border border-border bg-surface px-4 py-3 text-sm text-muted">{message}</div> : null}

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title="Issue controlled tax invoice" kicker="Posted shipment → tax + credit evidence → AR / revenue / GST">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Posted shipment">
              <select className="control mt-1.5" value={invoice.shipmentId} onChange={(e) => setInvoice({ ...invoice, shipmentId: e.target.value })}>
                <option value="">Select shipment</option>
                {uninvoiced.map((row) => <option key={row.id} value={row.id}>{row.id} · {row.salesOrderId} · {row.units} units</option>)}
              </select>
            </Field>
            <Field label="Invoice ID"><input className="control mt-1.5 uppercase" value={invoice.id} onChange={(e) => setInvoice({ ...invoice, id: e.target.value })} placeholder="INV-2026-001" /></Field>
            <Field label="Recipient name"><input className="control mt-1.5" value={invoice.recipientName} onChange={(e) => setInvoice({ ...invoice, recipientName: e.target.value })} /></Field>
            <Field label="Recipient GSTIN · optional for unregistered recipient"><input className="control mt-1.5 uppercase" maxLength={15} value={invoice.recipientGstin} onChange={(e) => setInvoice({ ...invoice, recipientGstin: e.target.value.toUpperCase() })} /></Field>
            <Field label="Recipient address"><input className="control mt-1.5" value={invoice.recipientAddress} onChange={(e) => setInvoice({ ...invoice, recipientAddress: e.target.value })} /></Field>
            <Field label="Delivery address"><input className="control mt-1.5" value={invoice.deliveryAddress} onChange={(e) => setInvoice({ ...invoice, deliveryAddress: e.target.value })} /></Field>
            <Field label="Place of supply · State code"><input className="control mt-1.5" maxLength={2} value={invoice.placeOfSupplyCode} onChange={(e) => setInvoice({ ...invoice, placeOfSupplyCode: e.target.value.replace(/\D/g, "").slice(0, 2) })} placeholder="33" /></Field>
            <Field label="HSN / SAC"><input className="control mt-1.5" value={invoice.hsnSac} onChange={(e) => setInvoice({ ...invoice, hsnSac: e.target.value })} /></Field>
            <Field label="Item description"><input className="control mt-1.5" value={invoice.itemDescription} onChange={(e) => setInvoice({ ...invoice, itemDescription: e.target.value })} /></Field>
            <Field label="Unit code"><input className="control mt-1.5 uppercase" value={invoice.unitCode} onChange={(e) => setInvoice({ ...invoice, unitCode: e.target.value })} /></Field>
            <Field label="GST treatment">
              <select className="control mt-1.5" value={invoice.taxMode} onChange={(e) => setInvoice({ ...invoice, taxMode: e.target.value as TaxMode, taxRatePct: ["zero_rated", "exempt"].includes(e.target.value) ? 0 : invoice.taxRatePct })}>
                <option value="">Select treatment</option>
                <option value="cgst_sgst">CGST + SGST</option>
                <option value="igst">IGST</option>
                <option value="zero_rated">Zero-rated</option>
                <option value="exempt">Exempt</option>
              </select>
            </Field>
            <Field label="GST rate · %"><input className="control mt-1.5" type="number" min="0" max="100" step="0.01" disabled={["zero_rated", "exempt"].includes(invoice.taxMode)} value={invoice.taxRatePct} onChange={(e) => setInvoice({ ...invoice, taxRatePct: Number(e.target.value) })} /></Field>
            <Field label="Credit terms · days (0 = due immediately)"><input className="control mt-1.5" type="number" min="0" max="365" value={invoice.creditTermsDays} onChange={(e) => setInvoice({ ...invoice, creditTermsDays: Number(e.target.value) })} /></Field>
            <Field label="Credit terms evidence"><input className="control mt-1.5" value={invoice.creditTermsReference} onChange={(e) => setInvoice({ ...invoice, creditTermsReference: e.target.value })} placeholder="PO / quotation / agreed terms reference" /></Field>
            <label className="flex min-h-11 items-center gap-2 rounded-lg border border-border px-3 text-xs text-muted"><input type="checkbox" checked={invoice.reverseCharge} onChange={(e) => setInvoice({ ...invoice, reverseCharge: e.target.checked })} />Reverse charge indicated</label>
            <label className="flex min-h-11 items-center gap-2 rounded-lg border border-border px-3 text-xs text-muted"><input type="checkbox" disabled={!data.taxRegistration?.eInvoiceApplicable} checked={invoice.eInvoiceRequired} onChange={(e) => setInvoice({ ...invoice, eInvoiceRequired: e.target.checked })} />This document requires e-invoice / IRN</label>
            {invoice.eInvoiceRequired ? <>
              <Field label="IRN"><input className="control mt-1.5" value={invoice.irn} onChange={(e) => setInvoice({ ...invoice, irn: e.target.value })} /></Field>
              <Field label="IRN acknowledgement no."><input className="control mt-1.5" value={invoice.irnAckNumber} onChange={(e) => setInvoice({ ...invoice, irnAckNumber: e.target.value })} /></Field>
              <Field label="IRN acknowledgement time"><input className="control mt-1.5" type="datetime-local" value={invoice.irnAckAt} onChange={(e) => setInvoice({ ...invoice, irnAckAt: e.target.value })} /></Field>
            </> : null}
            <Field label="Commercial invoice evidence"><input className="control mt-1.5" value={invoice.sourceReference} onChange={(e) => setInvoice({ ...invoice, sourceReference: e.target.value })} placeholder="Invoice / dispatch source" /></Field>
            <Field label="GST / IRP evidence"><input className="control mt-1.5" value={invoice.taxEvidenceReference} onChange={(e) => setInvoice({ ...invoice, taxEvidenceReference: e.target.value })} placeholder="GST working / IRP acknowledgement" /></Field>
          </div>
          <button
            type="button"
            disabled={busy || !invoiceReady}
            onClick={() => {
              const taxMode = invoice.taxMode;
              if (!taxMode) return;
              void run(() => issueInvoice({ data: { ...invoice, taxMode } }), `${invoice.id.toUpperCase()} issued with controlled tax and credit profile.`);
            }}
            className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-bg disabled:opacity-40"
          >
            <FileText className="size-4" />Issue tax invoice
          </button>
        </Panel>

        <Panel title="Post collection" kicker="Gross invoice receivable → Bank 1000 → canonical cash / VIBPE">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Open invoice">
              <select
                className="control mt-1.5"
                value={collection.invoiceId}
                onChange={(e) => {
                  const selectedId = e.target.value;
                  const row = activeInvoices.find((item) => item.id === selectedId);
                  setCollection({ ...collection, invoiceId: selectedId, amountLakh: row ? Math.max(row.grossAmountLakh - (collectedByInvoice.get(selectedId) ?? 0), 0) : 0 });
                }}
              >
                <option value="">Select invoice</option>
                {activeInvoices.filter((row) => row.grossAmountLakh - (collectedByInvoice.get(row.id) ?? 0) > 0).map((row) => (
                  <option key={row.id} value={row.id}>{row.id} · open {moneyLakh(row.grossAmountLakh - (collectedByInvoice.get(row.id) ?? 0))}</option>
                ))}
              </select>
            </Field>
            <Field label="Collection ID"><input className="control mt-1.5 uppercase" value={collection.id} onChange={(e) => setCollection({ ...collection, id: e.target.value })} placeholder="COL-2026-001" /></Field>
            <Field label="Collection cash month · actual receipt month"><input className="control mt-1.5" type="number" min="1" max="36" value={collection.planMonth} onChange={(e) => setCollection({ ...collection, planMonth: Number(e.target.value) })} /></Field>
            <Field label="Amount · ₹ lakh"><input className="control mt-1.5" type="number" min="0.01" step="0.01" value={collection.amountLakh} onChange={(e) => setCollection({ ...collection, amountLakh: Number(e.target.value) })} /></Field>
            <Field label="Bank / UTR evidence"><input className="control mt-1.5" value={collection.sourceReference} onChange={(e) => setCollection({ ...collection, sourceReference: e.target.value })} placeholder="UTR / statement evidence" /></Field>
          </div>
          <p className="mt-3 text-xs leading-5 text-muted">The cash month is explicit and is not inferred from the invoice month or collection date. Posting creates Dr Bank / Cr Trade Receivable and revises verified canonical cash in that selected month.</p>
          <button type="button" disabled={busy || !collection.id || !collection.invoiceId || !collection.sourceReference || collection.amountLakh <= 0} onClick={() => void run(() => postCollection({ data: collection }), `${collection.id.toUpperCase()} posted to Bank, Trade Receivable and canonical cash.`)} className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-bg disabled:opacity-40">
            <Banknote className="size-4" />Post collection
          </button>
        </Panel>
      </div>

      <Panel title="Receivable register" kicker="Shipment → tax invoice → credit due date → gross collection">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1420px] text-sm">
            <thead className="border-b border-border text-[10px] uppercase tracking-wider text-subtle">
              <tr>
                <th className="px-3 py-3 text-left">Invoice</th><th className="px-3 py-3 text-left">Order / shipment</th>
                <th className="px-3 py-3 text-right">Taxable</th><th className="px-3 py-3 text-right">GST</th><th className="px-3 py-3 text-right">Gross AR</th>
                <th className="px-3 py-3 text-right">Collected</th><th className="px-3 py-3 text-right">Open</th>
                <th className="px-3 py-3 text-left">Credit / due</th><th className="px-3 py-3 text-left">Tax control</th><th className="px-3 py-3 text-left">Status</th><th className="px-3 py-3 text-left">Evidence</th>
              </tr>
            </thead>
            <tbody>
              {data.invoices.map((row) => {
                const collected = collectedByInvoice.get(row.id) ?? 0;
                return (
                  <tr key={row.id} className="border-t border-border/70">
                    <td className="px-3 py-3 font-mono text-xs">{row.id}</td>
                    <td className="px-3 py-3">{row.salesOrderId}<span className="block text-xs text-muted">{row.shipmentId}</span></td>
                    <td className="px-3 py-3 text-right tabular-nums">{moneyInr(row.taxableValueInr)}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{moneyInr(row.gstInr)}</td>
                    <td className="px-3 py-3 text-right font-semibold tabular-nums">{moneyLakh(row.grossAmountLakh)}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-ok">{moneyLakh(collected)}</td>
                    <td className="px-3 py-3 text-right font-semibold tabular-nums">{moneyLakh(Math.max(row.grossAmountLakh - collected, 0))}</td>
                    <td className="px-3 py-3 text-xs">
                      {row.creditProfileStatus === "controlled" ? <><span className="font-semibold text-fg">{row.creditTermsDays} days · due {row.dueOn}</span><span className="block text-muted">{row.creditTermsReference}</span></> : <span className="font-semibold text-warn">Legacy · terms not inferred</span>}
                    </td>
                    <td className="px-3 py-3 text-xs"><span className={row.taxProfileStatus === "complete" ? "text-ok" : "text-danger"}>{row.taxProfileStatus}</span><span className="block text-muted">{row.taxMode} · {row.taxRatePct}%{row.eInvoiceRequired ? ` · IRN ${row.irn || "missing"}` : ""}</span></td>
                    <td className={row.status === "issued" ? "px-3 py-3 text-xs font-semibold uppercase text-ok" : "px-3 py-3 text-xs font-semibold uppercase text-muted"}>{row.status}</td>
                    <td className="px-3 py-3 text-xs text-muted">{row.sourceReference}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {data.invoices.length === 0 ? <p className="py-8 text-center text-sm text-muted">No invoices have been issued.</p> : null}
        </div>
      </Panel>

      <Panel title="Collection & cash lineage" kicker="Bank evidence → AR settlement → verified cash revision">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-sm">
            <thead className="border-b border-border text-[10px] uppercase tracking-wider text-subtle">
              <tr><th className="px-3 py-3 text-left">Collection</th><th className="px-3 py-3 text-left">Invoice</th><th className="px-3 py-3 text-left">Cash month</th><th className="px-3 py-3 text-right">Amount</th><th className="px-3 py-3 text-left">Bank evidence</th><th className="px-3 py-3 text-left">Canonical cash</th><th className="px-3 py-3 text-left">Status</th></tr>
            </thead>
            <tbody>
              {data.collections.map((row) => (
                <tr key={row.id} className="border-t border-border/70">
                  <td className="px-3 py-3 font-mono text-xs">{row.id}</td>
                  <td className="px-3 py-3 font-mono text-xs">{row.invoiceId}</td>
                  <td className="px-3 py-3">M{row.planMonth}</td>
                  <td className="px-3 py-3 text-right font-semibold tabular-nums">{moneyLakh(row.amountLakh)}</td>
                  <td className="px-3 py-3 text-xs text-muted">{row.sourceReference}</td>
                  <td className="px-3 py-3 text-xs">{row.cashActualRevision ? `R${row.cashActualRevision} · ${moneyLakh(row.newClosingCashLakh ?? 0)}` : "Legacy · no automatic cash revision"}</td>
                  <td className={row.status === "posted" ? "px-3 py-3 text-xs font-semibold uppercase text-ok" : "px-3 py-3 text-xs font-semibold uppercase text-muted"}>{row.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.collections.length === 0 ? <p className="py-8 text-center text-sm text-muted">No collections have been posted.</p> : null}
        </div>
      </Panel>
    </main>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="text-xs font-medium text-muted">{label}{children}</label>;
}