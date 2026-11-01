import assert from "node:assert/strict";
import test from "node:test";
import { computeReceivableAging } from "../src/lib/finance/receivables-aging.ts";

test("calculates unpaid amounts and aging as of a selected date", () => {
  const result = computeReceivableAging({
    asOfDate: "2026-10-16",
    invoices: [
      { id: "INV-1", partyId: "C1", issueDate: "2026-08-01", dueDate: "2026-09-01", amountInr: 1000 },
      { id: "INV-2", partyId: "C1", issueDate: "2026-10-10", dueDate: "2026-10-20", amountInr: 500 },
    ],
    receipts: [{ id: "REC-1", invoiceId: "INV-1", postedDate: "2026-10-01", amountInr: 350 }],
  });
  assert.equal(result.totalOutstandingInr, 1150);
  assert.equal(result.buckets.overdue31To60Inr, 650);
  assert.equal(result.buckets.notDueInr, 500);
});
test("ignores invoices and collections dated after the report date", () => {
  const result = computeReceivableAging({
    asOfDate: "2026-10-16",
    invoices: [
      { id: "EARLY", partyId: "C1", issueDate: "2026-10-01", dueDate: "2026-10-01", amountInr: 200 },
      { id: "FUTURE", partyId: "C1", issueDate: "2026-10-20", dueDate: "2026-11-01", amountInr: 500 },
    ],
    receipts: [{ id: "LATER", invoiceId: "EARLY", postedDate: "2026-10-20", amountInr: 100 }],
  });
  assert.equal(result.totalOutstandingInr, 200);
  assert.equal(result.lines.length, 1);
});
test("rejects overallocated, duplicate and orphan payments", () => {
  const invoices = [{ id: "A", partyId: "C1", issueDate: "2026-10-01", dueDate: "2026-10-01", amountInr: 100 }];
  const make = (receipts) => computeReceivableAging({ asOfDate: "2026-10-16", invoices, receipts });
  assert.throws(() => make([{ id: "R", invoiceId: "A", postedDate: "2026-10-10", amountInr: 101 }]), /exceeds/i);
  assert.throws(() => make([{ id: "R", invoiceId: "UNKNOWN", postedDate: "2026-10-10", amountInr: 10 }]), /unknown/i);
  assert.throws(() => make([{ id: "R", invoiceId: "A", postedDate: "2026-10-10", amountInr: 10 }, { id: "R", invoiceId: "A", postedDate: "2026-10-10", amountInr: 10 }]), /duplicate/i);
});
test("rejects invalid financial amount and future-dated receipt allocation before invoice", () => {
  assert.throws(() => computeReceivableAging({ asOfDate: "2026-10-16", invoices: [{ id: "A", partyId: "C", issueDate: "2026-10-01", dueDate: "2026-10-01", amountInr: NaN }], receipts: [] }), /amount/i);
  assert.throws(() => computeReceivableAging({ asOfDate: "2026-10-16", invoices: [{ id: "A", partyId: "C", issueDate: "2026-10-10", dueDate: "2026-10-15", amountInr: 100 }], receipts: [{ id: "R", invoiceId: "A", postedDate: "2026-10-01", amountInr: 20 }] }), /before invoice/i);
});
