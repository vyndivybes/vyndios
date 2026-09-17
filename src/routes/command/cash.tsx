import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Kpi, Panel } from "@/components/kpi";
import { listCanonicalCashAuthority } from "@/lib/finance-governance-authority";
import {
  CASH_ACCOUNTING_CLASSIFICATIONS,
  CASH_FUNDING_SOURCES,
  listCashFundingReceipts,
  postCashFundingReceipt,
} from "@/lib/cash-funding-authority";

type Row = Record<string, unknown>;
const num = (row: Row, ...keys: string[]) => { for (const key of keys) if (row[key] != null) return Number(row[key]) || 0; return 0; };
const text = (row: Row, ...keys: string[]) => { for (const key of keys) if (row[key] != null) return String(row[key]); return ""; };
const money = (value: number) => `₹${value.toFixed(2)}L`;
const humanize = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

export const Route = createFileRoute("/command/cash")({
  loader: async () => {
    const [authority, receipts] = await Promise.all([
      listCanonicalCashAuthority(),
      listCashFundingReceipts(),
    ]);
    return { authority, receipts };
  },
  component: Cash,
});

function Cash() {
  const router = useRouter();
  const data = Route.useLoaderData() as { authority: Row[]; receipts: Row[] };
  const rows = data.authority;
  const receipts = data.receipts;
  const evidenced = rows.filter((row) => Boolean(row.verified));
  const latest = [...evidenced].reverse().find((row) => text(row,"source_reference","sourceReference"));
  const lowest = evidenced.length ? Math.min(...evidenced.map((row) => num(row,"closing_cash_lakh","closingCashLakh"))) : 0;
  const latestMonth = latest ? num(latest,"plan_month","planMonth") : 0;
  const latestCash = latest ? num(latest,"closing_cash_lakh","closingCashLakh") : 0;
  const postedFunding = receipts.filter((row) => Boolean(row.verified)).reduce((sum, row) => sum + num(row,"amount_lakh","amountLakh"), 0);

  const [planMonth, setPlanMonth] = useState(String(latestMonth || 1));
  const [receivedOn, setReceivedOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState("");
  const [fundingSource, setFundingSource] = useState<(typeof CASH_FUNDING_SOURCES)[number]>("founder_funding");
  const [classification, setClassification] = useState<(typeof CASH_ACCOUNTING_CLASSIFICATIONS)[number]>("pending");
  const [evidence, setEvidence] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const preview = useMemo(() => {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0 || Number(planMonth) !== latestMonth) return null;
    return latestCash + value;
  }, [amount, latestCash, latestMonth, planMonth]);

  async function postReceipt(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setStatus("");
    const amountLakh = Number(amount);
    const month = Number(planMonth);
    if (!Number.isFinite(amountLakh) || amountLakh <= 0) {
      setError("Enter a positive funding amount in lakh.");
      return;
    }
    setBusy(true);
    try {
      const result = await postCashFundingReceipt({
        data: {
          planMonth: month,
          receivedOn,
          amountLakh,
          fundingSource,
          accountingClassification: classification,
          evidenceReference: evidence,
          notes,
        },
      });
      setStatus(`${result.receiptId} posted. Canonical M${month} closing cash is now ${money(result.newClosingCashLakh)}. ${result.note}`);
      setAmount("");
      setEvidence("");
      setNotes("");
      await router.invalidate();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Cash funding receipt could not be posted.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="space-y-6">
    <header className="border-b border-border pb-6"><p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-green">Finance · canonical cash authority</p><h1 className="mt-1 font-display text-4xl text-accent">Cash & Working Capital</h1><p className="mt-2 max-w-4xl text-sm leading-6 text-muted">Verified closing cash remains the canonical balance. New non-operating funding is posted as an individual append-only receipt first, then rolls into that balance without erasing the identity of earlier receipts.</p><div className="mt-3 flex gap-3 text-sm font-semibold"><Link to="/command/financial-cockpit" className="text-accent">Finance cockpit →</Link><Link to="/command/balance-sheet" className="text-accent">Balance Sheet →</Link></div></header>

    <div className="grid gap-3 sm:grid-cols-5"><Kpi label="Current canonical cash" value={money(latestCash)} hint={latestMonth ? `Verified M${latestMonth}` : "No verified cash"} tone={latestCash < 0 ? "danger" : "ok"}/><Kpi label="Evidenced months" value={String(evidenced.length)} hint="Verified / transaction-derived" tone={evidenced.length ? "ok" : "warn"}/><Kpi label="Recorded funding receipts" value={String(receipts.length)} hint={`${money(postedFunding)} posted through receipt register`} tone="ok"/><Kpi label="Lowest posted cash" value={money(lowest)} hint="Across evidenced months" tone={lowest < 0 ? "danger" : "ok"}/><Kpi label="Authority" value="Canonical" hint="vyndi_cash_authority" tone="ok"/></div>

    <Panel title="Add verified funding receipt" kicker="Append-only cash evidence · prior records preserved">
      <form onSubmit={postReceipt} className="grid gap-4 lg:grid-cols-12">
        <label className="lg:col-span-2"><span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Plan month</span><input aria-label="Plan month" type="number" min={1} max={36} value={planMonth} onChange={(event)=>setPlanMonth(event.target.value)} className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm"/></label>
        <label className="lg:col-span-2"><span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Received on</span><input aria-label="Received on" type="date" value={receivedOn} onChange={(event)=>setReceivedOn(event.target.value)} className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm"/></label>
        <label className="lg:col-span-2"><span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Amount · ₹ lakh</span><input aria-label="Funding amount in lakh" type="number" min="0.0001" step="0.01" value={amount} onChange={(event)=>setAmount(event.target.value)} placeholder="3.00" className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm"/></label>
        <label className="lg:col-span-3"><span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Funding source</span><select aria-label="Funding source" value={fundingSource} onChange={(event)=>setFundingSource(event.target.value as (typeof CASH_FUNDING_SOURCES)[number])} className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm">{CASH_FUNDING_SOURCES.map((value)=><option key={value} value={value}>{humanize(value)}</option>)}</select></label>
        <label className="lg:col-span-3"><span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Accounting classification</span><select aria-label="Accounting classification" value={classification} onChange={(event)=>setClassification(event.target.value as (typeof CASH_ACCOUNTING_CLASSIFICATIONS)[number])} className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm">{CASH_ACCOUNTING_CLASSIFICATIONS.map((value)=><option key={value} value={value}>{humanize(value)}</option>)}</select></label>
        <label className="lg:col-span-7"><span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Bank / UTR / evidence reference</span><input aria-label="Funding evidence reference" required value={evidence} onChange={(event)=>setEvidence(event.target.value)} placeholder="UTR / bank statement / grant reference" className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm"/></label>
        <label className="lg:col-span-5"><span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Notes</span><input aria-label="Funding notes" value={notes} onChange={(event)=>setNotes(event.target.value)} placeholder="Purpose / tranche note; no legal classification assumption" className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm"/></label>
        <div className="lg:col-span-12 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-bg-elevated/50 p-3">
          <p className="text-xs leading-5 text-muted">Each posting receives a unique <code>CASH-…</code> identity. Evidence references cannot be reused. Selecting <strong>Pending</strong> preserves the cash receipt without pretending its legal/accounting classification has already been determined.{preview != null ? ` Preview: ${money(latestCash)} + ${money(Number(amount))} = ${money(preview)}.` : ""}</p>
          <button disabled={busy} type="submit" className="rounded-full border border-accent bg-accent/10 px-5 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-accent disabled:opacity-50">{busy ? "Posting…" : "Post verified receipt"}</button>
        </div>
        {status ? <p role="status" className="lg:col-span-12 rounded-xl border border-ok/40 bg-ok/10 px-3 py-2 text-sm text-ok">{status}</p> : null}
        {error ? <p role="alert" className="lg:col-span-12 rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p> : null}
      </form>
    </Panel>

    <Panel title="Funding Receipt Register" kicker="Individual identity · chronological evidence">
      {receipts.length ? <div className="overflow-x-auto"><table className="w-full min-w-[980px] text-sm"><thead className="border-b border-border text-[10px] uppercase tracking-wider text-subtle"><tr><th className="px-3 py-3 text-left">Receipt</th><th className="px-3 py-3 text-left">Date / month</th><th className="px-3 py-3 text-right">Amount</th><th className="px-3 py-3 text-left">Source</th><th className="px-3 py-3 text-left">Classification</th><th className="px-3 py-3 text-left">Evidence</th></tr></thead><tbody>{receipts.map((row)=><tr key={text(row,"id")} className="border-t border-border/70"><td className="px-3 py-3 font-mono text-xs">{text(row,"id")}</td><td className="px-3 py-3">{text(row,"received_on","receivedOn")} · M{num(row,"plan_month","planMonth")}</td><td className="px-3 py-3 text-right font-semibold tabular-nums">{money(num(row,"amount_lakh","amountLakh"))}</td><td className="px-3 py-3">{humanize(text(row,"funding_source","fundingSource"))}</td><td className="px-3 py-3"><span className={text(row,"accounting_classification","accountingClassification") === "pending" ? "text-warn" : "text-ok"}>{humanize(text(row,"accounting_classification","accountingClassification"))}</span></td><td className="px-3 py-3"><span className="font-semibold text-ok">VERIFIED</span><p className="mt-1 max-w-sm text-[10px] text-muted">{text(row,"evidence_reference","evidenceReference")}</p>{text(row,"notes") ? <p className="mt-1 max-w-sm text-[10px] text-subtle">{text(row,"notes")}</p> : null}</td></tr>)}</tbody></table></div> : <div className="rounded-xl border border-dashed border-border px-4 py-5 text-sm text-muted">No structured funding receipts have been posted through this register yet. Existing verified cash remains the historical canonical balance; VYNDI does not manufacture synthetic ₹5L/₹10L receipt rows without source evidence.</div>}
    </Panel>

    <Panel title="Cash Authority Register" kicker="Verified actuals · transaction lineage"> <div className="overflow-x-auto"><table className="w-full min-w-[1050px] text-sm"><thead className="border-b border-border text-[10px] uppercase tracking-wider text-subtle"><tr><th className="px-3 py-3 text-left">Month</th><th className="px-3 py-3 text-right">Closing cash</th><th className="px-3 py-3 text-right">Receivables</th><th className="px-3 py-3 text-right">Inventory</th><th className="px-3 py-3 text-right">Payables</th><th className="px-3 py-3 text-right">Transaction revenue</th><th className="px-3 py-3 text-left">Evidence</th></tr></thead><tbody>{rows.map((row) => { const verified=Boolean(row.verified); return <tr key={num(row,"plan_month","planMonth")} className="border-t border-border/70"><td className="px-3 py-3 font-semibold">M{num(row,"plan_month","planMonth")}</td><td className="px-3 py-3 text-right tabular-nums">{money(num(row,"closing_cash_lakh","closingCashLakh"))}</td><td className="px-3 py-3 text-right tabular-nums">{money(num(row,"receivables_lakh","receivablesLakh"))}</td><td className="px-3 py-3 text-right tabular-nums">{money(num(row,"inventory_lakh","inventoryLakh"))}</td><td className="px-3 py-3 text-right tabular-nums">{money(num(row,"payables_lakh","payablesLakh"))}</td><td className="px-3 py-3 text-right tabular-nums">{money(num(row,"transaction_revenue_lakh","transactionRevenueLakh"))}</td><td className="px-3 py-3"><span className={verified ? "font-semibold text-ok" : "text-muted"}>{verified ? "VERIFIED" : "No posted evidence"}</span><p className="mt-1 max-w-xs text-[10px] text-muted">{text(row,"source_reference","sourceReference") || "—"}</p></td></tr>; })}</tbody></table></div></Panel>
    <p className="text-xs text-muted">Canonical source: <code>vyndi_cash_authority</code>. Structured funding receipts are append-only evidence records; only their verified amount increments an existing verified monthly closing-cash authority. Historical cash evidence is never silently reclassified.</p>
  </div>;
}
