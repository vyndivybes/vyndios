import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const migration = read("migrations/0063_live_finance_posting.sql");
const cashReceiptMigration = read("migrations/0066_cash_funding_receipts.sql");
const peopleOfficeActualMigration = read("migrations/0079_people_office_actual_spend.sql");
const salesCreditMigration = read("migrations/0080_sales_credit_to_cash.sql");
const authority = read("src/lib/finance/accounting-authority.ts");
const cashFundingAuthority = read("src/lib/cash-funding-authority.ts");
const peopleOfficeActualAuthority = read("src/lib/finance/people-office-actual-spend-authority.ts");
const shipmentAuthority = read("src/lib/shipment-authority.ts");
const cashRoute = read("src/routes/command/cash.tsx");
const peopleOfficeActualRoute = read("src/routes/command/accounting/people-office-payments.tsx");
const receivablesRoute = read("src/routes/command/receivables.tsx");
const rootRoute = read("src/routes/__root.tsx");
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

test("cash funding receipts are append-only, evidenced and rolled into canonical closing cash", () => {
  assert.match(cashReceiptMigration, /create table if not exists vyndi_cash_funding_receipts/);
  assert.match(cashReceiptMigration, /unique \(evidence_reference\)/);
  assert.match(cashReceiptMigration, /post_vyndi_cash_funding_receipt/);
  assert.match(cashReceiptMigration, /v_new_cash := v_actual\.closing_cash \+ p_amount_lakh/);
  assert.match(cashReceiptMigration, /save_vyndi_monthly_actual/);
  assert.match(cashReceiptMigration, /accounting_classification.*pending/s);
  assert.match(cashFundingAuthority, /requireBusinessActor\("approve"\)/);
  assert.match(cashFundingAuthority, /evidenceReference: z\.string\(\)\.trim\(\)\.min\(3\)/);
  assert.match(cashRoute, /Funding Receipt Register/);
  assert.match(cashRoute, /Existing verified cash remains the historical canonical balance/);
  assert.match(cashRoute, /does not manufacture synthetic ₹5L\/₹10L receipt rows/);
});

test("People and Office actual spend keeps planning approval separate from accounting approval", () => {
  assert.match(peopleOfficeActualMigration, /vyndi_people_office_actual_expenditures/);
  assert.match(peopleOfficeActualMigration, /lifecycle_status in \('draft','pending_approval','approved','part_paid','paid'\)/);
  assert.match(peopleOfficeActualMigration, /approve_vyndi_people_office_actual_expenditure/);
  assert.match(peopleOfficeActualMigration, /people_office_obligation/);
  assert.match(peopleOfficeActualMigration, /debit_account_code/);
  assert.match(peopleOfficeActualMigration, /liability_account_code/);
  assert.match(peopleOfficeActualMigration, /'1500'/);
  assert.match(peopleOfficeActualMigration, /epr_finance_fixed_assets/);
  assert.match(peopleOfficeActualRoute, /Create actual draft/);
  assert.match(peopleOfficeActualRoute, /Approve & accrue/);
  assert.match(peopleOfficeActualRoute, /No cash moved/);
});

test("People and Office payment requires unique evidence and posts Bank plus verified canonical cash", () => {
  assert.match(peopleOfficeActualMigration, /vyndi_people_office_actual_payments/);
  assert.match(peopleOfficeActualMigration, /evidence_reference text not null unique/);
  assert.match(peopleOfficeActualMigration, /post_vyndi_people_office_actual_payment/);
  assert.match(peopleOfficeActualMigration, /'people_office_payment'/);
  assert.match(peopleOfficeActualMigration, /'accountCode','1000','creditInr'/);
  assert.match(peopleOfficeActualMigration, /apply_vyndi_verified_cash_movement/);
  assert.match(peopleOfficeActualMigration, /p_plan_month not between 1 and 36/);
  assert.match(peopleOfficeActualMigration, /no verified closing-cash baseline/i);
  assert.match(peopleOfficeActualMigration, /save_vyndi_monthly_actual/);
  assert.match(peopleOfficeActualAuthority, /requireActor\("approve"\)/);
  assert.match(peopleOfficeActualAuthority, /evidenceReference: reference/);
  assert.match(peopleOfficeActualRoute, /Bank \/ UTR evidence/);
  assert.match(peopleOfficeActualRoute, /does not infer a plan month from the payment date/);
});

test("sales invoices carry evidenced credit terms without inventing legacy history", () => {
  assert.match(salesCreditMigration, /credit_profile_status text not null default 'legacy_unclassified'/);
  assert.match(salesCreditMigration, /issue_vyndi_credit_tax_invoice/);
  assert.match(salesCreditMigration, /Credit terms evidence\/reference is required/);
  assert.match(salesCreditMigration, /v_due:=current_date\+p_credit_terms_days/);
  assert.match(salesCreditMigration, /credit_profile_status='controlled'/);
  assert.match(salesCreditMigration, /LEGACY_NO_TERMS/);
  assert.match(shipmentAuthority, /creditTermsDays:z\.number\(\)\.int\(\)\.min\(0\)\.max\(365\)/);
  assert.match(shipmentAuthority, /creditTermsReference:sourceReference/);
  assert.match(receivablesRoute, /Credit terms · days/);
  assert.match(receivablesRoute, /Legacy · terms not inferred/);
});

test("gross customer receivable includes GST while revenue remains taxable value", () => {
  assert.match(salesCreditMigration, /sum\(amount_lakh\).*revenue/s);
  assert.match(salesCreditMigration, /gross_amount_inr>0 then i\.gross_amount_inr\/100000\.0 else i\.amount_lakh/);
  assert.match(salesCreditMigration, /gross trade receivables/);
  assert.match(receivablesRoute, /Gross AR/);
});

test("customer collection posts explicit cash month into verified canonical cash and reverses symmetrically", () => {
  assert.match(salesCreditMigration, /Collection cash plan month must be between 1 and 36/);
  assert.match(salesCreditMigration, /Collection bank evidence\/reference has already been used/);
  assert.match(salesCreditMigration, /'customer-collection:'\|\|p_id/);
  assert.match(salesCreditMigration, /apply_vyndi_verified_cash_movement/);
  assert.match(salesCreditMigration, /cash_actual_revision=v_revision/);
  assert.match(salesCreditMigration, /'customer-collection-reversal:'\|\|p_id/);
  assert.match(salesCreditMigration, /-v_row\.amount_lakh/);
  assert.match(salesCreditMigration, /cash_reversal_revision=v_cash_revision/);
  assert.match(salesCreditMigration, /v_actual\.cogs/);
  assert.match(salesCreditMigration, /\n {4}null,\n {4}v_actual\.payables/);
  assert.match(receivablesRoute, /Collection cash month · actual receipt month/);
  assert.match(receivablesRoute, /Dr 1000 Bank \/ Cr 1100 Trade Receivable/);
  assert.match(receivablesRoute, /Canonical cash/);
});

test("route loading feedback keeps the top bar and adds a Vayu cursor halo", () => {
  assert.match(rootRoute, /data-page-loading-status="route-transition"/);
  assert.match(rootRoute, /function CursorLoadingHalo/);
  assert.match(rootRoute, /data-page-loading-cursor-halo="vayu"/);
  assert.match(rootRoute, /VAYU_LOGO_PATH/);
  assert.match(rootRoute, /motion-safe:animate-spin/);
  assert.match(rootRoute, /pointermove/);
});