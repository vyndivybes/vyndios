import type { AdvancedPlanningConstraintModel } from "./advanced-planning-constraints.ts";
import type { MathConstraint, MathTerm } from "./advanced-planning-math-model.ts";

export const GOVERNED_HARD_CAPITAL_VERSION = "VYNDI-HARD-CAPITAL-0.1" as const;

export type GovernedFundingPlanRow = {
  period: number;
  amountLakh: number;
  sourceRef: string;
  businessKey?: string;
};

export type GovernedHardCapitalGuardrail = {
  period: number;
  cumulativeHeadroomLakh: number;
  sourceRef: string;
};

export type GovernedHardCapitalEnvelope = {
  version: typeof GOVERNED_HARD_CAPITAL_VERSION;
  sourceRef: string;
  cashAnchorPeriod: number;
  analysisStartPeriod: number;
  paymentLagBySku: Record<string, number>;
  guardrails: GovernedHardCapitalGuardrail[];
  fundingPlan: GovernedFundingPlanRow[];
};

export type GovernedHardCapitalIssue = {
  severity: "error" | "warning";
  code: string;
  period?: number;
  message: string;
};

export type GovernedHardCapitalCompileResult = {
  valid: boolean;
  constraints: MathConstraint[];
  issues: GovernedHardCapitalIssue[];
  semantics: string[];
};

function clean(value: string) {
  return value.replace(/[^A-Za-z0-9_]+/g, "_").replace(/^_+|_+$/g, "") || "X";
}

function variableId(prefix: string, ...parts: Array<string | number>) {
  return [prefix, ...parts.map((part) => clean(String(part)))].join("__");
}

function constraintId(prefix: string, ...parts: Array<string | number>) {
  return [prefix, ...parts.map((part) => clean(String(part)))].join("__");
}

function addTerm(terms: MathTerm[], variableIdValue: string, coefficient: number) {
  if (!Number.isFinite(coefficient) || Math.abs(coefficient) <= 1e-12) return;
  const existing = terms.find((row) => row.variableId === variableIdValue);
  if (existing) existing.coefficient += coefficient;
  else terms.push({ variableId: variableIdValue, coefficient });
}

function nonNegativeInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.ceil(parsed)) : 0;
}

export function compileGovernedHardCapitalConstraints(
  source: AdvancedPlanningConstraintModel,
  envelope: GovernedHardCapitalEnvelope,
): GovernedHardCapitalCompileResult {
  const issues: GovernedHardCapitalIssue[] = [];
  const constraints: MathConstraint[] = [];
  const horizon = source.horizonPeriods;

  if (envelope.version !== GOVERNED_HARD_CAPITAL_VERSION) {
    issues.push({ severity: "error", code: "HARD_CAPITAL_VERSION", message: `Expected ${GOVERNED_HARD_CAPITAL_VERSION}.` });
  }
  if (!envelope.sourceRef.trim()) {
    issues.push({ severity: "error", code: "HARD_CAPITAL_SOURCE", message: "Hard capital constraints require governed IBPE cash evidence." });
  }
  if (!Number.isInteger(envelope.cashAnchorPeriod) || envelope.cashAnchorPeriod < 0 || envelope.cashAnchorPeriod > horizon) {
    issues.push({ severity: "error", code: "HARD_CAPITAL_ANCHOR", period: envelope.cashAnchorPeriod, message: "Canonical cash anchor period is outside the planning horizon." });
  }
  if (!Number.isInteger(envelope.analysisStartPeriod) || envelope.analysisStartPeriod < 1 || envelope.analysisStartPeriod > horizon) {
    issues.push({ severity: "error", code: "HARD_CAPITAL_START", period: envelope.analysisStartPeriod, message: "Hard capital analysis start is outside the planning horizon." });
  }

  const guardrailByPeriod = new Map<number, GovernedHardCapitalGuardrail>();
  for (const row of envelope.guardrails) {
    if (!Number.isInteger(row.period) || row.period < envelope.analysisStartPeriod || row.period > horizon) {
      issues.push({ severity: "error", code: "HARD_CAPITAL_GUARDRAIL_PERIOD", period: row.period, message: `Hard capital guardrail M${row.period} is outside the forward-analysis horizon.` });
      continue;
    }
    if (guardrailByPeriod.has(row.period)) {
      issues.push({ severity: "error", code: "HARD_CAPITAL_GUARDRAIL_DUPLICATE", period: row.period, message: `Hard capital guardrail M${row.period} is duplicated.` });
      continue;
    }
    if (!Number.isFinite(row.cumulativeHeadroomLakh)) {
      issues.push({ severity: "error", code: "HARD_CAPITAL_HEADROOM", period: row.period, message: `Hard capital headroom M${row.period} is not finite.` });
      continue;
    }
    if (!row.sourceRef.trim()) {
      issues.push({ severity: "error", code: "HARD_CAPITAL_GUARDRAIL_SOURCE", period: row.period, message: `Hard capital guardrail M${row.period} lacks governed source evidence.` });
      continue;
    }
    guardrailByPeriod.set(row.period, row);
  }

  if (Number.isInteger(envelope.analysisStartPeriod) && envelope.analysisStartPeriod >= 1 && envelope.analysisStartPeriod <= horizon) {
    for (let period = envelope.analysisStartPeriod; period <= horizon; period += 1) {
      if (!guardrailByPeriod.has(period)) {
        issues.push({ severity: "error", code: "HARD_CAPITAL_GUARDRAIL_MISSING", period, message: `Hard capital guardrail M${period} is missing.` });
      }
    }
  }

  for (const [sku, lag] of Object.entries(envelope.paymentLagBySku)) {
    if (!sku.trim() || !Number.isFinite(Number(lag)) || Number(lag) < 0) {
      issues.push({ severity: "error", code: "HARD_CAPITAL_PAYMENT_LAG", message: `Payment-lag authority for ${sku || "<empty SKU>"} is invalid.` });
    }
  }

  for (const row of envelope.fundingPlan) {
    if (!Number.isInteger(row.period) || row.period < 1 || row.period > horizon) {
      issues.push({ severity: "error", code: "HARD_CAPITAL_FUNDING_PERIOD", period: row.period, message: `Approved funding row M${row.period} is outside the planning horizon.` });
    }
    if (!Number.isFinite(row.amountLakh) || row.amountLakh < 0) {
      issues.push({ severity: "error", code: "HARD_CAPITAL_FUNDING_AMOUNT", period: row.period, message: `Approved funding row M${row.period} has an invalid amount.` });
    }
    if (!row.sourceRef.trim()) {
      issues.push({ severity: "error", code: "HARD_CAPITAL_FUNDING_SOURCE", period: row.period, message: `Approved funding row M${row.period} lacks source evidence.` });
    }
  }

  if (issues.some((row) => row.severity === "error")) {
    return { valid: false, constraints: [], issues, semantics: [] };
  }

  const approvedLanes = source.supplierLanes.filter((lane) => lane.approved);
  const fundingByPeriod = new Map<number, number>();
  for (const row of envelope.fundingPlan) {
    fundingByPeriod.set(row.period, (fundingByPeriod.get(row.period) ?? 0) + row.amountLakh);
  }

  for (let period = envelope.analysisStartPeriod; period <= horizon; period += 1) {
    const guardrail = guardrailByPeriod.get(period)!;
    const terms: MathTerm[] = [];

    for (const lane of approvedLanes) {
      const paymentLag = nonNegativeInteger(envelope.paymentLagBySku[lane.sku]);
      for (let orderPeriod = 1; orderPeriod <= horizon; orderPeriod += 1) {
        const receiptPeriod = orderPeriod + lane.leadTimePeriods;
        if (receiptPeriod > horizon) continue;
        const contractualPaymentPeriod = orderPeriod + paymentLag;
        const paymentPeriod = Math.max(envelope.analysisStartPeriod, contractualPaymentPeriod);
        if (paymentPeriod > period || paymentPeriod > horizon) continue;
        addTerm(
          terms,
          variableId("PROC_LOTS", lane.id, orderPeriod),
          lane.orderMultiple * lane.landedUnitCostLakh,
        );
      }
    }

    if (!terms.length) continue;
    const hardHeadroom = Math.max(0, guardrail.cumulativeHeadroomLakh);
    let approvedFundingThroughPeriod = 0;
    for (const [fundingPeriod, amount] of fundingByPeriod) {
      if (fundingPeriod <= period) approvedFundingThroughPeriod += amount;
    }
    constraints.push({
      id: constraintId("CAPITAL_CUMULATIVE", period),
      sense: "le",
      rhs: hardHeadroom,
      terms,
      semantic: `hard governed capital ceiling M${period}: cumulative optimizer procurement cash must stay within ₹${hardHeadroom}L reserve-preserving IBPE headroom; approved-plan funding scheduled through M${period}=₹${approvedFundingThroughPeriod}L`,
    });
  }

  if (!constraints.length && approvedLanes.length) {
    issues.push({
      severity: "warning",
      code: "HARD_CAPITAL_NO_PROCUREMENT_TERMS",
      message: "No payable optimizer procurement variables fall inside the governed cash-analysis horizon.",
    });
  }

  const totalApprovedFunding = envelope.fundingPlan.reduce((sum, row) => sum + row.amountLakh, 0);
  const forwardApprovedFunding = envelope.fundingPlan
    .filter((row) => row.period >= envelope.analysisStartPeriod)
    .reduce((sum, row) => sum + row.amountLakh, 0);

  return {
    valid: true,
    constraints,
    issues,
    semantics: [
      `Hard capital control is derived from governed IBPE free-liquidity headroom and therefore includes the approved staged funding plan, operating inflows/outflows and reserve policy before optimizer procurement is allowed.`,
      `Approved-plan funding evidence totals ₹${totalApprovedFunding}L across the 36-month input; ₹${forwardApprovedFunding}L falls in or after forward cash analysis starts at M${envelope.analysisStartPeriod}.`,
      `The canonical cash anchor at M${envelope.cashAnchorPeriod} supersedes plan cash history at or before the anchor; no historical tranche is re-added after the verified cash balance.`,
      "Procurement cash is hard-constrained in HiGHS at the governed supplier payment period; post-solve cash governance independently revalidates the same solution.",
    ],
  };
}
