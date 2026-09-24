import { createFileRoute, Link } from "@tanstack/react-router";
import { Download, FileSpreadsheet, Printer, Scale } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Kpi, Panel } from "@/components/kpi";
import { getAccountingStatements } from "@/lib/finance/accounting-authority";
import type {
  FinancialStatementPack,
  StatementAmountRow,
  StatementSection,
} from "@/lib/finance/financial-statements";

type StatementKey = "trading" | "profitLoss" | "costAccount" | "balanceSheet" | "cashFlow" | "fundFlow" | "trialBalance";
type Basis = "accrual" | "cash";

const statementLabels: Array<[StatementKey, string]> = [
  ["trading", "Trading A/c"],
  ["profitLoss", "Profit & Loss"],
  ["costAccount", "Cost A/c"],
  ["balanceSheet", "Balance Sheet"],
  ["cashFlow", "Cash Flow"],
  ["fundFlow", "Fund Flow"],
  ["trialBalance", "Trial Balance"],
];

function defaultFinancialYearRange() {
  const now = new Date();
  const year = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return {
    fromDate: `${year}-04-01`,
    toDate: now.toISOString().slice(0, 10),
  };
}

export const Route = createFileRoute("/command/accounting-statements")({
  loader: () => getAccountingStatements({ data: defaultFinancialYearRange() }),
  component: AccountingStatements,
});

const money = (value: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(Number(value ?? 0));

const csvEscape = (value: string) => `"${value.replaceAll('"', '""')}"`;

function AccountingStatements() {
  const initial = Route.useLoaderData();
  const [pack, setPack] = useState<FinancialStatementPack>(initial);
  const [range, setRange] = useState(initial.period);
  const [basis, setBasis] = useState<Basis>("accrual");
  const [statement, setStatement] = useState<StatementKey>("trading");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function applyPeriod() {
    setBusy(true);
    setMessage("");
    try {
      const next = await getAccountingStatements({ data: range });
      setPack(next);
      setMessage(`Statement period refreshed: ${range.fromDate} to ${range.toDate}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Statement period could not be refreshed.");
    } finally {
      setBusy(false);
    }
  }

  function currentCsvRows(): Array<[string, number]> {
    if (statement === "trading") return pack.trading[basis].rows.map((row) => [row.label, row.amountInr] as [string, number]).concat([[pack.trading[basis].resultLabel, pack.trading[basis].resultInr]]);
    if (statement === "profitLoss") return pack.profitLoss[basis].rows.map((row) => [row.label, row.amountInr] as [string, number]).concat([[pack.profitLoss[basis].resultLabel, pack.profitLoss[basis].resultInr]]);
    if (statement === "costAccount") return pack.costAccount.rows.map((row) => [row.label, row.amountInr] as [string, number]).concat([
      ["Recorded total actual cost", pack.costAccount.totalActualCostInr],
      ["Finished goods value", pack.costAccount.finishedGoodsValueInr],
      ["WIP value", pack.costAccount.wipValueInr],
    ]);
    if (statement === "balanceSheet") return [
      ...pack.balanceSheet.assets.map((row) => [`Asset · ${row.label}`, row.amountInr] as [string, number]),
      ...pack.balanceSheet.liabilities.map((row) => [`Liability · ${row.label}`, row.amountInr] as [string, number]),
      ...pack.balanceSheet.equity.map((row) => [`Equity · ${row.label}`, row.amountInr] as [string, number]),
      ["Total assets", pack.balanceSheet.totalAssetsInr],
      ["Total liabilities + equity", pack.balanceSheet.totalLiabilitiesEquityInr],
    ];
    if (statement === "cashFlow") return [
      ["Opening cash", pack.cashFlow.openingCashInr],
      ...pack.cashFlow.rows.map((row) => [row.label, row.amountInr] as [string, number]),
      ["Net change in cash", pack.cashFlow.netChangeInCashInr],
      ["Closing cash", pack.cashFlow.closingCashInr],
    ];
    if (statement === "fundFlow") return [
      ...pack.fundFlow.sources.map((row) => [`Source · ${row.label}`, row.amountInr] as [string, number]),
      ...pack.fundFlow.applications.map((row) => [`Application · ${row.label}`, row.amountInr] as [string, number]),
      ["Total sources", pack.fundFlow.totalSourcesInr],
      ["Total applications", pack.fundFlow.totalApplicationsInr],
    ];
    return pack.trialBalance.flatMap((row) => [
      [`${row.accountCode} ${row.accountName} · Debit`, row.debitInr] as [string, number],
      [`${row.accountCode} ${row.accountName} · Credit`, row.creditInr] as [string, number],
    ]);
  }

  function exportCsv() {
    const rows = currentCsvRows();
    const lines = [
      ["VYNDI Finance Statement", statementLabels.find(([key]) => key === statement)?.[1] ?? statement],
      ["Period", `${pack.period.fromDate} to ${pack.period.toDate}`],
      ["Basis", statement === "trading" || statement === "profitLoss" ? basis : "posted actuals"],
      [],
      ["Line", "Amount INR"],
      ...rows.map(([label, value]) => [label, value.toFixed(2)]),
    ];
    const csv = lines.map((row) => row.map((cell) => csvEscape(String(cell ?? ""))).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `VYNDI_${statement}_${pack.period.fromDate}_${pack.period.toDate}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="mx-auto max-w-7xl space-y-6 print:max-w-none">
      <header className="flex flex-col gap-4 border-b border-border pb-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-green">Finance · canonical posted actuals</p>
          <h1 className="mt-2 font-display text-4xl text-accent">Financial Statements</h1>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-muted">
            Trading Account, Profit & Loss, Cost Account, Balance Sheet, Cash Flow, Fund Flow and Trial Balance are compiled from the same posted General Ledger and governed job-cost snapshots. Cash-basis views are timing reconciliations, not a second ledger.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          <Link to="/command/accounting" className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-muted hover:border-accent hover:text-accent">Accounting Workbench</Link>
          <Link to="/command/financial-cockpit" className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-muted hover:border-accent hover:text-accent">Finance Overview</Link>
        </div>
      </header>

      <Panel title="Statement control" kicker="Period · basis · output">
        <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr_auto] lg:items-end">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="From date"><input className="control mt-1.5" type="date" value={range.fromDate} onChange={(event) => setRange({ ...range, fromDate: event.target.value })} /></Field>
            <Field label="To date"><input className="control mt-1.5" type="date" value={range.toDate} onChange={(event) => setRange({ ...range, toDate: event.target.value })} /></Field>
          </div>
          <div>
            <p className="text-xs font-semibold text-muted">Recognition basis</p>
            <div className="mt-1.5 grid grid-cols-2 rounded-lg border border-border p-1">
              {(["accrual", "cash"] as Basis[]).map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={basis === value}
                  onClick={() => setBasis(value)}
                  className={`rounded-md px-3 py-2 text-xs font-semibold uppercase tracking-wider ${basis === value ? "bg-accent text-bg" : "text-muted hover:text-accent"}`}
                >
                  {value}
                </button>
              ))}
            </div>
          </div>
          <button type="button" disabled={busy} onClick={() => void applyPeriod()} className="rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-bg disabled:opacity-50">
            {busy ? "Refreshing…" : "Apply period"}
          </button>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted">
          <span className="rounded-full border border-border px-3 py-1">Actual · posted journals only</span>
          <span className="rounded-full border border-border px-3 py-1">FY default · India Apr–Mar</span>
          <span className="rounded-full border border-border px-3 py-1">Plan / Forecast remain in Financial Cockpit</span>
        </div>
        {message ? <p className="mt-3 text-sm text-muted" role="status">{message}</p> : null}
      </Panel>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Kpi label="Period journals" value={String(pack.evidence.periodJournalCount)} hint="Posted source journals" />
        <Kpi label="Ledger lines" value={String(pack.evidence.periodLineCount)} hint="Selected period" />
        <Kpi label="Job-cost snapshots" value={String(pack.evidence.jobCostSnapshotCount)} hint="Latest per job in period" />
        <Kpi label="Balance check" value={money(Math.abs(pack.balanceSheet.balanceDifferenceInr))} hint="Assets − L+E" tone={Math.abs(pack.balanceSheet.balanceDifferenceInr) <= 0.01 ? "ok" : "danger"} />
        <Kpi label="Cash-flow check" value={money(Math.abs(pack.cashFlow.reconciliationDifferenceInr))} hint="Closing − opening − flows" tone={Math.abs(pack.cashFlow.reconciliationDifferenceInr) <= 0.01 ? "ok" : "danger"} />
      </div>

      <nav className="grid gap-2 sm:grid-cols-4 xl:grid-cols-7 print:hidden" aria-label="Financial statements">
        {statementLabels.map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setStatement(key)}
            className={`rounded-xl border px-3 py-3 text-sm font-semibold ${statement === key ? "border-accent bg-accent/10 text-accent" : "border-border text-muted hover:border-accent/60 hover:text-accent"}`}
          >
            {label}
          </button>
        ))}
      </nav>

      <section className="rounded-2xl border border-border bg-surface p-5 shadow-sm print:border-0 print:p-0 print:shadow-none">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-subtle">VĀYÚ Shastr · VYNDI Finance</p>
            <h2 className="mt-1 font-display text-2xl text-fg">{statementLabels.find(([key]) => key === statement)?.[1]}</h2>
            <p className="mt-1 text-xs text-muted">{pack.period.fromDate} → {pack.period.toDate}</p>
          </div>
          <div className="flex gap-2 print:hidden">
            <button type="button" onClick={exportCsv} className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-muted hover:border-accent hover:text-accent"><Download className="size-4" /> CSV</button>
            <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-muted hover:border-accent hover:text-accent"><Printer className="size-4" /> Print</button>
          </div>
        </div>

        {statement === "trading" ? <StatementTable section={pack.trading[basis]} /> : null}
        {statement === "profitLoss" ? <StatementTable section={pack.profitLoss[basis]} /> : null}
        {statement === "costAccount" ? <CostStatement pack={pack} /> : null}
        {statement === "balanceSheet" ? <BalanceStatement pack={pack} /> : null}
        {statement === "cashFlow" ? <CashFlowStatement pack={pack} /> : null}
        {statement === "fundFlow" ? <FundFlowStatement pack={pack} /> : null}
        {statement === "trialBalance" ? <TrialBalanceStatement pack={pack} /> : null}
      </section>

      <Panel title="Cash basis ↔ accrual basis reconciliation" kicker="Same transactions · different recognition timing">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi label="Accrual revenue" value={money(pack.basisReconciliation.accrualRevenueInr)} hint="Revenue 4000" />
          <Kpi label="Customer cash" value={money(pack.basisReconciliation.cashCustomerReceiptsInr)} hint="Bank movements" />
          <Kpi label="Revenue timing difference" value={money(pack.basisReconciliation.revenueTimingDifferenceInr)} hint="Accrual − cash" />
          <Kpi label="Closing receivables" value={money(pack.basisReconciliation.closingReceivablesInr)} hint="Trade Receivables 1100" />
          <Kpi label="Accrual result" value={money(pack.basisReconciliation.accrualOperatingResultInr)} hint="P&L result" />
          <Kpi label="Cash operating result" value={money(pack.basisReconciliation.cashOperatingResultInr)} hint="Operating cash recognition" />
          <Kpi label="Result timing difference" value={money(pack.basisReconciliation.resultTimingDifferenceInr)} hint="Accrual − cash" />
          <Kpi label="Closing payables" value={money(pack.basisReconciliation.closingPayablesInr)} hint="Trade Payables 2000" />
        </div>
      </Panel>

      <Panel title="Source evidence" kicker="Traceability boundary">
        <div className="grid gap-3 md:grid-cols-3">
          <Evidence icon={<FileSpreadsheet className="size-4" />} label="Accounting authority" value="Posted General Ledger journals and linked reversal journals" />
          <Evidence icon={<Scale className="size-4" />} label="Cost authority" value="Latest governed job-cost snapshot per job inside the selected period" />
          <Evidence icon={<FileSpreadsheet className="size-4" />} label="Latest accounting date" value={pack.evidence.latestEntryDate ?? "No posted journal yet"} />
        </div>
        <p className="mt-4 text-xs leading-5 text-muted">
          Cash-basis Trading and P&L are management timing views derived from Bank 1000 movements. They do not replace statutory accrual books, GST controls, period-close controls or CA review.
        </p>
      </Panel>
    </main>
  );
}

function StatementTable({ section }: { section: StatementSection }) {
  return (
    <div>
      <h3 className="text-lg font-semibold text-fg">{section.title}</h3>
      <div className="mt-4 divide-y divide-border border-y border-border">
        {section.rows.map((row) => <AmountRow key={row.label} row={row} />)}
        <div className="flex items-center justify-between gap-4 py-4 text-base font-bold">
          <span>{section.resultLabel}</span>
          <span className="tabular-nums">{money(section.resultInr)}</span>
        </div>
      </div>
      {section.note ? <p className="mt-4 text-xs leading-5 text-muted">{section.note}</p> : null}
    </div>
  );
}

function CostStatement({ pack }: { pack: FinancialStatementPack }) {
  return (
    <div className="space-y-5">
      <div className="divide-y divide-border border-y border-border">{pack.costAccount.rows.map((row) => <AmountRow key={row.label} row={row} />)}</div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Recorded actual cost" value={money(pack.costAccount.totalActualCostInr)} hint="Governed snapshots" />
        <Kpi label="Weighted unit cost" value={money(pack.costAccount.weightedUnitCostInr)} hint={`${pack.costAccount.plannedQuantity} planned units`} />
        <Kpi label="Finished goods" value={money(pack.costAccount.finishedGoodsValueInr)} hint={`${pack.costAccount.completedQuantity} completed units`} />
        <Kpi label="WIP" value={money(pack.costAccount.wipValueInr)} hint="Remaining job value" />
      </div>
      <p className="text-xs text-muted">Cost-sheet reconciliation difference: {money(pack.costAccount.reconciliationDifferenceInr)}. A non-zero value means the recorded job total does not equal the visible cost-component roll-up and requires source review.</p>
    </div>
  );
}

function BalanceStatement({ pack }: { pack: FinancialStatementPack }) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <StatementColumn title="Assets" rows={pack.balanceSheet.assets} totalLabel="Total assets" total={pack.balanceSheet.totalAssetsInr} />
      <div className="space-y-6">
        <StatementColumn title="Liabilities" rows={pack.balanceSheet.liabilities} totalLabel="Total liabilities" total={pack.balanceSheet.liabilities.reduce((sum, row) => sum + row.amountInr, 0)} />
        <StatementColumn title="Equity" rows={pack.balanceSheet.equity} totalLabel="Liabilities + equity" total={pack.balanceSheet.totalLiabilitiesEquityInr} />
        <p className="text-xs text-muted">Balance difference: {money(pack.balanceSheet.balanceDifferenceInr)}.</p>
      </div>
    </div>
  );
}

function CashFlowStatement({ pack }: { pack: FinancialStatementPack }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between border-y border-border py-3"><span className="font-semibold">Opening cash</span><span className="font-semibold tabular-nums">{money(pack.cashFlow.openingCashInr)}</span></div>
      <div className="divide-y divide-border">{pack.cashFlow.rows.map((row) => <AmountRow key={row.label} row={row} />)}</div>
      <div className="flex items-center justify-between border-y border-border py-3"><span className="font-semibold">Net change in cash</span><span className="font-semibold tabular-nums">{money(pack.cashFlow.netChangeInCashInr)}</span></div>
      <div className="flex items-center justify-between py-3 text-lg font-bold"><span>Closing cash</span><span className="tabular-nums">{money(pack.cashFlow.closingCashInr)}</span></div>
      <p className="text-xs text-muted">Cash-flow reconciliation difference: {money(pack.cashFlow.reconciliationDifferenceInr)}.</p>
    </div>
  );
}

function FundFlowStatement({ pack }: { pack: FinancialStatementPack }) {
  return (
    <div className="space-y-5">
      <div className="grid gap-6 lg:grid-cols-2">
        <StatementColumn title="Sources of funds" rows={pack.fundFlow.sources} totalLabel="Total sources" total={pack.fundFlow.totalSourcesInr} />
        <StatementColumn title="Applications of funds" rows={pack.fundFlow.applications} totalLabel="Total applications" total={pack.fundFlow.totalApplicationsInr} />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Kpi label="Opening working capital" value={money(pack.fundFlow.openingWorkingCapitalInr)} hint="Current assets − current liabilities" />
        <Kpi label="Closing working capital" value={money(pack.fundFlow.closingWorkingCapitalInr)} hint="As of period end" />
        <Kpi label="Fund-flow difference" value={money(pack.fundFlow.reconciliationDifferenceInr)} hint="Sources − applications" tone={Math.abs(pack.fundFlow.reconciliationDifferenceInr) <= 0.01 ? "ok" : "warn"} />
      </div>
    </div>
  );
}

function TrialBalanceStatement({ pack }: { pack: FinancialStatementPack }) {
  const debit = pack.trialBalance.reduce((sum, row) => sum + row.debitInr, 0);
  const credit = pack.trialBalance.reduce((sum, row) => sum + row.creditInr, 0);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead className="border-b border-border text-[10px] uppercase tracking-wider text-subtle">
          <tr><th className="py-3 pr-3">Code</th><th className="py-3 pr-3">Account</th><th className="py-3 pr-3">Type</th><th className="py-3 pr-3 text-right">Debit</th><th className="py-3 text-right">Credit</th></tr>
        </thead>
        <tbody>
          {pack.trialBalance.map((row) => (
            <tr key={row.accountCode} className="border-b border-border/60">
              <td className="py-3 pr-3 font-mono text-xs">{row.accountCode}</td>
              <td className="py-3 pr-3">{row.accountName}</td>
              <td className="py-3 pr-3 text-xs uppercase text-muted">{row.accountType}</td>
              <td className="py-3 pr-3 text-right tabular-nums">{money(row.debitInr)}</td>
              <td className="py-3 text-right tabular-nums">{money(row.creditInr)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot className="font-bold"><tr><td className="py-4" colSpan={3}>Total</td><td className="py-4 pr-3 text-right">{money(debit)}</td><td className="py-4 text-right">{money(credit)}</td></tr></tfoot>
      </table>
    </div>
  );
}

function StatementColumn({ title, rows, totalLabel, total }: { title: string; rows: StatementAmountRow[]; totalLabel: string; total: number }) {
  return (
    <div>
      <h3 className="text-sm font-semibold uppercase tracking-wider text-muted">{title}</h3>
      <div className="mt-2 divide-y divide-border border-y border-border">
        {rows.length ? rows.map((row) => <AmountRow key={row.label} row={row} />) : <p className="py-4 text-sm text-muted">No posted balance.</p>}
        <div className="flex items-center justify-between gap-4 py-4 font-bold"><span>{totalLabel}</span><span className="tabular-nums">{money(total)}</span></div>
      </div>
    </div>
  );
}

function AmountRow({ row }: { row: StatementAmountRow }) {
  return (
    <div className={`flex items-start justify-between gap-4 py-3 ${row.emphasis === "total" ? "font-bold" : row.emphasis === "subtotal" ? "font-semibold" : ""}`}>
      <div><p>{row.label}</p>{row.note ? <p className="mt-1 text-xs font-normal text-muted">{row.note}</p> : null}</div>
      <span className="shrink-0 tabular-nums">{money(row.amountInr)}</span>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="text-xs font-semibold text-muted">{label}{children}</label>;
}

function Evidence({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return <div className="rounded-xl border border-border p-4"><div className="flex items-center gap-2 text-accent">{icon}<p className="text-xs font-semibold uppercase tracking-wider">{label}</p></div><p className="mt-2 text-sm leading-5 text-muted">{value}</p></div>;
}
