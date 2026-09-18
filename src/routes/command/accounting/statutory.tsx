import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { BadgeCheck, BookLock, Landmark, ReceiptText, ShieldCheck } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Kpi, Panel } from "@/components/kpi";
import {
  approveCaEvidencePack,
  captureCaEvidencePack,
  getStatutoryFinanceControl,
  saveTaxRegistration,
  setFinancePeriodStatus,
} from "@/lib/finance/statutory-authority";
import {
  approveCashReconciliation,
  getCashReconciliationTruth,
  prepareCashReconciliation,
} from "@/lib/finance/cash-reconciliation-authority";

export const Route = createFileRoute("/command/accounting/statutory")({
  loader: async () => {
    const [base, cashTruth] = await Promise.all([getStatutoryFinanceControl(), getCashReconciliationTruth()]);
    return { ...base, cashTruth };
  },
  component: StatutoryFinanceControl,
});

const text = (row: Record<string, unknown> | null | undefined, key: string) => String(row?.[key] ?? "");
const num = (row: Record<string, unknown> | null | undefined, key: string) => Number(row?.[key] ?? 0);
const money = (value: unknown) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(Number(value ?? 0));
const currentPeriod = () => new Date().toISOString().slice(0, 7);
const today = () => new Date().toISOString().slice(0, 10);

function StatutoryFinanceControl() {
  const data = Route.useLoaderData();
  const router = useRouter();
  const registration = data.registration as Record<string, unknown> | null;
  const readiness = data.readiness as Record<string, unknown>;
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [tax, setTax] = useState({
    legalName: text(registration, "legal_name"), tradeName: text(registration, "trade_name"), gstin: text(registration, "gstin"),
    registeredAddress: text(registration, "registered_address"), stateCode: text(registration, "state_code"), pan: text(registration, "pan"),
    aatoInr: num(registration, "aato_inr"), eInvoiceApplicable: Boolean(registration?.e_invoice_applicable),
    effectiveFrom: text(registration, "effective_from") || today(), sourceReference: text(registration, "source_reference"),
  });
  const [bank, setBank] = useState({ id: "", bankAccountRef: "BANK-01", period: currentPeriod(), planMonth: 1, openingBalanceInr: 0, closingBalanceInr: 0, evidenceReference: "" });
  const [close, setClose] = useState({ period: currentPeriod(), status: "soft_closed" as "open" | "soft_closed" | "hard_closed", evidenceReference: "" });
  const [pack, setPack] = useState({ id: "", period: currentPeriod(), evidenceReference: "" });

  async function run(task: () => Promise<unknown>, success: string) {
    setBusy(true); setMessage("");
    try { await task(); setMessage(success); await router.invalidate(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Statutory finance action could not be completed."); }
    finally { setBusy(false); }
  }

  const gstBlockers = num(readiness, "gst_evidence_exceptions") + num(readiness, "unverified_input_itc") + num(readiness, "pending_invoice_tax_profiles") + num(readiness, "missing_irn_count");
  const blockerCount = num(readiness, "open_posting_exceptions") + num(readiness, "unmatched_bank_lines") + gstBlockers +
    num(readiness, "asset_evidence_exceptions") + num(readiness, "payroll_evidence_exceptions") +
    (Math.abs(num(readiness, "trial_balance_difference_inr")) > 0.01 ? 1 : 0);

  return (
    <main className="mx-auto max-w-7xl space-y-6">
      <header className="flex flex-col gap-4 border-b border-border pb-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-green">Finance · statutory hardening</p>
          <h1 className="mt-2 font-display text-4xl text-accent">Statutory Control Center</h1>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-muted">Govern GST identity, output-tax evidence, input ITC classification, bank reconciliation, accounting-period close and CA evidence packs. VYNDI exposes blockers rather than silently certifying statutory readiness.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/command/accounting" className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-muted hover:border-accent hover:text-accent">Accounting</Link>
          <Link to="/command/accounting/input-tax" className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-muted hover:border-accent hover:text-accent">Input GST / ITC</Link>
          <Link to="/command/receivables" className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-muted hover:border-accent hover:text-accent">Receivables</Link>
          <Link to="/command/inventory-stocktake" className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-muted hover:border-accent hover:text-accent">Inventory Stocktake</Link>
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Kpi label="Readiness blockers" value={String(blockerCount)} hint="Global control evidence" tone={blockerCount ? "danger" : "ok"} />
        <Kpi label="Unmatched bank" value={String(readiness.unmatched_bank_lines ?? 0)} hint="Statement lines" tone={num(readiness,"unmatched_bank_lines") ? "warn" : "ok"} />
        <Kpi label="Unverified input ITC" value={String(readiness.unverified_input_itc ?? 0)} hint="Explicit classification required" tone={num(readiness,"unverified_input_itc") ? "danger" : "ok"} />
        <Kpi label="Other GST gaps" value={String(gstBlockers - num(readiness,"unverified_input_itc"))} hint="Evidence / invoice tax / IRN" tone={gstBlockers - num(readiness,"unverified_input_itc") ? "danger" : "ok"} />
        <Kpi label="Trial balance" value={Math.abs(num(readiness,"trial_balance_difference_inr")) <= 0.01 ? "Balanced" : money(readiness.trial_balance_difference_inr)} hint="Posted journal difference" tone={Math.abs(num(readiness,"trial_balance_difference_inr")) <= 0.01 ? "ok" : "danger"} />
      </div>
      {message ? <div role="status" className="rounded-lg border border-border bg-surface px-4 py-3 text-sm text-muted">{message}</div> : null}

      <Panel title="GST / Tax Registration" kicker="Approved supplier identity for tax invoices">
        <form onSubmit={(event) => { event.preventDefault(); void run(() => saveTaxRegistration({ data: tax }), "Controlled tax registration updated."); }} className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Field label="Legal name"><input className="control mt-1.5" value={tax.legalName} onChange={(e)=>setTax({...tax,legalName:e.target.value})}/></Field>
          <Field label="Trade name"><input className="control mt-1.5" value={tax.tradeName} onChange={(e)=>setTax({...tax,tradeName:e.target.value})}/></Field>
          <Field label="GSTIN"><input className="control mt-1.5 uppercase" maxLength={15} value={tax.gstin} onChange={(e)=>setTax({...tax,gstin:e.target.value.toUpperCase()})}/></Field>
          <Field label="State code"><input className="control mt-1.5" maxLength={2} value={tax.stateCode} onChange={(e)=>setTax({...tax,stateCode:e.target.value.replace(/\D/g,"").slice(0,2)})}/></Field>
          <Field label="PAN"><input className="control mt-1.5 uppercase" value={tax.pan} onChange={(e)=>setTax({...tax,pan:e.target.value.toUpperCase()})}/></Field>
          <Field label="AATO · ₹"><input className="control mt-1.5" type="number" min="0" value={tax.aatoInr} onChange={(e)=>setTax({...tax,aatoInr:Number(e.target.value)})}/></Field>
          <Field label="Effective from"><input className="control mt-1.5" type="date" value={tax.effectiveFrom} onChange={(e)=>setTax({...tax,effectiveFrom:e.target.value})}/></Field>
          <label className="flex min-h-11 items-center gap-2 self-end rounded-lg border border-border px-3 text-xs text-muted"><input type="checkbox" checked={tax.eInvoiceApplicable} onChange={(e)=>setTax({...tax,eInvoiceApplicable:e.target.checked})}/>Governed e-invoice applicability enabled</label>
          <Field label="Registered address"><textarea className="control mt-1.5 min-h-24" value={tax.registeredAddress} onChange={(e)=>setTax({...tax,registeredAddress:e.target.value})}/></Field>
          <Field label="Registration / CA evidence"><input className="control mt-1.5" value={tax.sourceReference} onChange={(e)=>setTax({...tax,sourceReference:e.target.value})}/></Field>
          <div className="flex items-end"><button disabled={busy || !tax.legalName || !tax.gstin || !tax.registeredAddress || !tax.stateCode || !tax.sourceReference} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-bg disabled:opacity-40"><ShieldCheck className="size-4"/>Save approved profile</button></div>
        </form>
      </Panel>

      <Panel title="GST Period Summary" kicker="Output GST less verified eligible input GST">
        <div className="overflow-x-auto"><table className="w-full min-w-[980px] text-sm"><thead className="border-b border-border text-[10px] uppercase tracking-wider text-subtle"><tr><th className="px-3 py-3 text-left">Period</th><th className="px-3 py-3 text-right">Output taxable</th><th className="px-3 py-3 text-right">Output GST</th><th className="px-3 py-3 text-right">Eligible input GST</th><th className="px-3 py-3 text-right">Ineligible input GST</th><th className="px-3 py-3 text-right">Unverified ITC</th><th className="px-3 py-3 text-right">Net GST</th></tr></thead><tbody>{data.gstSummary.map((row)=><tr key={text(row,"period")} className="border-t border-border/70"><td className="px-3 py-3 font-mono text-xs">{text(row,"period")}</td><td className="px-3 py-3 text-right">{money(row.output_taxable_inr)}</td><td className="px-3 py-3 text-right">{money(row.output_gst_inr)}</td><td className="px-3 py-3 text-right">{money(row.eligible_input_gst_inr)}</td><td className="px-3 py-3 text-right">{money(row.ineligible_input_gst_inr)}</td><td className="px-3 py-3 text-right">{String(row.unverified_input_itc_count ?? 0)}</td><td className="px-3 py-3 text-right font-semibold">{money(row.net_gst_payable_inr)}</td></tr>)}</tbody></table>{!data.gstSummary.length ? <Empty>No GST ledger activity yet.</Empty> : null}</div>
      </Panel>

      <Panel title="Bank Reconciliation Close" kicker="Statement ↔ Bank GL ↔ canonical cash / VIBPE">
        <form onSubmit={(event)=>{event.preventDefault();void run(()=>prepareCashReconciliation({data:bank}),`${bank.period} bank reconciliation prepared for M${bank.planMonth}.`);}} className="grid gap-3 md:grid-cols-2 xl:grid-cols-7">
          <Field label="Session ID"><input className="control mt-1.5" value={bank.id} onChange={(e)=>setBank({...bank,id:e.target.value})} placeholder="BANKREC-2026-09"/></Field>
          <Field label="Bank account"><input className="control mt-1.5" value={bank.bankAccountRef} onChange={(e)=>setBank({...bank,bankAccountRef:e.target.value})}/></Field>
          <Field label="Finance period"><input className="control mt-1.5" type="month" value={bank.period} onChange={(e)=>setBank({...bank,period:e.target.value})}/></Field>
          <Field label="VIBPE cash month · M1–M36"><input className="control mt-1.5" type="number" min="1" max="36" step="1" value={bank.planMonth} onChange={(e)=>setBank({...bank,planMonth:Number(e.target.value)})}/></Field>
          <Field label="Opening balance"><input className="control mt-1.5" type="number" step="0.01" value={bank.openingBalanceInr} onChange={(e)=>setBank({...bank,openingBalanceInr:Number(e.target.value)})}/></Field>
          <Field label="Closing balance"><input className="control mt-1.5" type="number" step="0.01" value={bank.closingBalanceInr} onChange={(e)=>setBank({...bank,closingBalanceInr:Number(e.target.value)})}/></Field>
          <Field label="Statement evidence"><input className="control mt-1.5" value={bank.evidenceReference} onChange={(e)=>setBank({...bank,evidenceReference:e.target.value})}/></Field>
          <div className="flex items-end"><button disabled={busy || !bank.id || !bank.bankAccountRef || !bank.period || bank.planMonth<1 || bank.planMonth>36 || !bank.evidenceReference} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-bg disabled:opacity-40"><Landmark className="size-4"/>Prepare reconciliation</button></div>
        </form>
        <p className="mt-3 text-xs leading-5 text-muted">The M-number is explicit governance data. VYNDI does not convert the calendar finance period into M1–M36 automatically.</p>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{data.cashTruth.map((row)=><article key={text(row,"id")} className="rounded-xl border border-border p-4 text-sm"><p className="font-mono text-xs text-accent">{text(row,"id")} · {text(row,"period")} · {row.plan_month ? `M${String(row.plan_month)}` : "legacy mapping absent"}</p><p className="mt-2 text-muted">Statement close {money(row.closing_balance_inr)} · Bank GL close {row.book_closing_balance_inr == null ? "not captured" : money(row.book_closing_balance_inr)}</p><p className="mt-1 text-muted">Canonical cash {row.canonical_closing_cash_inr == null ? "not verified" : money(row.canonical_closing_cash_inr)}</p><p className="mt-1 text-xs text-muted">Statement↔GL Δ {row.statement_gl_difference_inr == null ? "—" : money(row.statement_gl_difference_inr)} · Statement↔VIBPE Δ {row.statement_canonical_difference_inr == null ? "—" : money(row.statement_canonical_difference_inr)}</p><p className="mt-1 text-xs text-muted">{text(row,"approved_by") ? "Approved · three-way cash truth checked" : "Prepared · approval pending"}</p>{!text(row,"approved_by") ? <button type="button" disabled={busy} onClick={()=>{const ref=window.prompt("Approval evidence reference",text(row,"evidence_reference"))?.trim();if(ref)void run(()=>approveCashReconciliation({data:{id:text(row,"id"),evidenceReference:ref}}),`${text(row,"id")} approved against Bank and canonical cash.`);}} className="mt-3 text-xs font-semibold text-accent">Approve reconciliation</button>:null}</article>)}</div>
      </Panel>

      <Panel title="Inventory Stocktake Evidence" kicker="Physical count → maker/checker → FIFO/accounting adjustment">
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="max-w-3xl text-xs leading-5 text-muted">Hard close requires one posted stocktake for the selected finance period and no draft, submitted or approved stocktake still open.</p>
          <Link to="/command/inventory-stocktake" className="shrink-0 text-xs font-semibold text-accent">Open stocktake control</Link>
        </div>
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          {data.stocktakes.map((row)=><div key={text(row,"id")} className="rounded-lg border border-border p-3 text-sm">
            <div className="flex items-center justify-between gap-2"><span className="font-mono text-xs text-accent">{text(row,"period")}</span><span className="text-xs font-semibold uppercase">{text(row,"status")}</span></div>
            <p className="mt-2 text-xs text-muted">Variance lines {String(row.variance_line_count ?? 0)} · gain {money(row.gain_value_inr)} · loss {money(row.loss_value_inr)}</p>
            <p className="mt-1 text-[11px] text-subtle break-words">{text(row,"finance_journal_id") || text(row,"evidence_reference")}</p>
          </div>)}
          {!data.stocktakes.length ? <Empty>No controlled stocktake has been captured yet.</Empty> : null}
        </div>
      </Panel>

      <Panel title="Accounting Period Close" kicker="Open → soft close → hard lock">
        <form onSubmit={(event)=>{event.preventDefault();void run(()=>setFinancePeriodStatus({data:close}),`${close.period} set to ${close.status}.`);}} className="grid gap-3 md:grid-cols-4">
          <Field label="Period"><input className="control mt-1.5" type="month" value={close.period} onChange={(e)=>setClose({...close,period:e.target.value})}/></Field>
          <Field label="Target status"><select className="control mt-1.5" value={close.status} onChange={(e)=>setClose({...close,status:e.target.value as typeof close.status})}><option value="open">Open / reopen</option><option value="soft_closed">Soft closed</option><option value="hard_closed">Hard closed / locked</option></select></Field>
          <Field label="Close / reopen evidence"><input className="control mt-1.5" value={close.evidenceReference} onChange={(e)=>setClose({...close,evidenceReference:e.target.value})}/></Field>
          <div className="flex items-end"><button disabled={busy || !close.period || !close.evidenceReference} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-bg disabled:opacity-40"><BookLock className="size-4"/>Apply period control</button></div>
        </form>
        <p className="mt-3 text-xs leading-5 text-muted">Hard close is database-blocked unless bank/cash reconciliation, GST/statutory evidence, trial balance and the controlled period stocktake are blocker-free. The period needs one posted stocktake and no open stocktake session.</p>
        <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-4">{data.closures.map((row)=><div key={text(row,"period")} className="rounded-lg border border-border p-3 text-sm"><span className="font-mono text-xs text-accent">{text(row,"period")}</span><p className="mt-1 font-semibold">{text(row,"status")}</p><p className="mt-1 text-xs text-muted break-words">{text(row,"evidence_reference")}</p></div>)}</div>
      </Panel>

      <Panel title="CA Evidence Pack" kicker="Point-in-time reconciled control snapshot">
        <form onSubmit={(event)=>{event.preventDefault();void run(()=>captureCaEvidencePack({data:pack}),`${pack.id} captured.`);}} className="grid gap-3 md:grid-cols-4">
          <Field label="Pack ID"><input className="control mt-1.5" value={pack.id} onChange={(e)=>setPack({...pack,id:e.target.value})} placeholder="CA-2026-09-R1"/></Field>
          <Field label="Period"><input className="control mt-1.5" type="month" value={pack.period} onChange={(e)=>setPack({...pack,period:e.target.value})}/></Field>
          <Field label="Evidence index / folder"><input className="control mt-1.5" value={pack.evidenceReference} onChange={(e)=>setPack({...pack,evidenceReference:e.target.value})}/></Field>
          <div className="flex items-end"><button disabled={busy || !pack.id || !pack.period || !pack.evidenceReference} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-bg disabled:opacity-40"><ReceiptText className="size-4"/>Capture pack</button></div>
        </form>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{data.packs.map((row)=><article key={text(row,"id")} className="rounded-xl border border-border p-4"><div className="flex items-center justify-between gap-2"><p className="font-mono text-xs text-accent">{text(row,"id")} · {text(row,"period")}</p><BadgeCheck className={text(row,"status")==="approved"?"size-4 text-ok":"size-4 text-muted"}/></div><p className="mt-2 text-sm font-semibold">{text(row,"status")} · {String(row.blocker_count ?? 0)} blocker(s)</p><p className="mt-2 text-xs text-muted break-words">{text(row,"evidence_reference")}</p>{text(row,"status")==="review_ready" ? <button type="button" disabled={busy} onClick={()=>{const ref=window.prompt("CA approval evidence reference",text(row,"evidence_reference"))?.trim();if(ref)void run(()=>approveCaEvidencePack({data:{id:text(row,"id"),evidenceReference:ref}}),`${text(row,"id")} approved.`);}} className="mt-3 text-xs font-semibold text-accent">Approve evidence pack</button>:null}</article>)}{!data.packs.length ? <Empty>No CA evidence packs captured yet.</Empty> : null}</div>
      </Panel>

      <div className="rounded-xl border border-border bg-surface p-4 text-xs leading-5 text-muted"><span className="font-semibold text-fg">Reliance boundary:</span> VYNDI controls source evidence, tax fields, ITC classification, reconciliation, locks and review packs. GST/TDS returns, legal tax interpretation and certified statutory books remain subject to the appointed CA and applicable law.</div>
    </main>
  );
}
function Field({label,children}:{label:string;children:ReactNode}){return <label className="text-xs font-medium text-muted">{label}{children}</label>;}
function Empty({children}:{children:ReactNode}){return <div className="rounded-xl border border-dashed border-border p-5 text-sm text-muted">{children}</div>;}
