import assert from "node:assert/strict";
import test from "node:test";
import { createVoucherJournal } from "../src/lib/finance/voucher-journals.ts";
import { validateJournal, CORE_CHART_OF_ACCOUNTS } from "../src/lib/finance/general-ledger.ts";

const base = { id: "V-1", entryDate: "2026-10-16", reference: "DOC-001", amountInr: 1250.50 };
const scenarios = [
  ["receipt", "1000", "1100"],
  ["payment", "2000", "1000"],
  ["contra", "1000", "1010"],
  ["sales", "1100", "4000"],
  ["purchase", "6200", "2000"],
];
for (const [kind, debit, credit] of scenarios) {
  test(kind + " voucher produces a balanced traceable draft", () => {
    const entry = createVoucherJournal({ ...base, kind, debitAccountCode: debit, creditAccountCode: credit });
    assert.equal(entry.status, "draft");
    assert.equal(entry.sourceType, "voucher_" + kind);
    assert.equal(entry.sourceId, "DOC-001");
    assert.equal(entry.lines[0].debitInr, 1250.5);
    assert.equal(entry.lines[1].creditInr, 1250.5);
    assert.equal(validateJournal(entry, [...CORE_CHART_OF_ACCOUNTS, { code: "1010", name: "Cash", type: "asset" }]).valid, true);
  });
}
test("positive payment cannot be posted with the same debit and credit account", () => {
  assert.throws(() => createVoucherJournal({ ...base, kind: "payment", debitAccountCode: "1000", creditAccountCode: "1000" }), /different/);
});
test("nonpositive, nonfinite or fractional-paise values fail closed", () => {
  for (const amountInr of [0, -1, NaN, Infinity, 1.001]) {
    assert.throws(() => createVoucherJournal({ ...base, kind: "receipt", debitAccountCode: "1000", creditAccountCode: "1100", amountInr }), /amount/);
  }
});
test("duplicate source reference is not encoded as an independent, untraceable journal", () => {
  assert.throws(() => createVoucherJournal({ ...base, kind: "receipt", debitAccountCode: "1000", creditAccountCode: "1100", reference: "" }), /reference/);
});
