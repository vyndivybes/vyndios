import assert from "node:assert/strict";
import test from "node:test";
import { buildJobCost } from "./cost-accounting.ts";
import {
  buildTrialBalance,
  cashReceiptJournal,
  materialIssueJournal,
  postJournal,
  reverseJournal,
  salesInvoiceJournal,
  supplierInvoiceJournal,
  validateJournal,
} from "./general-ledger.ts";
import { evaluateStatutoryControls, reconcileBank, summarizeGstPeriod } from "./statutory-controls.ts";

test("job costing rolls governed actual costs into FG and WIP", () => {
  const result = buildJobCost({
    jobCardId: "JC-001",
    model: "Latitude",
    plannedQuantity: 10,
    completedQuantity: 6,
    material: [
      { sku: "CF-001", quantityIssued: 5, actualUnitCostInr: 1000, standardUnitCostInr: 900 },
      { sku: "RES-001", quantityIssued: 2, actualUnitCostInr: 500 },
    ],
    labour: [{ role: "lamination", hours: 10, hourlyRateInr: 200 }],
    outsourcing: [{ reference: "PAINT-001", amountInr: 1000 }],
    manufacturingConsumablesInr: 500,
    manufacturingDepreciationInr: 300,
    supportDepreciationInr: 200,
    otherOverhead: [{ category: "power", amountInr: 1000, allocationPct: 50 }],
    scrapCostInr: 250,
    reworkCostInr: 250,
  });

  assert.equal(result.materialActualInr, 6000);
  assert.equal(result.materialStandardInr, 5500);
  assert.equal(result.materialVarianceInr, 500);
  assert.equal(result.totalActualCostInr, 11000);
  assert.equal(result.unitActualCostInr, 1100);
  assert.equal(result.finishedGoodsValueInr, 6600);
  assert.equal(result.wipValueInr, 4400);
});

test("double-entry journals reject imbalance and produce a balanced trial balance", () => {
  const supplier = supplierInvoiceJournal({
    id: "J-PO-1",
    entryDate: "2026-09-16",
    supplierInvoiceId: "SI-1",
    inventoryOrExpenseAccountCode: "1200",
    taxableValueInr: 10000,
    inputGstInr: 1800,
  });
  assert.equal(validateJournal(supplier).valid, true);

  const issue = materialIssueJournal({ id: "J-ISS-1", entryDate: "2026-09-16", issueId: "ISS-1", amountInr: 4000 });
  const sale = salesInvoiceJournal({ id: "J-SALE-1", entryDate: "2026-09-16", invoiceId: "INV-1", taxableValueInr: 20000, outputGstInr: 3600 });
  const receipt = cashReceiptJournal({ id: "J-RCPT-1", entryDate: "2026-09-16", receiptId: "RCPT-1", amountInr: 23600 });
  const posted = [supplier, issue, sale, receipt].map((entry) => postJournal(entry, "2026-09-16T00:00:00.000Z"));
  const trial = buildTrialBalance(posted);
  const totalDebit = trial.reduce((sum, row) => sum + row.debitInr, 0);
  const totalCredit = trial.reduce((sum, row) => sum + row.creditInr, 0);
  assert.equal(totalDebit, totalCredit);

  const bad = { ...issue, id: "BAD", lines: [{ accountCode: "1210", debitInr: 100 }] };
  assert.equal(validateJournal(bad).valid, false);
});

test("posted journals are corrected by reversal rather than mutation", () => {
  const posted = postJournal(materialIssueJournal({ id: "J-1", entryDate: "2026-09-16", issueId: "ISS-1", amountInr: 2500 }));
  const reversal = reverseJournal(posted, "J-1-R", "2026-09-17");
  assert.equal(reversal.status, "draft");
  assert.equal(reversal.reversedEntryId, "J-1");
  assert.deepEqual(reversal.lines, [
    { accountCode: "1210", debitInr: 0, creditInr: 2500, memo: undefined },
    { accountCode: "1200", debitInr: 2500, creditInr: 0, memo: undefined },
  ]);
});

test("GST and bank controls surface missing statutory evidence", () => {
  const gst = summarizeGstPeriod([
    { id: "O1", period: "2026-09", direction: "output", taxableValueInr: 10000, gstInr: 1800, evidenceReference: "INV-1" },
    { id: "I1", period: "2026-09", direction: "input", taxableValueInr: 4000, gstInr: 720, eligibleItc: true },
  ], "2026-09");
  assert.equal(gst.netGstPayableInr, 1080);
  assert.equal(gst.missingEvidenceCount, 1);

  const bank = reconcileBank(
    [{ id: "B1", date: "2026-09-16", amountInr: 1000, reference: "UTR-1" }],
    [{ id: "S1", date: "2026-09-16", amountInr: 1000, reference: "UTR-1" }],
  );
  assert.equal(bank.unmatchedBookIds.length, 0);
  assert.equal(bank.unmatchedStatementIds.length, 0);

  const controls = evaluateStatutoryControls({ gst, bank, assets: [], payroll: [] });
  assert.equal(controls.find((control) => control.id === "GST")?.ready, false);
  assert.equal(controls.find((control) => control.id === "BANK")?.ready, true);
});
