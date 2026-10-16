import assert from "node:assert/strict";
import test from "node:test";
import { validateJournal, postJournal } from "../src/lib/finance/general-ledger.ts";

const draft = (debitInr, creditInr) => ({
  id: "SYNTHETIC-001",
  entryDate: "2026-10-16",
  sourceType: "test",
  sourceId: "SYNTHETIC",
  description: "Synthetic accounting validation fixture",
  status: "draft",
  lines: [
    { accountCode: "1000", debitInr },
    { accountCode: "3000", creditInr },
  ],
});

test("valid INR debit and credit in paise can be posted", () => {
  const journal = draft(100.01, 100.01);
  assert.equal(validateJournal(journal).valid, true);
  assert.equal(postJournal(journal).status, "posted");
});

test("negative debit or credit never silently clamps to zero", () => {
  for (const journal of [draft(-1, 1), draft(1, -1)]) {
    assert.equal(validateJournal(journal).valid, false);
    assert.throws(() => postJournal(journal), /invalid.*amount/);
  }
});

test("nonfinite amounts cannot pass posting", () => {
  for (const value of [NaN, Infinity, -Infinity]) {
    assert.equal(validateJournal(draft(value, 100)).valid, false);
    assert.throws(() => postJournal(draft(value, 100)));
  }
});

test("sub-paise values cannot pass posting", () => {
  const journal = draft(100.001, 100.001);
  assert.equal(validateJournal(journal).valid, false);
  assert.throws(() => postJournal(journal), /invalid.*amount/);
});

test("unbalanced entries never post", () => {
  const journal = draft(100, 99);
  assert.equal(validateJournal(journal).valid, false);
  assert.throws(() => postJournal(journal), /not balanced/);
});
