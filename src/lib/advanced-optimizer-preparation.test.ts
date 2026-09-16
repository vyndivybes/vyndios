import assert from "node:assert/strict";
import test from "node:test";
import type { IntegratedPlanningResult } from "./integrated-business-planning-engine.ts";
import type { RuntimeIbpeInput } from "./ibpe-runtime-parity.ts";
import {
  prepareAdvancedOptimizerEnvelope,
  prepareFrozenAdvancedOptimizerEnvelope,
} from "./advanced-optimizer-preparation.ts";

const lineage = {
  sourceSnapshotId: "IBPE-EXACT-1",
  sourceSnapshotAt: "2026-09-12T08:00:00.000Z",
  sourceSha: "1234567890abcdef",
  sourceInputHash: "a".repeat(64),
  sourceEngineVersion: "VYNDI-IBPE-TEST",
  approvedPlanId: "PLAN-1",
  approvedPlanRevision: 1,
};

const fiveTrancheFunding = [
  { id: "plan-funding-1", businessKey: "funding-M1", period: 1, direction: "inflow" as const, amountLakh: 15, truth: "plan" as const, category: "funding", sourceRef: "PLAN-1-R1:T1" },
  { id: "plan-funding-3", businessKey: "funding-M3", period: 3, direction: "inflow" as const, amountLakh: 35, truth: "plan" as const, category: "funding", sourceRef: "PLAN-1-R1:T2" },
  { id: "plan-funding-6", businessKey: "funding-M6", period: 6, direction: "inflow" as const, amountLakh: 35, truth: "plan" as const, category: "funding", sourceRef: "PLAN-1-R1:T3" },
  { id: "plan-funding-10", businessKey: "funding-M10", period: 10, direction: "inflow" as const, amountLakh: 50, truth: "plan" as const, category: "funding", sourceRef: "PLAN-1-R1:T4" },
  { id: "plan-funding-14", businessKey: "funding-M14", period: 14, direction: "inflow" as const, amountLakh: 65, truth: "plan" as const, category: "funding", sourceRef: "PLAN-1-R1:T5" },
];

function input(): RuntimeIbpeInput {
  return {
    demand: [{
      id: "M1-carbon",
      productId: "carbon",
      period: 1,
      planQty: 2,
      forecastQty: 2,
      committedQty: 1,
      actualQty: 0,
      confidence: 1,
      sourceRef: "PLAN-1-R1",
    }],
    bom: [{
      id: "carbon:BOM-R1:FRAME",
      productId: "carbon",
      revisionId: "BOM-R1",
      approved: true,
      sku: "FRAME-CARBON-M",
      quantityPerUnit: 1,
      sourceRef: "BOM-R1",
    }],
    inventory: [{
      sku: "FRAME-CARBON-M",
      onHandQty: 10,
      reservedQty: 0,
      safetyStockQty: 1,
      sourceRef: "EPR-FIFO-ATP",
    }],
    receipts: [],
    reservations: [],
    committedMaterialRequirements: [],
    capacity: [],
    cashFlows: fiveTrancheFunding,
    funding: {
      openingBankCashLakh: 20,
      minimumOperatingReserveLakh: 2,
      restrictedCashLakh: 0,
      fundraisingLeadMonths: 3,
    },
    runtimeControls: {
      paymentLagBySku: { "FRAME-CARBON-M": 1 },
    },
  };
}

function anchoredInput(): RuntimeIbpeInput {
  return {
    ...input(),
    funding: {
      openingBankCashLakh: 5,
      minimumOperatingReserveLakh: 15,
      restrictedCashLakh: 0,
      fundraisingLeadMonths: 3,
    },
    runtimeControls: {
      paymentLagBySku: { "FRAME-CARBON-M": 1 },
      cashAnchorPeriod: 1,
      cashAnchorSourceRef: "transaction-ledger:M1; BANK-EVIDENCE-001",
    },
  };
}

function result(freeLiquidity = 10): IntegratedPlanningResult {
  return {
    cash: Array.from({ length: 36 }, (_, index) => ({
      period: index + 1,
      selectedInflowsLakh: 0,
      selectedOutflowsLakh: 0,
      incrementalProcurementLakh: 0,
      closingCashLakh: freeLiquidity + 2,
      freeLiquidityLakh: freeLiquidity,
      closingCashAfterRecommendationsLakh: freeLiquidity + 2,
      freeLiquidityAfterRecommendationsLakh: freeLiquidity,
    })),
  } as IntegratedPlanningResult;
}

const capacity = [{
  workCentreId: "WC-010",
  workCentreName: "Kitting",
  travellerOperation: "Kitting",
  sequence: 10,
  availableHoursPerPeriod: 160,
  efficiency: 0.85,
  standardHoursPerUnit: 0.35,
  sourceRef: "CAPACITY-APPROVED",
  planningStatus: "approved",
}];

const routing = [{
  id: "ROUTE-CARBON-R1:20",
  productId: "carbon",
  operationCode: "FINAL-KIT",
  sequence: 20,
  eligibleResourceIds: ["WC-010"],
  runHoursPerUnit: 0.4,
  setupHours: 0.1,
  yieldPct: 0.99,
  sourceRef: "ROUTING:CARBON:R1",
}];

const supplierLanes = [{
  id: "SUP-A:FRAME-CARBON-M",
  supplierId: "SUP-A",
  sku: "FRAME-CARBON-M",
  approved: true,
  leadTimePeriods: 1,
  moq: 1,
  orderMultiple: 1,
  landedUnitCostLakh: 0.25,
  reliability: 0.95,
  capacity: Array.from({ length: 36 }, (_, index) => ({ period: index + 1, maxQty: 100 })),
  sourceRef: "SUPPLIER-LANE:SUP-A:FRAME-CARBON-M:R1",
}];

function prepare(overrides: Partial<Parameters<typeof prepareAdvancedOptimizerEnvelope>[0]> = {}) {
  return prepareAdvancedOptimizerEnvelope({
    lineage,
    input: input(),
    result: result(),
    capacityStandards: capacity,
    governedRoutingOperations: routing,
    persistedRoutingRevisionIds: ["ROUTE-CARBON-R1"],
    supplierLanes,
    persistedSupplierLaneRevisionIds: ["SUP-A:FRAME-CARBON-M:R1"],
    packetId: "ADV-IBPE-EXACT-1",
    createdAt: "2026-09-12T08:01:00.000Z",
    ...overrides,
  });
}

test("complete exact governed evidence produces a solver-ready preparation envelope", () => {
  const prepared = prepare();
  assert.equal(prepared.readyForGovernedOptimization, true);
  assert.equal(prepared.version, "VYNDI-OPTIMIZER-PREPARATION-0.3");
  assert.equal(prepared.lineage.sourceSnapshotId, lineage.sourceSnapshotId);
  assert.equal(prepared.evidence.sourceInputHash, lineage.sourceInputHash);
  assert.equal(prepared.authority.capacityAuthority, "approved-frozen-evidence");
  assert.deepEqual(prepared.evidence.capacitySourceRefs, ["CAPACITY-APPROVED"]);
  assert.equal(prepared.authority.routingAuthority, "approved-persisted");
  assert.equal(prepared.authority.supplierLaneAuthority, "approved-persisted");
  assert.equal(prepared.model.supplierLanes.length, 1);
  assert.equal(prepared.cashGuardrails.length, 36);
  assert.equal(prepared.cashTiming.analysisStartPeriod, 1);
  assert.deepEqual(prepared.cashTiming.paymentLagBySku, { "FRAME-CARBON-M": 1 });
  assert.equal(prepared.evidence.approvedFundingPlanLakh, 200);
  assert.equal(prepared.evidence.forwardFundingPlanLakh, 200);
  assert.equal(prepared.evidence.fundingPlanRowCount, 5);
  assert.deepEqual(prepared.fundingPlan.map((row) => [row.period, row.amountLakh]), [[1, 15], [3, 35], [6, 35], [10, 50], [14, 65]]);
  assert.ok(prepared.cashGuardrails.every((row) => row.sourceRef.includes(lineage.sourceSnapshotId)));
});

test("canonical cash anchor advances optimizer cash analysis to the next governed period without re-adding historical T1", () => {
  const anchoredResult = result();
  anchoredResult.cash[0].freeLiquidityLakh = -10;
  const prepared = prepare({ input: anchoredInput(), result: anchoredResult });
  assert.equal(prepared.readyForGovernedOptimization, true);
  assert.equal(prepared.cashTiming.cashAnchorPeriod, 1);
  assert.equal(prepared.cashTiming.analysisStartPeriod, 2);
  assert.equal(prepared.cashGuardrails.length, 35);
  assert.equal(prepared.cashGuardrails[0]?.period, 2);
  assert.equal(prepared.evidence.cashAnchorSourceRef, "transaction-ledger:M1; BANK-EVIDENCE-001");
  assert.equal(prepared.evidence.paymentLagControlCount, 1);
  assert.equal(prepared.evidence.approvedFundingPlanLakh, 200);
  assert.equal(prepared.evidence.forwardFundingPlanLakh, 185);
  assert.ok(!prepared.issues.some((row) => row.code === "CASH_BASELINE_RESERVE_BREACH" && row.message.includes("period 1")));
});

test("standby funding appears only when the governed parent IBPE input contains it", () => {
  const withStandby = input();
  withStandby.cashFlows = [
    ...(withStandby.cashFlows ?? []),
    { id: "plan-funding-9", businessKey: "funding-M9", period: 9, direction: "inflow", amountLakh: 25, truth: "plan", category: "funding", sourceRef: "PLAN-1-R1:STBY" },
  ];
  const prepared = prepare({ input: withStandby });
  assert.equal(prepared.evidence.approvedFundingPlanLakh, 225);
  assert.equal(prepared.evidence.fundingPlanRowCount, 6);
  assert.ok(prepared.fundingPlan.some((row) => row.period === 9 && row.amountLakh === 25));
});

test("capacity-derived routing is never upgraded into governed optimizer readiness", () => {
  const prepared = prepare({
    governedRoutingOperations: undefined,
    persistedRoutingRevisionIds: undefined,
  });
  assert.equal(prepared.readyForGovernedOptimization, false);
  assert.ok(prepared.issues.some((row) => row.code === "ROUTING_AUTHORITY_NOT_PERSISTED"));
});

test("missing supplier-lane authority blocks governed optimizer readiness", () => {
  const prepared = prepare({
    supplierLanes: undefined,
    persistedSupplierLaneRevisionIds: undefined,
  });
  assert.equal(prepared.readyForGovernedOptimization, false);
  assert.ok(prepared.issues.some((row) => row.code === "SUPPLIER_LANE_AUTHORITY_NOT_PERSISTED"));
});

test("incomplete exact-run cash evidence blocks readiness instead of inventing liquidity", () => {
  const incomplete = {
    cash: result().cash.slice(0, 35),
  } as IntegratedPlanningResult;
  const prepared = prepare({ result: incomplete });
  assert.equal(prepared.readyForGovernedOptimization, false);
  assert.equal(prepared.cashGuardrails.length, 0);
  assert.ok(prepared.issues.some((row) => row.code === "CASH_MISSING_CASH_PERIOD"));
});

test("source lineage is carried atomically into both model packet and cash evidence", () => {
  const prepared = prepare();
  assert.equal(prepared.packetId, "ADV-IBPE-EXACT-1");
  assert.equal(prepared.evidence.sourceSnapshotId, prepared.lineage.sourceSnapshotId);
  assert.equal(prepared.evidence.sourceSha, prepared.lineage.sourceSha);
  assert.equal(prepared.evidence.cashSourceRef, `${lineage.sourceSnapshotId}:${lineage.sourceInputHash}:CASH`);
});

test("frozen model and authority can prepare optimization without re-reading mutable planning standards", () => {
  const original = prepare();
  const frozen = prepareFrozenAdvancedOptimizerEnvelope({
    lineage,
    input: input(),
    result: result(),
    model: original.model,
    authority: original.authority,
    packetId: original.packetId,
  });
  assert.equal(frozen.readyForGovernedOptimization, true);
  assert.strictEqual(frozen.model, original.model);
  assert.deepEqual(frozen.evidence.persistedRoutingRevisionIds, ["ROUTE-CARBON-R1"]);
  assert.deepEqual(frozen.evidence.persistedSupplierLaneRevisionIds, ["SUP-A:FRAME-CARBON-M:R1"]);
  assert.deepEqual(frozen.cashTiming.paymentLagBySku, { "FRAME-CARBON-M": 1 });
  assert.equal(frozen.evidence.approvedFundingPlanLakh, 200);
});

test("frozen capacity evidence must show approval at packet creation", () => {
  const original = prepare();
  const frozen = prepareFrozenAdvancedOptimizerEnvelope({
    lineage,
    input: input(),
    result: result(),
    model: original.model,
    authority: { ...original.authority, capacityAuthority: "not-approved" },
    packetId: original.packetId,
  });
  assert.equal(frozen.readyForGovernedOptimization, false);
  assert.ok(frozen.issues.some((row) => row.code === "CAPACITY_AUTHORITY_NOT_APPROVED"));
});
