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
