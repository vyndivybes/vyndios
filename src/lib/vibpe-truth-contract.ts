import type { Sql } from "@/lib/db";
import type { IntegratedPlanningResult } from "@/lib/integrated-business-planning-engine";

const n = (value: unknown) => Number(value ?? 0);
const money = (value: unknown) => `₹${n(value).toFixed(1)}L`;
const qty = (value: unknown) => n(value).toLocaleString("en-IN", { maximumFractionDigits: 1 });
const normalized = (value: string) => value.toLowerCase().replace(/\s+/g, " ").trim();

function actions(result: IntegratedPlanningResult, limit = 4) {
  return [...new Set(result.findings.map((finding) => finding.recommendedAction).filter(Boolean))].slice(0, limit);
}

function fundingOrLiquidityQuestion(question: string) {
  const q = normalized(question);
  return /\b(funding|fund|liquidity|free liquidity|cash runway|cash balance|bank balance|ledger cash|cash ledger)\b/.test(q);
}

function cashLedgerAuthorityQuestion(question: string) {
  const q = normalized(question);
  return /\b(cash|liquidity|bank)\b/.test(q) && /\b(ledger|canonical|bank balance|cash balance|same thing|truth)\b/.test(q);
}

function procurementPlanningQuestion(question: string) {
  const q = normalized(question);
  const procurement = /\b(procure|procurement|purchase|buy|replenish|po|purchase order)\b/.test(q);
  const planning = /\b(recommendation|recommended|planning|plan|automatically|automatic|create|commit|approve)\b/.test(q);
  return procurement && planning;
}

function productionTraceabilityAuthorityQuestion(question: string) {
  const q = normalized(question);
  const record = /\b(job card|job-card|traveller|traveler)\b/.test(q);
  const authority = /\b(complete|completed|completion|finished|releasable|release|released|quality|production complete)\b/.test(q);
  return record && authority;
}

function actualVsPlanQuestion(question: string) {
  const q = normalized(question);
  const actual = /\b(actual|actuals|transaction-derived|transaction derived|posted|reconciled)\b/.test(q);
  const plan = /\b(plan|planned|forecast|scenario|variance|reconcile|reconciliation)\b/.test(q);
  return actual && plan;
}

function planningFundingAnswer(result: IntegratedPlanningResult, question: string) {
  const trough = [...result.cash].sort(
    (a, b) => a.freeLiquidityAfterRecommendationsLakh - b.freeLiquidityAfterRecommendationsLakh,
  )[0];
  const firstBreach = result.funding.firstLiquidityBreachAfterRecommendationsPeriod;
  const next = actions(result);
  const asksLedger = cashLedgerAuthorityQuestion(question);
  const asksAutoCommit = /\b(automatic|automatically|commit|approve)\b/.test(normalized(question));

  return [
    `Governed planning funding assessment: minimum free liquidity after recommendations is ${money(result.summary.minimumFreeLiquidityAfterRecommendationsLakh)}${trough ? ` at M${trough.period}` : ""}.`,
    `Incremental funding need is ${money(result.funding.incrementalFundingNeedLakh)}; first post-recommendation liquidity breach is ${firstBreach ? `M${firstBreach}` : "not present in the modeled horizon"}.`,
    "Truth class: these are IBPE planning/scenario outputs. They are not the canonical current cash ledger, bank balance, or evidence that funding has been approved or received. Canonical cash remains transaction/ledger authority in Finance.",
    asksLedger
      ? "Answer to the ledger question: no — VIBPE must not substitute modeled free liquidity for current ledger cash or bank truth."
      : "Use the planning figures for management decisions only after reconciling current Finance ledger evidence.",
    asksAutoCommit
      ? "Authority: VIBPE cannot automatically commit or approve funding. A human must approve funding through the owning Finance/governance authority."
      : "Authority: advisory only; funding commitment remains a human approval in the owning Finance/governance authority.",
    next.length ? `Controlled next actions: ${next.join(" ")}` : "Controlled next action: reconcile the planning requirement to current Finance evidence and obtain the required human approval before any commitment.",
  ].join("\n\n");
}

function planningProcurementAnswer(result: IntegratedPlanningResult, question: string) {
  const purchases = [...result.supply]
    .filter((row) => row.recommendedPurchaseQty > 0)
    .sort((a, b) => (b.purchaseCostLakh ?? 0) - (a.purchaseCostLakh ?? 0) || b.recommendedPurchaseQty - a.recommendedPurchaseQty)
    .slice(0, 6);
  const asksAuto = /\b(automatic|automatically|create|commit|approve|issue)\b/.test(normalized(question));
  const next = actions(result);

  return [
    `Procurement assessment: governed planning recommendation is ${money(result.summary.totalRecommendedProcurementLakh)}.`,
    purchases.length
      ? `Priority planning recommendations: ${purchases.map((row) => `${row.sku} M${row.period}: buy ${qty(row.recommendedPurchaseQty)}${row.purchaseCostLakh != null ? ` (${money(row.purchaseCostLakh)})` : ""}${row.recommendationIsLate ? ", inside lead time" : ""}`).join("; ")}.`
      : "No planning purchase recommendation is active in the governed packet.",
    "Truth class: this is a governed IBPE planning recommendation, not an approved supplier commitment, issued purchase order, receipt, or inventory transaction.",
    asksAuto
      ? "Authority: VIBPE cannot automatically create, approve, issue or commit a PO. A human must act through the owning Procurement authority and supplier/finance controls."
      : "Authority: advisory only; PO creation/approval remains in the owning Procurement workspace with human authority.",
    next.length ? `Controlled next actions: ${next.join(" ")}` : "Controlled next action: validate exact committed shortages, supplier authority, price/lead-time evidence and funding before a human approves replenishment.",
  ].join("\n\n");
}

function productionTraceabilityAuthorityAnswer() {
  return [
    "Job-card / Traveller authority: a released job card or an existing Traveller is execution and traceability evidence; it is not proof that production is complete or releasable.",
    "Completion truth requires the applicable operation/material/evidence records to be complete. Quality/release truth remains governed by the owning Quality and Production Release controls, including unresolved NCR/CAPA or other release blockers.",
    "Authority: VIBPE is advisory only and cannot convert a job-card/Traveller state into production release. Human-authorised owning workspaces remain controlling.",
    "Controlled next action: review the Traveller genealogy, operation/material completion, quality evidence and formal release-readiness gate before treating the unit as complete or releasable.",
  ].join("\n\n");
}

type TransactionActualRow = {
  plan_month: string | number;
  revenue: string | number;
  units: string | number;
  receivables: string | number;
};

async function actualVsPlanAnswer(sql: Sql, result: IntegratedPlanningResult) {
  let rows: TransactionActualRow[] = [];
  try {
    rows = await sql.query<TransactionActualRow>(`
      select plan_month,revenue,units,receivables
        from vyndi_monthly_transaction_actuals
       order by plan_month desc
       limit 6
    `);
  } catch {
    rows = [];
  }

  const demandByPeriod = new Map(result.demand.map((row) => [Number(row.period), row]));
  const comparisons = rows.slice(0, 6).map((row) => {
    const period = n(row.plan_month);
    const demand = demandByPeriod.get(period);
    const unitPlan = demand?.planQty;
    const unitForecast = demand?.forecastQty;
    return `M${period}: transaction-derived actual units ${qty(row.units)}${unitPlan != null ? ` vs approved-plan units ${qty(unitPlan)} (variance ${qty(n(row.units) - n(unitPlan))})` : " (no matching approved-plan unit row in this packet)"}; transaction-derived revenue ${money(n(row.revenue) / 100000)}${unitForecast != null ? `; planning forecast units ${qty(unitForecast)}` : ""}.`;
  });

  const packetActuals = result.demand
    .filter((row) => n(row.actualQty) !== 0 || n(row.planQty) !== 0 || n(row.forecastQty) !== 0)
    .slice(0, 6)
    .map((row) => `${row.productId} M${row.period}: actual ${qty(row.actualQty)}, approved plan ${qty(row.planQty)}, forecast ${qty(row.forecastQty)}, variance-to-plan ${qty(row.varianceToPlanQty)}.`);

  return [
    "Actual-vs-plan truth classes: transaction-derived actuals are operational/finance truth; approved plan and forecast/scenario values are planning truth and must not overwrite actuals.",
    comparisons.length ? `Recent transaction actuals: ${comparisons.join(" ")}` : "Recent transaction-derived actual rows were unavailable to this read-only query; VIBPE must not invent them.",
    packetActuals.length ? `Governed planning packet comparison: ${packetActuals.join(" ")}` : "No comparable demand rows are present in the governed planning packet.",
    "Revenue note: transaction-derived revenue remains authoritative in the central Actuals/Finance ledger. A revenue plan/forecast should only be compared when the approved planning source supplies the corresponding period value; it must not be inferred from actuals.",
    "Controlled next action: review material variances and create an auditable plan revision only if management approves a changed outlook. Advisory only; actual posting and plan approval remain in their owning authorities.",
  ].join("\n\n");
}

export async function tryVibpeTruthContractAnswer(
  sql: Sql,
  question: string,
  governedBaseline: IntegratedPlanningResult,
) {
  if (productionTraceabilityAuthorityQuestion(question)) return productionTraceabilityAuthorityAnswer();
  if (actualVsPlanQuestion(question)) return actualVsPlanAnswer(sql, governedBaseline);
  if (fundingOrLiquidityQuestion(question)) return planningFundingAnswer(governedBaseline, question);
  if (procurementPlanningQuestion(question)) return planningProcurementAnswer(governedBaseline, question);
  return undefined;
}
