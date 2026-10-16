import { useEffect, useRef, useState } from "react";
import { Panel } from "@/components/kpi";
import type { buildPayablesAgingReport } from "@/lib/finance/payables-report";

export type PayablesAgingReport = ReturnType<typeof buildPayablesAgingReport>;
const formatMoney = (value: number) => new Intl.NumberFormat("en-IN", {
  style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2,
}).format(value);
const bucketLabels = [
  ["notDueInr", "Not overdue"], ["overdue1To30Inr", "1–30 days"],
  ["overdue31To60Inr", "31–60 days"], ["overdue61To90Inr", "61–90 days"],
  ["overdueOver90Inr", "Over 90 days"],
] as const;

export function PayablesAgingReportPanel({ loadReport, disabled = false }: {
  loadReport: (asOfDate: string) => Promise<PayablesAgingReport>;
  disabled?: boolean;
}) {
  const [asOfDate, setAsOfDate] = useState("");
  const [report, setReport] = useState<PayablesAgingReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const request = useRef(0);
  useEffect(() => () => { request.current++; }, []);

  async function load() {
    const current = ++request.current;
    setLoading(true);
    setReport(null);
    setError("");
    try {
      const result = await loadReport(asOfDate);
      if (current === request.current) setReport(result);
    } catch (cause) {
      if (current === request.current) setError(cause instanceof Error ? cause.message : "The payable report could not be loaded.");
    } finally {
      if (current === request.current) setLoading(false);
    }
  }

  return <Panel title="Payable ageing" kicker="As-of report · INR · posted books" printable={false}>
    <form className="flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={event => { event.preventDefault(); if (!loading && !disabled && asOfDate) void load(); }}>
      <label className="text-sm text-muted">Report date
        <input type="date" required value={asOfDate} className="control mt-1.5 min-h-11 w-full" onInput={event => {
          request.current++;
          setAsOfDate(event.currentTarget.value);
          setReport(null);
          setError("");
          setLoading(false);
        }} />
      </label>
      <button type="submit" disabled={disabled || loading || !asOfDate} className="min-h-11 rounded-lg border border-border px-4 py-2 text-sm font-semibold text-accent hover:border-accent disabled:opacity-40">
        {loading ? "Loading report…" : "Load report"}
      </button>
    </form>
    <p className="mt-3 text-xs leading-5 text-muted">Uses posted accounting dates, including dated reversals. Supplier recoverables are separate. A matching balance does not approve a payment or financial close.</p>
    <div aria-live="polite" aria-busy={loading} className="mt-4">
      {loading ? <p role="status" className="text-sm text-muted">Loading the selected report…</p> : null}
      {error ? <p role="alert" className="rounded-lg border border-danger p-3 text-sm text-danger">Report unavailable. {error}</p> : null}
      {!report && !loading && !error ? <p className="text-sm text-muted">Select a date to load payable ageing and compare it with the posted ledger.</p> : null}
      {report ? <div className="space-y-4">
        <p className="text-sm text-muted">{report.entity} · As of <time dateTime={report.aging.asOfDate}>{report.aging.asOfDate}</time></p>
        <dl className="grid gap-3 sm:grid-cols-3">
          <div><dt className="text-xs text-muted">Outstanding bills</dt><dd className="mt-1 font-semibold tabular-nums text-fg">{formatMoney(report.aging.totalOutstandingInr)}</dd></div>
          <div><dt className="text-xs text-muted">Posted payable ledger</dt><dd className="mt-1 font-semibold tabular-nums text-fg">{formatMoney(report.reconciliation.ledgerBalanceInr)}</dd></div>
          <div><dt className="text-xs text-muted">Ledger minus bills</dt><dd className="mt-1 font-semibold tabular-nums text-fg">{formatMoney(report.reconciliation.differenceInr)}</dd></div>
        </dl>
        <p role="status" className={report.reconciliation.reconciled ? "text-sm text-muted" : "text-sm font-semibold text-danger"}>
          {report.reconciliation.reconciled ? "Balances match for this snapshot. Review supporting records before approval." : "Balances differ. Investigate ledger postings and bill allocations before relying on this report."}
        </p>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {bucketLabels.map(([key, label]) => <div key={key} className="min-w-0 rounded-lg border border-border p-3"><dt className="text-xs text-muted">{label}</dt><dd className="mt-1 break-words text-sm tabular-nums text-fg">{formatMoney(report.aging.buckets[key])}</dd></div>)}
        </dl>
        {report.aging.lines.length === 0 ? <p className="text-sm text-muted">No posted supplier invoices fall within this report date.</p> : <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Supplier bills as of {report.aging.asOfDate}</caption>
            <thead className="border-b border-border text-xs text-muted"><tr><th className="px-2 py-3">Invoice / supplier</th><th className="px-2 py-3">Due</th><th className="px-2 py-3 text-right">Payments and offsets</th><th className="px-2 py-3 text-right">Outstanding</th></tr></thead>
            <tbody>{report.aging.lines.map(line => <tr key={line.id} className="border-b border-border">
              <td className="px-2 py-3"><span className="break-all text-fg">{line.id}</span><span className="block break-all text-xs text-muted">{line.partyId}</span></td>
              <td className="whitespace-nowrap px-2 py-3 text-muted">{line.dueDate}</td>
              <td className="whitespace-nowrap px-2 py-3 text-right tabular-nums text-fg">{formatMoney(line.paidInr)}</td>
              <td className="whitespace-nowrap px-2 py-3 text-right tabular-nums text-fg">{formatMoney(line.outstandingInr)}</td>
            </tr>)}</tbody>
          </table>
        </div>}
        <details className="text-xs text-muted"><summary className="min-h-11 cursor-pointer py-3">Supporting ledger references</summary>
          {report.reconciliation.journalIds.length ? <ul className="space-y-1">{report.reconciliation.journalIds.map(id => <li key={id} className="break-all">{id}</li>)}</ul> : <p>No payable ledger entries for this date.</p>}
        </details>
      </div> : null}
    </div>
  </Panel>;
}
