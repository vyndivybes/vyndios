import test from "node:test";
import assert from "node:assert/strict";
import { reconcileTallyTrialBalance } from "../src/lib/finance/tally-reconciliation.ts";

test("balanced matched accounts reconcile without differences", () => {
  const result = reconcileTallyTrialBalance(
    [{ code: "1000", name: "Bank", debitInr: 150, creditInr: 0 }, { code: "3000", name: "Capital", debitInr: 0, creditInr: 150 }],
    [{ code: "1000", name: "Bank", debitInr: 150, creditInr: 0 }, { code: "3000", name: "Capital", debitInr: 0, creditInr: 150 }]
  );
  assert.equal(result.status, "reconciled");
  assert.equal(result.differences.length, 0);
  assert.equal(result.vyndiBalanced, true);
  assert.equal(result.tallyBalanced, true);
});

test("a missing Tally ledger is an explicit blocker", () => {
  const result = reconcileTallyTrialBalance(
    [{ code: "1000", name: "Bank", debitInr: 200, creditInr: 0 }],
    []
  );
  assert.equal(result.status, "blocked");
  assert.equal(result.differences[0].reason, "missing_in_tally");
});

test("reverse-side amounts and unbalanced books cannot pass", () => {
  const result = reconcileTallyTrialBalance(
    [{ code: "1000", name: "Bank", debitInr: 100, creditInr: 0 }],
    [{ code: "1000", name: "Bank", debitInr: 0, creditInr: 100 }]
  );
  assert.equal(result.status, "blocked");
  assert.equal(result.differences[0].differenceInr, 200);
  assert.equal(result.vyndiBalanced, false);
  assert.equal(result.tallyBalanced, false);
});

test("reject duplicate account identifiers rather than silently aggregating", () => {
  assert.throws(() => reconcileTallyTrialBalance(
    [{ code: "1000", name: "Bank", debitInr: 1, creditInr: 0 }, { code: "1000", name: "Bank", debitInr: 1, creditInr: 0 }], []
  ), /duplicate/i);
});

test("reject non-finite and negative monetary values", () => {
  assert.throws(() => reconcileTallyTrialBalance([{ code: "A", name: "A", debitInr: NaN, creditInr: 0 }], []), /invalid/i);
  assert.throws(() => reconcileTallyTrialBalance([{ code: "A", name: "A", debitInr: -1, creditInr: 0 }], []), /invalid/i);
});

test("no fuzzy account matching and no false audit approval", () => {
  const result = reconcileTallyTrialBalance(
    [{ code: "1000", name: "Bank", debitInr: 0, creditInr: 0 }],
    [{ code: "B-1000", name: "Bank", debitInr: 0, creditInr: 0 }]
  );
  assert.equal(result.status, "blocked");
  assert.equal(result.differences.length, 2);
});
