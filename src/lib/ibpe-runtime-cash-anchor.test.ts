import assert from "node:assert/strict";
import test from "node:test";
import { runRuntimeIbpe, type RuntimeIbpeInput } from "./ibpe-runtime-parity.ts";

function baseInput(): RuntimeIbpeInput {
  return {
    demand: [],
    bom: [],
    inventory: [],
    reservations: [],
    receipts: [],
    capacity: [],
    cashFlows: [
      {
        id: "plan-sales-1",
        businessKey: "sales-M1",
        period: 1,
        direction: "inflow",
        amountLakh: 2,
        truth: "plan",
        category: "sales",
        sourceRef: "PLAN-R1",
      },
      {
        id: "plan-opex-1",
        businessKey: "opex-M1",
        period: 1,
        direction: "outflow",
        amountLakh: 1,
        truth: "plan",
        category: "opex",
        sourceRef: "PLAN-R1",
      },
      {
        id: "plan-sales-2",
        businessKey: "sales-M2",
        period: 2,
        direction: "inflow",
        amountLakh: 3,
        truth: "plan",
        category: "sales",
        sourceRef: "PLAN-R1",
      },
      {
        id: "plan-opex-2",
        businessKey: "opex-M2",
        period: 2,
        direction: "outflow",
        amountLakh: 1,
        truth: "plan",
        category: "opex",
        sourceRef: "PLAN-R1",
      },
    ],
    funding: {
      openingBankCashLakh: 5,
      minimumOperatingReserveLakh: 2,
      restrictedCashLakh: 0,
      fundraisingLeadMonths: 3,
    },
    runtimeControls: {
      paymentLagBySku: {},
    },
  };
}

test("verified cash anchor is the liquidity baseline and historical flows are not replayed", () => {
  const input = baseInput();
  input.runtimeControls = {
    ...input.runtimeControls,
    cashAnchorPeriod: 1,
    cashAnchorSourceRef: "transaction-ledger:M1; BANK-EVIDENCE-001",
  };

  const result = runRuntimeIbpe(input, { horizonMonths: 2 });

  assert.equal(result.cash[0].period, 1);
  assert.equal(result.cash[0].selectedInflowsLakh, 0);
  assert.equal(result.cash[0].selectedOutflowsLakh, 0);
  assert.equal(result.cash[0].closingCashLakh, 5);
  assert.equal(result.cash[1].closingCashLakh, 7);
  assert.equal(result.runtimeParity.cashAnchorApplied, true);
  assert.equal(result.runtimeParity.cashAnchorPeriod, 1);
  assert.equal(result.runtimeParity.cashAnalysisStartPeriod, 2);
  assert.equal(result.runtimeParity.cashAnchorSourceRef, "transaction-ledger:M1; BANK-EVIDENCE-001");
});

test("without a governed cash anchor the approved opening cash behavior is preserved", () => {
  const result = runRuntimeIbpe(baseInput(), { horizonMonths: 2 });

  assert.equal(result.cash[0].closingCashLakh, 6);
  assert.equal(result.cash[1].closingCashLakh, 8);
  assert.equal(result.runtimeParity.cashAnchorApplied, false);
  assert.equal(result.runtimeParity.cashAnchorPeriod, 0);
  assert.equal(result.runtimeParity.cashAnalysisStartPeriod, 1);
});

function leadTimeInput(sourceRef: string): RuntimeIbpeInput {
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

test("planning-default lead time stays analytical but is not surfaced as authoritative supplier evidence", () => {
  const result = runRuntimeIbpe(leadTimeInput("EPR-FIFO-ATP+WORKBOOK-V5"), { horizonMonths: 3 });
  const row = result.supply.find((item) => item.sku === "FRAME" && item.period === 1);

  assert.ok(row);
  assert.equal(row.orderByPeriod, 1, "planning assumption still drives analytical order timing");
  assert.equal(row.recommendationIsLate, false, "provisional assumption must not render as authoritative late supplier evidence");
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

test("non-default evidenced lead time keeps authoritative high-severity late finding", () => {
  const result = runRuntimeIbpe(leadTimeInput("EPR-FIFO-ATP+SUPPLIER-LANE-APPROVED"), { horizonMonths: 3 });
  const row = result.supply.find((item) => item.sku === "FRAME" && item.period === 1);

  assert.ok(row);
  assert.equal(row.recommendationIsLate, true);
  assert.equal(result.runtimeParity.provisionalLeadTimeAssumptionSkus, 0);
  const finding = result.findings.find((item) => item.title === "Purchase recommendation is inside supplier lead time");
  assert.ok(finding);
  assert.equal(finding.severity, "high");
});
