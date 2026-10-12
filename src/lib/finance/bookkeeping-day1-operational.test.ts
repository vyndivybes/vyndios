import assert from "node:assert/strict";
import test from "node:test";
import { DAY1_TECHNICAL_QUERY, assessDay1TechnicalHealth } from "./bookkeeping-day1-operational.ts";

const good = {
  posted_missing_source: 0, posted_missing_lines: 0, posted_unbalanced: 0,
  posting_exceptions: 0, required_audit_tables: 12, active_audit_tables: 12,
  required_journal_guards: 3, active_journal_guards: 3,
};

test("Day 1 technical integrity is independent of bank reconciliation and first month stocktake", () => {
  const r=assessDay1TechnicalHealth(good);
  assert.equal(r.state,"TECHNICAL_CONTROLS_PASS");
  assert.equal(r.passed.length,5);
  assert.equal(r.failed.length,0);
});
test("each material books control fails closed", () => {
  for (const [key,value] of [
    ["posted_missing_source",1],["posted_missing_lines",1],["posted_unbalanced",1],
    ["posting_exceptions",1],["active_audit_tables",11],["active_journal_guards",2]
  ] as const) {
    const r=assessDay1TechnicalHealth({...good,[key]:value});
    assert.equal(r.state,"TECHNICAL_CONTROLS_FAIL",key);
    assert.ok(r.failed.length>0,key);
  }
});
test("missing, negative, fractional and corrupt DB evidence is never accepted", () => {
  for (const v of [null,undefined,"NaN",-1,2.5,""]) {
    assert.equal(assessDay1TechnicalHealth({...good,posted_unbalanced:v}).state,"TECHNICAL_CONTROLS_FAIL");
  }
  assert.equal(assessDay1TechnicalHealth(null).state,"TECHNICAL_CONTROLS_FAIL");
});
test("critical accounting audit triggers and posted journal guards must be checked on DB", () => {
  assert.match(DAY1_TECHNICAL_QUERY,/trg_vyndi_books_row_audit/);
  assert.match(DAY1_TECHNICAL_QUERY,/tgenabled in \('O','A'\)/);
  assert.match(DAY1_TECHNICAL_QUERY,/trg_vyndi_protect_posted_journal/);
  assert.match(DAY1_TECHNICAL_QUERY,/trg_vyndi_finance_period_lock/);
  assert.match(DAY1_TECHNICAL_QUERY,/epr_finance_journal_lines/);
});
