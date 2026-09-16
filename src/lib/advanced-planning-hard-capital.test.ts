import assert from "node:assert/strict";
import test from "node:test";
import type { AdvancedPlanningConstraintModel } from "./advanced-planning-constraints.ts";
import {
  GOVERNED_HARD_CAPITAL_VERSION,
  compileGovernedHardCapitalConstraints,
  type GovernedHardCapitalEnvelope,
} from "./advanced-planning-hard-capital.ts";

const source = {
  horizonPeriods: 14,
  supplierLanes: [{
    id: "SUP-A:FRAME",
    supplierId: "SUP-A",
    sku: "FRAME",
    approved: true,
    leadTimePeriods: 1,
    moq: 1,
    orderMultiple: 1,
    landedUnitCostLakh: 1,
    reliability: 1,
  }],
} as AdvancedPlanningConstraintModel;

function stagedEnvelope(): GovernedHardCapitalEnvelope {
  const cumulativeFunding = (period: number) => {
    if (period >= 14) return 200;
    if (period >= 10) return 135;
    if (period >= 6) return 85;
    if (period >= 3) return 50;
    return 15;
  };
  return {
    version: GOVERNED_HARD_CAPITAL_VERSION,
    sourceRef: "IBPE-7:HASH:CASH",
    cashAnchorPeriod: 1,
    analysisStartPeriod: 2,
    paymentLagBySku: { FRAME: 1 },
    guardrails: Array.from({ length: 13 }, (_, index) => {
      const period = index + 2;
      return {
        period,
        cumulativeHeadroomLakh: cumulativeFunding(period),
        sourceRef: "IBPE-7:HASH:CASH",
      };
    }),
    fundingPlan: [
      { period: 1, amountLakh: 15, sourceRef: "PLAN-R7:T1", businessKey: "funding-M1" },
      { period: 3, amountLakh: 35, sourceRef: "PLAN-R7:T2", businessKey: "funding-M3" },
      { period: 6, amountLakh: 35, sourceRef: "PLAN-R7:T3", businessKey: "funding-M6" },
      { period: 10, amountLakh: 50, sourceRef: "PLAN-R7:T4", businessKey: "funding-M10" },
      { period: 14, amountLakh: 65, sourceRef: "PLAN-R7:T5", businessKey: "funding-M14" },
    ],
  };
}

test("five-tranche ₹2 Cr plan becomes period-by-period hard procurement capital ceilings", () => {
  const compiled = compileGovernedHardCapitalConstraints(source, stagedEnvelope());
  assert.equal(compiled.valid, true);
  const ceilings = compiled.constraints.filter((row) => row.id.startsWith("CAPITAL_CUMULATIVE__"));
  const rhsByPeriod = new Map(ceilings.map((row) => [Number(row.id.split("__").at(-1)), row.rhs]));
  assert.equal(rhsByPeriod.get(2), 15);
  assert.equal(rhsByPeriod.get(3), 50);
  assert.equal(rhsByPeriod.get(6), 85);
  assert.equal(rhsByPeriod.get(10), 135);
  assert.equal(rhsByPeriod.get(14), 200);
  assert.equal(compiled.variables.length, 13);
  assert.ok(compiled.semantics.some((row) => row.includes("₹200L")));
});

test("supplier payment lag controls when an order enters the sparse cumulative capital state", () => {
  const compiled = compileGovernedHardCapitalConstraints(source, stagedEnvelope());
  const m2 = compiled.constraints.find((row) => row.id === "CAPITAL_FLOW__2");
  assert.ok(m2);
  assert.ok(m2.terms.some((term) => term.variableId === "PROC_LOTS__SUP_A_FRAME__1"));
  assert.ok(!m2.terms.some((term) => term.variableId === "PROC_LOTS__SUP_A_FRAME__2"));
  const m3 = compiled.constraints.find((row) => row.id === "CAPITAL_FLOW__3");
  assert.ok(m3?.terms.some((term) => term.variableId === "PROC_LOTS__SUP_A_FRAME__2"));
  assert.ok(m3?.terms.some((term) => term.variableId === "CAPITAL_SPEND__2" && term.coefficient === -1));
});

test("a pre-existing reserve deficit never creates impossible negative procurement capacity", () => {
  const envelope = stagedEnvelope();
  envelope.guardrails[0] = { ...envelope.guardrails[0], cumulativeHeadroomLakh: -12.8 };
  const compiled = compileGovernedHardCapitalConstraints(source, envelope);
  assert.equal(compiled.valid, true);
  const m2 = compiled.constraints.find((row) => row.id === "CAPITAL_CUMULATIVE__2");
  assert.equal(m2?.rhs, 0);
});

test("optional standby capital is only available when it exists in governed cash headroom", () => {
  const envelope = stagedEnvelope();
  envelope.fundingPlan.push({ period: 9, amountLakh: 25, sourceRef: "PLAN-R7:STBY", businessKey: "funding-M9" });
  envelope.guardrails = envelope.guardrails.map((row) => row.period >= 9
    ? { ...row, cumulativeHeadroomLakh: row.cumulativeHeadroomLakh + 25 }
    : row);
  const compiled = compileGovernedHardCapitalConstraints(source, envelope);
  assert.equal(compiled.valid, true);
  assert.equal(compiled.constraints.find((row) => row.id === "CAPITAL_CUMULATIVE__9")?.rhs, 110);
  assert.ok(compiled.semantics.some((row) => row.includes("₹225L")));
});

test("production-scale hard-capital formulation keeps procurement coefficients linear in lane-period count", () => {
  const laneCount = 80;
  const largeSource = {
    horizonPeriods: 36,
    supplierLanes: Array.from({ length: laneCount }, (_, index) => ({
      id: `SUP-${index}:SKU-${index}`,
      supplierId: `SUP-${index}`,
      sku: `SKU-${index}`,
      approved: true,
      leadTimePeriods: 1,
      moq: 1,
      orderMultiple: 1,
      landedUnitCostLakh: 0.01,
      reliability: 1,
    })),
  } as AdvancedPlanningConstraintModel;
  const envelope: GovernedHardCapitalEnvelope = {
    version: GOVERNED_HARD_CAPITAL_VERSION,
    sourceRef: "IBPE-PROD:HASH:CASH",
    cashAnchorPeriod: 1,
    analysisStartPeriod: 2,
    paymentLagBySku: Object.fromEntries(Array.from({ length: laneCount }, (_, index) => [`SKU-${index}`, 1])),
    guardrails: Array.from({ length: 35 }, (_, index) => ({
      period: index + 2,
      cumulativeHeadroomLakh: 1_000,
      sourceRef: "IBPE-PROD:HASH:CASH",
    })),
    fundingPlan: [
      { period: 1, amountLakh: 15, sourceRef: "PLAN:T1" },
      { period: 3, amountLakh: 35, sourceRef: "PLAN:T2" },
      { period: 6, amountLakh: 35, sourceRef: "PLAN:T3" },
      { period: 10, amountLakh: 50, sourceRef: "PLAN:T4" },
      { period: 14, amountLakh: 65, sourceRef: "PLAN:T5" },
    ],
  };

  const compiled = compileGovernedHardCapitalConstraints(largeSource, envelope);
  assert.equal(compiled.valid, true);
  assert.equal(compiled.variables.length, 35);
  const flowConstraints = compiled.constraints.filter((row) => row.id.startsWith("CAPITAL_FLOW__"));
  const ceilingConstraints = compiled.constraints.filter((row) => row.id.startsWith("CAPITAL_CUMULATIVE__"));
  assert.equal(flowConstraints.length, 35);
  assert.equal(ceilingConstraints.length, 35);
  assert.ok(ceilingConstraints.every((row) => row.terms.length === 1));
  const procurementTermCount = flowConstraints.reduce(
    (sum, row) => sum + row.terms.filter((term) => term.variableId.startsWith("PROC_LOTS__")).length,
    0,
  );
  assert.equal(procurementTermCount, laneCount * 35);
});
