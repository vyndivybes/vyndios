import test from "node:test";
import assert from "node:assert/strict";
import { buildFinancialStatements, type StatementLedgerLine } from "./financial-statements.ts";

function journal(
  journalId: string,
  entryDate: string,
  sourceType: string,
  rows: Array<[string, number, number]>,
): StatementLedgerLine[] {
  return rows.map(([accountCode, debitInr, creditInr]) => ({
    journalId,
    entryDate,
    sourceType,
    sourceId: journalId,
    accountCode,
    debitInr,
    creditInr,
  }));
}

test("financial statements derive accrual, cash and balance views from the same posted ledger", () => {
  const lines = [
    ...journal("J-AR", "2026-04-02", "sales_invoice", [
      ["1100", 120, 0],
      ["4000", 0, 100],
      ["2100", 0, 20],
    ]),
    ...journal("J-COGS", "2026-04-02", "dispatch_cogs", [
      ["5000", 60, 0],
      ["1220", 0, 60],
    ]),
    ...journal("J-COL", "2026-04-10", "customer_receipt", [
      ["1000", 120, 0],
      ["1100", 0, 120],
    ]),
    ...journal("J-AP", "2026-04-05", "supplier_invoice", [
      ["1200", 50, 0],
      ["2000", 0, 50],
    ]),
    ...journal("J-PAY", "2026-04-12", "supplier_payment", [
      ["2000", 50, 0],
      ["1000", 0, 50],
    ]),
    ...journal("J-OPEX", "2026-04-15", "people_office_accrual", [
      ["6200", 10, 0],
      ["2000", 0, 10],
    ]),
    ...journal("J-OPEX-PAY", "2026-04-20", "people_office_payment", [
      ["2000", 10, 0],
      ["1000", 0, 10],
    ]),
    ...journal("J-CAPITAL", "2026-04-01", "equity_funding_receipt", [
      ["1000", 100, 0],
      ["3000", 0, 100],
    ]),
    ...journal("J-CAPEX", "2026-04-22", "fixed_asset_purchase", [
      ["1500", 20, 0],
      ["1000", 0, 20],
    ]),
  ];

  const pack = buildFinancialStatements({
    lines,
    jobCosts: [],
    fromDate: "2026-04-01",
    toDate: "2026-04-30",
  });

  assert.equal(pack.trading.accrual.resultInr, 40);
  assert.equal(pack.profitLoss.accrual.resultInr, 30);
  assert.equal(pack.trading.cash.resultInr, 70);
  assert.equal(pack.profitLoss.cash.resultInr, 60);
  assert.equal(pack.cashFlow.netChangeInCashInr, 140);
  assert.equal(pack.cashFlow.closingCashInr, 140);
  assert.equal(pack.cashFlow.reconciliationDifferenceInr, 0);
  assert.equal(pack.balanceSheet.balanceDifferenceInr, 0);
  assert.equal(pack.basisReconciliation.closingReceivablesInr, 0);
  assert.equal(pack.basisReconciliation.closingPayablesInr, 0);
});

test("cost account rolls governed job snapshots into a formal cost sheet", () => {
  const pack = buildFinancialStatements({
    lines: [],
    fromDate: "2026-04-01",
    toDate: "2026-04-30",
    jobCosts: [{
      jobCardId: "JC-001",
      model: "Latitude",
      plannedQuantity: 10,
      completedQuantity: 8,
      materialActualInr: 1000,
      materialStandardInr: 950,
      materialVarianceInr: 50,
      directLabourInr: 200,
      outsourcingInr: 100,
      manufacturingConsumablesInr: 50,
      manufacturingDepreciationInr: 30,
      supportDepreciationInr: 20,
      overheadInr: 40,
      scrapInr: 10,
      reworkInr: 20,
      totalActualCostInr: 1470,
      finishedGoodsValueInr: 1176,
      wipValueInr: 294,
    }],
  });

  assert.equal(pack.costAccount.totalActualCostInr, 1470);
  assert.equal(pack.costAccount.reconciliationDifferenceInr, 0);
  assert.equal(pack.costAccount.weightedUnitCostInr, 147);
  assert.equal(pack.costAccount.finishedGoodsValueInr, 1176);
  assert.equal(pack.costAccount.wipValueInr, 294);
});
