import type { FinancialStatementPack } from "./financial-statements.ts";

/**
 * Read-only management BI for a single posted-ledger statement period.
 * No independent accounting truth, financial postings or modelled actuals.
 * "Direct asset-bank CAPEX" is a documented subset, NOT complete cash CAPEX.
 */
const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const ratio = (n: number, d: number) => d > 0 ? round(n / d * 100) : null;
const daysBetween = (from: string, to: string) => {
  const a = Date.parse(from + "T00:00:00Z");
  const b = Date.parse(to + "T00:00:00Z");
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return Math.round((b - a) / 86400000) + 1;
};
const account = (p: FinancialStatementPack, code: string) =>
  p.trialBalance.find(r => r.accountCode === code)?.balanceInr ?? 0;
const cashLine = (p: FinancialStatementPack, label: string) =>
  p.cashFlow.rows.find(row => row.label === label)?.amountInr;

export function projectFinancialIntelligence(p: FinancialStatementPack) {
  const differences = [p.balanceSheet.balanceDifferenceInr,p.cashFlow.reconciliationDifferenceInr,p.fundFlow.reconciliationDifferenceInr];
  const reconciled = differences.every(x=>finite(x) && Math.abs(x)<=0.01);
  const actuals = reconciled && p.evidence.periodJournalCount > 0;
  const status = !reconciled ? "RECONCILIATION_HOLD" : actuals ? "POSTED_ACTUALS" : "NO_POSTED_ACTIVITY";
  const revenue = p.trading.accrual.rows.find(r=>r.label === "Net sales / product revenue")?.amountInr;
  const cogsRow = p.trading.accrual.rows.find(r=>r.label === "Less: Cost of goods sold")?.amountInr;
  const cogs = finite(cogsRow) ? -cogsRow : null;
  const days = daysBetween(p.period.fromDate,p.period.toDate);
  const receivables = Math.max(0,account(p,"1100"));
  const payables = Math.max(0,-account(p,"2000"));
  const inventory = Math.max(0,account(p,"1200") + account(p,"1210") + account(p,"1220"));
  const dso = actuals && finite(revenue) && revenue > 0 && days !== null ? round(receivables / revenue * days) : null;
  const dio = actuals && finite(cogs) && cogs > 0 && days !== null ? round(inventory / cogs * days) : null;
  // This is deliberately NOT called formal DPO: COGS is only a proxy for
  // credit purchases until the due-date qualified purchase ledger is joined.
  const payablesToCogs = actuals && finite(cogs) && cogs > 0 && days !== null ? round(payables / cogs * days) : null;
  const operating = cashLine(p,"Operating activities");
  const directCapex = p.cashFlow.directCashCapexInr;
  return Object.freeze({
    status,
    period: p.period,
    source: "POSTED_GENERAL_LEDGER",
    capexCoverage: actuals && finite(directCapex) ? "DIRECT_ASSET_BANK_ONLY" : "UNAVAILABLE",
    operatingCashFlowInr: actuals && finite(operating) ? operating : null,
    directCashCapexInr: actuals && finite(directCapex) ? directCapex : null,
    indicativeFreeCashFlowInr: actuals && finite(operating) && finite(directCapex) ? round(operating-directCapex) : null,
    revenueInr: actuals && finite(revenue) ? revenue : null,
    grossMarginPct: actuals && finite(revenue) && revenue > 0 ? ratio(p.trading.accrual.resultInr,revenue) : null,
    netMarginPct: actuals && finite(revenue) && revenue > 0 ? ratio(p.profitLoss.accrual.resultInr,revenue) : null,
    workingCapitalInr: actuals ? p.fundFlow.closingWorkingCapitalInr : null,
    closingReceivablesInr: actuals ? receivables : null,
    closingPayablesInr: actuals ? payables : null,
    closingInventoryInr: actuals ? inventory : null,
    dsoDays: dso,
    dioDays: dio,
    payablesToCogsDays: payablesToCogs,
    cashConversionCycleProxyDays: dso !== null && dio !== null && payablesToCogs !== null ?
      round(dso+dio-payablesToCogs) : null,
    note: "Indicative FCF deducts only directly evidenced fixed-asset bank CAPEX. CAPEX paid via payables, timing offsets and other investing cash may be missing. DIO, DSO and payables days use closing balances and are management period proxies, not certified turnover measures.",
  });
}
