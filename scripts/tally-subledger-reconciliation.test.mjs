import assert from "node:assert/strict";
import test from "node:test";
import { computeReceivableAging } from "../src/lib/finance/receivables-aging.ts";
import { computePayableAging } from "../src/lib/finance/payables-aging.ts";
import { reconcileSubledger } from "../src/lib/finance/subledger-reconciliation.ts";

const asOfDate = "2026-10-16";
const invoice = { id: "I", partyId: "P", issueDate: "2026-01-01", dueDate: "2026-10-16", amountInr: 0.3 };
const receipt = { id: "R", invoiceId: "I", postedDate: asOfDate, amountInr: 0.1 };
const aging = (overrides = {}) => computeReceivableAging({ asOfDate, invoices: [invoice], receipts: [receipt], ...overrides });
const journal = (id, lines, extra = {}) => ({ id, entryDate: asOfDate, sourceType: "test", sourceId: id, description: "Synthetic", status: "posted", lines, ...extra });

test("aging boundaries include due today and 1/30/31/60/61/90/91 days overdue", () => {
  const dates = ["2026-10-16", "2026-10-15", "2026-09-16", "2026-09-15", "2026-08-17", "2026-08-16", "2026-07-18", "2026-07-17"];
  const result = aging({ invoices: dates.map((dueDate, i) => ({ ...invoice, id: String(i), amountInr: 1, dueDate })), receipts: [] });
  assert.deepEqual(result.buckets, { notDueInr: 1, overdue1To30Inr: 2, overdue31To60Inr: 2, overdue61To90Inr: 2, overdueOver90Inr: 1 });
  assert.equal(result.totalOutstandingInr, 8);
});
test("exact paise partial and full settlements do not mutate source", () => {
  const input = { asOfDate, invoices: [invoice], receipts: [receipt, { ...receipt, id: "R2", amountInr: 0.2 }] };
  const before = structuredClone(input);
  assert.equal(aging().totalOutstandingInr, 0.2);
  assert.equal(computeReceivableAging(input).totalOutstandingInr, 0);
  assert.deepEqual(input, before);
});
test("invalid dates, IDs, duplicate invoices, unsafe and sub-paise amounts fail closed", () => {
  for (const dueDate of ["2026-02-30", "2026-13-01", "2025-12-31", "bad"]) assert.throws(() => aging({ invoices: [{ ...invoice, dueDate }] }), /date/i);
  for (const amountInr of [-1, Infinity, NaN, 0.001, Number.MAX_SAFE_INTEGER]) assert.throws(() => aging({ invoices: [{ ...invoice, amountInr }] }), /amount/i);
  assert.throws(() => aging({ invoices: [invoice, invoice] }), /duplicate/i);
  assert.throws(() => aging({ invoices: [{ ...invoice, partyId: " " }] }), /ID/i);
  assert.throws(() => aging({ receipts: [{ ...receipt, amountInr: 0 }] }), /amount/i);
  assert.throws(() => aging({ receipts: [{ ...receipt, postedDate: "2026-11-01", amountInr: 1 }] }), /exceeds/i);
});
test("payables use the same cutoff, allocation controls and exact paise", () => {
  const input = { asOfDate, invoices: [invoice], payments: [receipt] };
  assert.deepEqual(computePayableAging(input), aging());
  assert.throws(() => computePayableAging({ ...input, payments: [receipt, receipt] }), /duplicate/i);
  assert.throws(() => computePayableAging({ ...input, payments: [{ ...receipt, amountInr: 1 }] }), /exceeds/i);
});
for (const kind of ["receivable", "payable"]) {
  test(kind + " reconciles invoices, partial settlements and dated reversals to posted GL", () => {
    const account = kind === "receivable" ? "1100" : "2000";
    const invoiceLines = kind === "receivable" ? [{ accountCode: account, debitInr: 0.3 }, { accountCode: "4000", creditInr: 0.3 }] : [{ accountCode: "6200", debitInr: 0.3 }, { accountCode: account, creditInr: 0.3 }];
    const paymentLines = kind === "receivable" ? [{ accountCode: "1000", debitInr: 0.1 }, { accountCode: account, creditInr: 0.1 }] : [{ accountCode: account, debitInr: 0.1 }, { accountCode: "1000", creditInr: 0.1 }];
    const journals = [journal("I", invoiceLines), journal("R", paymentLines), journal("D", invoiceLines, { status: "draft" }), journal("F", invoiceLines, { entryDate: "2026-10-17" })];
    const result = reconcileSubledger({ asOfDate, kind, totalOutstandingInr: 0.2, journals });
    assert.equal(result.reconciled, true);
    assert.deepEqual(result.journalIds, ["I", "R"]);
    assert.equal(reconcileSubledger({ asOfDate, kind, totalOutstandingInr: 0.3, journals }).differenceInr, -0.1);
    const reversed = paymentLines.map(({ accountCode, debitInr, creditInr }) => ({ accountCode, debitInr: creditInr, creditInr: debitInr }));
    assert.equal(reconcileSubledger({ asOfDate, kind, totalOutstandingInr: 0.3, journals: [...journals, journal("REV", reversed)] }).reconciled, true);
    assert.throws(() => reconcileSubledger({ asOfDate, kind, totalOutstandingInr: 0.2, journals: [journals[0], journals[0]] }), /duplicate/i);
    assert.throws(() => reconcileSubledger({ asOfDate, kind, totalOutstandingInr: 0, journals: [journal("BAD", [{ accountCode: account, debitInr: 1 }])] }), /invalid/i);
  });
}
