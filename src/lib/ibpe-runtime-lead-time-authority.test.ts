import assert from "node:assert/strict";
import test from "node:test";
import { runRuntimeIbpe, type RuntimeIbpeInput } from "./ibpe-runtime-parity.ts";

function input(sourceRef: string): RuntimeIbpeInput {
  return {
    demand: [{
      id: "M1-carbon",
      productId: "carbon",
      period: 1,
      planQty: 1,
      forecastQty: 1,
      committedQty: 0,
      actualQty: 0,
      confidence: 1,
      sourceRef: "PLAN-TEST",
    }],
    bom: [{
      id: "BOM-carbon-FRAME",
      productId: "carbon",
      revisionId: "R1",
      approved: true,
      sku: "FRAME",
      quantityPerUnit: 1,
      sourceRef: "BOM-R1",
    }],
    inventory: [{
      sku: "FRAME",
      onHandQty: 0,
      safetyStockQty: 0,
      mslQty: 0,
      unitCostLakh: 0.1,
      leadTimeMonths: 2,
      moq: 1,
      orderMultiple: 1,
      sourceRef,
    }],
    committedMaterialRequirements: [],
    reservations: [],
    receipts: [],
    capacity: [],
    cashFlows: [],
    funding: {
      openingBankCashLakh: 100,
      restrictedCashLakh: 0,
      minimumOperatingReserveLakh: 0,
      fundraisingLeadMonths: 3,
    },
  };
}

test("planning-default lead time remains analytical but is not an authoritative supplier breach", () => {
  const result = runRuntimeIbpe(input("EPR-FIFO-ATP+WORKBOOK-V5"), { horizonMonths: 3 });
  const row = result.supply.find((item) => item.sku === "FRAME" && item.period === 1);
  assert.ok(row);
  assert.equal(row.orderByPeriod, 1, "analytical lead time still drives modeled order timing");
  assert.equal(row.recommendationIsLate, false, "provisional lead time must not be surfaced as an authoritative late flag");
  assert.equal(result.runtimeParity.leadTimeAuthorityNormalized, true);
  assert.equal(result.runtimeParity.provisionalLeadTimeAssumptionSkus, 1);
  assert.equal(
    result.findings.some((finding) => finding.title === "Purchase recommendation is inside supplier lead time"),
    false,
  );
  const provisional = result.findings.find((finding) => finding.title === "Purchase timing depends on provisional lead-time assumption");
  assert.ok(provisional);
  assert.equal(provisional.severity, "medium");
  assert.match(provisional.problem, /supplier lead-time evidence is not yet authoritative/i);
});

test("evidenced/non-default lead time keeps the authoritative high-severity late finding", () => {
  const result = runRuntimeIbpe(input("EPR-FIFO-ATP+SUPPLIER-LANE-APPROVED"), { horizonMonths: 3 });
  const row = result.supply.find((item) => item.sku === "FRAME" && item.period === 1);
  assert.ok(row);
  assert.equal(row.recommendationIsLate, true);
  assert.equal(result.runtimeParity.provisionalLeadTimeAssumptionSkus, 0);
  const finding = result.findings.find((item) => item.title === "Purchase recommendation is inside supplier lead time");
  assert.ok(finding);
  assert.equal(finding.severity, "high");
});
