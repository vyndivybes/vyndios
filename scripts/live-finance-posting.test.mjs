import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const migration = read("migrations/0063_live_finance_posting.sql");
const authority = read("src/lib/finance/accounting-authority.ts");
const workbench = read("src/routes/command/accounting.tsx");
const access = read("src/lib/page-access.ts");
const financeControl = read("src/routes/command/finance-control.tsx");

test("live accounting migration covers canonical transaction chain", () => {
  for (const required of [
    "trg_vyndi_finance_supplier_invoice",
    "trg_vyndi_finance_supplier_payment",
    "trg_vyndi_finance_material_issue",
    "trg_vyndi_finance_job_complete",
    "trg_vyndi_finance_dispatch",
    "trg_vyndi_finance_customer_invoice",
    "trg_vyndi_finance_collection",
    "epr_finance_general_ledger",
    "epr_finance_trial_balance",
    "epr_finance_control_summary",
    "epr_finance_posting_exceptions",
  ]) {
    assert.match(migration, new RegExp(required));
  }
});

test("accounting workbench is finance-controlled and exposes reconciliation", () => {
  assert.match(authority, /permissionRoute = "\/command\/finance-control"/);
  assert.match(authority, /matchBankStatementLine/);
  assert.match(authority, /saveFixedAsset/);
  assert.match(authority, /savePayrollControl/);
  assert.match(access, /ACCOUNTING_ROUTE = "\/command\/accounting"/);
  assert.match(access, /domain: "finance"/);
  assert.match(access, /owner: "finance"/);
});

test("Finance Control links to the accounting workbench", () => {
  assert.match(financeControl, /to="\/command\/accounting"/);
  assert.match(workbench, /Accounting Workbench/);
  assert.match(workbench, /Trial Balance/);
  assert.match(workbench, /General Ledger/);
  assert.match(workbench, /Bank Reconciliation/);
  assert.match(workbench, /Fixed Asset Register/);
  assert.match(workbench, /Payroll \/ Statutory Control/);
});

test("finance postings retain reversal and source-reference controls", () => {
  assert.match(migration, /reverse_vyndi_finance_journal/);
  assert.match(migration, /source_type=p_source_type and source_id=p_source_id and status='posted'/);
  assert.match(migration, /Finished-goods valuation was not posted/);
  assert.match(migration, /COGS was not recognized/);
});
