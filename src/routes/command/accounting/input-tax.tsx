import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { ShieldCheck } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Kpi, Panel } from "@/components/kpi";
import { classifySupplierInvoiceItc, getInputTaxControl } from "@/lib/finance/input-tax-authority";

export const Route = createFileRoute("/command/accounting/input-tax")({
  loader: () => getInputTaxControl(),
  component: InputTaxControl,
});

const text = (row: Record<string, unknown>, key: string) => String(row[key] ?? "");
const num = (row: Record<string, unknown>, key: string) => Number(row[key] ?? 0);
const money = (value: unknown) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(Number(value ?? 0));

function InputTaxControl() {
  const data = Route.useLoaderData();
  const router = useRouter();
  const [selectedId, setSelectedId] = useState("");
  const selected = useMemo(() => data.invoices.find((row) => text(row, "id") === selectedId), [data.invoices, selectedId]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [draft, setDraft] = useState({ supplierGstin: "", hsnSac: "", taxRatePct: 0, cgstInr: 0, sgstInr: 0, igstInr: 0, cessInr: 0, itcEligible: false, itcEvidenceReference: "", gstr2bReference: "" });

  const pending = data.invoices.filter((row) => text(row, "itc_control_status") === "pending");
  const verified = data.invoices.filter((row) => text(row, "itc_control_status") === "verified");
  const ineligible = data.invoices.filter((row) => text(row, "itc_control_status") === "ineligible");

  function choose(row: Record<string, unknown>) {
    setSelectedId(text(row, "id"));
    setDraft({
      supplierGstin: text(row, "supplier_gstin"), hsnSac: text(row, "hsn_sac"), taxRatePct: num(row, "tax_rate_pct"),
      cgstInr: num(row, "cgst_inr"), sgstInr: num(row, "sgst_inr"), igstInr: num(row, "igst_inr"), cessInr: num(row, "cess_inr"),
      itcEligible: Boolean(row.itc_eligible), itcEvidenceReference: text(row, "itc_evidence_reference"), gstr2bReference: text(row, "gstr2b_reference"),
    });
    setMessage("");
  }

  async function save() {
    if (!selectedId) return;
    setBusy(true);
    setMessage("");
    try {
      await classifySupplierInvoiceItc({ data: { id: selectedId, ...draft } });
      setMessage(`${selectedId} ITC classification saved.`);
      await router.invalidate();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "ITC classification could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-7xl space-y-6">
      <header className="flex flex-col gap-4 border-b border-border pb-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-green">Finance · input GST control</p>
          <h1 className="mt-2 font-display text-4xl text-accent">Input GST / ITC Review</h1>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-muted">Supplier GST is not treated as eligible credit from document presence alone. Finance classifies each GST-bearing supplier invoice before approval; unverified or ineligible tax remains in inventory/cost instead of Input GST.</p>
        </div>
        <div className="flex gap-2"><Link to="/command/accounting/statutory" className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-muted hover:border-accent hover:text-accent">Statutory Controls</Link><Link to="/command/payables" className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-muted hover:border-accent hover:text-accent">Payables</Link></div>
      </header>
      <div className="grid gap-3 sm:grid-cols-3"><Kpi label="Pending classification" value={String(pending.length)} hint="Blocks GST invoice approval" tone={pending.length ? "danger" : "ok"} /><Kpi label="Verified eligible" value={String(verified.length)} hint="Explicit evidence required" tone="ok" /><Kpi label="Ineligible / costed" value={String(ineligible.length)} hint="GST retained in inventory/cost" /></div>
      {message ? <div role="status" className="rounded-lg border border-border bg-surface px-4 py-3 text-sm text-muted">{message}</div> : null}
      <div className="grid gap-6 xl:grid-cols-[1.15fr_1fr]">
        <Panel title="GST-bearing supplier invoices" kicker="Classify before AP approval">
          <div className="grid gap-2">{data.invoices.map((row) => <button type="button" key={text(row,"id")} onClick={() => choose(row)} className={`grid grid-cols-[minmax(0,1fr)_110px_110px] gap-3 rounded-lg border p-3 text-left text-sm ${selectedId===text(row,"id")?"border-accent":"border-border"}`}><span className="min-w-0"><span className="font-mono text-xs text-accent">{text(row,"id")}</span><span className="mt-1 block font-semibold break-words">{text(row,"supplier_name")} · {text(row,"invoice_number")}</span><span className="mt-1 block text-xs text-muted">{text(row,"invoice_on")} · {text(row,"status")}</span></span><span className="text-right tabular-nums">{money(row.gst_inr)}</span><span className={`text-right text-xs font-semibold uppercase ${text(row,"itc_control_status")==="pending"?"text-danger":text(row,"itc_control_status")==="verified"?"text-ok":"text-muted"}`}>{text(row,"itc_control_status")}</span></button>)}{!data.invoices.length ? <Empty>No GST-bearing supplier invoices.</Empty> : null}</div>
        </Panel>
        <Panel title="ITC classification" kicker={selected ? `${text(selected,"id")} · GST ${money(selected.gst_inr)}` : "Select an invoice"}>
          {selected ? <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Supplier GSTIN"><input className="control mt-1.5 uppercase" maxLength={15} value={draft.supplierGstin} onChange={(e)=>setDraft({...draft,supplierGstin:e.target.value.toUpperCase()})}/></Field>
            <Field label="HSN / SAC"><input className="control mt-1.5" value={draft.hsnSac} onChange={(e)=>setDraft({...draft,hsnSac:e.target.value})}/></Field>
            <Field label="Tax rate · %"><input className="control mt-1.5" type="number" min="0" max="100" step="0.01" value={draft.taxRatePct} onChange={(e)=>setDraft({...draft,taxRatePct:Number(e.target.value)})}/></Field>
            <Field label="CGST"><input className="control mt-1.5" type="number" min="0" step="0.01" value={draft.cgstInr} onChange={(e)=>setDraft({...draft,cgstInr:Number(e.target.value)})}/></Field>
            <Field label="SGST"><input className="control mt-1.5" type="number" min="0" step="0.01" value={draft.sgstInr} onChange={(e)=>setDraft({...draft,sgstInr:Number(e.target.value)})}/></Field>
            <Field label="IGST"><input className="control mt-1.5" type="number" min="0" step="0.01" value={draft.igstInr} onChange={(e)=>setDraft({...draft,igstInr:Number(e.target.value)})}/></Field>
            <Field label="Cess"><input className="control mt-1.5" type="number" min="0" step="0.01" value={draft.cessInr} onChange={(e)=>setDraft({...draft,cessInr:Number(e.target.value)})}/></Field>
            <label className="flex min-h-11 items-center gap-2 self-end rounded-lg border border-border px-3 text-xs text-muted"><input type="checkbox" checked={draft.itcEligible} onChange={(e)=>setDraft({...draft,itcEligible:e.target.checked})}/>Eligible ITC after review</label>
            <Field label="ITC evidence reference"><input className="control mt-1.5" value={draft.itcEvidenceReference} onChange={(e)=>setDraft({...draft,itcEvidenceReference:e.target.value})} placeholder="Tax invoice / eligibility evidence" /></Field>
            <Field label="GSTR-2B / reconciliation reference"><input className="control mt-1.5" value={draft.gstr2bReference} onChange={(e)=>setDraft({...draft,gstr2bReference:e.target.value})} /></Field>
            <div className="sm:col-span-2 rounded-lg border border-border bg-bg/40 p-3 text-xs text-muted">Tax components must equal the supplier invoice GST total. If ITC is marked eligible, an evidence reference is mandatory. Classification is allowed only before invoice approval.</div>
            <button type="button" disabled={busy || (draft.itcEligible && !draft.itcEvidenceReference)} onClick={() => void save()} className="sm:col-span-2 inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-bg disabled:opacity-40"><ShieldCheck className="size-4"/>Save ITC classification</button>
          </div> : <Empty>Select a supplier invoice to classify its input GST.</Empty>}
        </Panel>
      </div>
      <div className="rounded-xl border border-border bg-surface p-4 text-xs leading-5 text-muted"><span className="font-semibold text-fg">Control boundary:</span> VYNDI records the management accounting classification and evidence. Final ITC entitlement and GST-return treatment remain subject to applicable law and CA review.</div>
    </main>
  );
}
function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="text-xs font-medium text-muted">{label}{children}</label>; }
function Empty({ children }: { children: ReactNode }) { return <div className="rounded-xl border border-dashed border-border p-5 text-sm text-muted">{children}</div>; }
