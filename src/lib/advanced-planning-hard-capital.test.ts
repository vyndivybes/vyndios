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
  const rhsByPeriod = new Map(compiled.constraints.map((row) => [Number(row.id.split("__").at(-1)), row.rhs]));
  assert.equal(rhsByPeriod.get(2), 15);
  assert.equal(rhsByPeriod.get(3), 50);
  assert.equal(rhsByPeriod.get(6), 85);
  assert.equal(rhsByPeriod.get(10), 135);
  assert.equal(rhsByPeriod.get(14), 200);
  assert.ok(compiled.semantics.some((row) => row.includes("₹200L")));
});

test("supplier payment lag controls when an order begins consuming the hard capital envelope", () => {
  const compiled = compileGovernedHardCapitalConstraints(source, stagedEnvelope());
  const m2 = compiled.constraints.find((row) => row.id === "CAPITAL_CUMULATIVE__2");
  assert.ok(m2);
  assert.ok(m2.terms.some((term) => term.variableId === "PROC_LOTS__SUP_A_FRAME__1"));
  assert.ok(!m2.terms.some((term) => term.variableId === "PROC_LOTS__SUP_A_FRAME__2"));
  const m3 = compiled.constraints.find((row) => row.id === "CAPITAL_CUMULATIVE__3");
  assert.ok(m3?.terms.some((term) => term.variableId === "PROC_LOTS__SUP_A_FRAME__2"));
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

test("production-scale hard-capital indexing emits unique procurement terms without rescanning semantics", () => {
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
  const finalConstraint = compiled.constraints.find((row) => row.id === "CAPITAL_CUMULATIVE__36");
  assert.ok(finalConstraint);
  assert.equal(finalConstraint.terms.length, laneCount * 35);
  assert.equal(new Set(finalConstraint.terms.map((term) => term.variableId)).size, finalConstraint.terms.length);
});
