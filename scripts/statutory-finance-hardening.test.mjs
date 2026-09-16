import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const migration = read("migrations/0064_statutory_finance_hardening.sql");
const inputTaxMigration = read("migrations/0065_input_gst_itc_control.sql");
const shipmentAuthority = read("src/lib/shipment-authority.ts");
const receivables = read("src/routes/command/receivables.tsx");
const statutoryAuthority = read("src/lib/finance/statutory-authority.ts");
const inputTaxAuthority = read("src/lib/finance/input-tax-authority.ts");
const statutoryRoute = read("src/routes/command/accounting/statutory.tsx");
const inputTaxRoute = read("src/routes/command/accounting/input-tax.tsx");
const accountingAuthority = read("src/lib/finance/accounting-authority.ts");
const access = read("src/lib/page-access.ts");

test("customer invoice authority captures controlled GST particulars and gross receivable", () => {
  for (const required of [
    "recipient_gstin",
    "place_of_supply_code",
    "hsn_sac",
    "tax_rate_pct",
    "cgst_inr",
    "sgst_inr",
    "igst_inr",
    "gross_amount_inr",
    "e_invoice_required",
    "irn_ack_number",
    "tax_profile_status",
    "issue_vyndi_tax_invoice",
  ]) assert.match(migration, new RegExp(required));
  assert.match(shipmentAuthority, /issue_vyndi_tax_invoice/);
  assert.match(receivables, /GST treatment/);
  assert.match(receivables, /Open gross receivables/);
});

test("output GST posts from complete tax invoices and blocks incomplete invoice accounting", () => {
  assert.match(migration, /accountCode','2100'/);
  assert.match(migration, /GST-OUT-/);
  assert.match(migration, /tax_profile_status='complete'/);
  assert.match(migration, /AR\/revenue posting is blocked until reconciled/);
  assert.match(migration, /gross_amount_inr\/100000/);
});

test("input GST requires explicit ITC classification instead of document-presence inference", () => {
  assert.match(inputTaxMigration, /itc_control_status/);
  assert.match(inputTaxMigration, /Supplier invoice GST requires explicit ITC classification before approval/);
  assert.match(inputTaxMigration, /Verified eligible input GST \/ ITC/);
  assert.match(inputTaxMigration, /Inventory value including ineligible\/non-creditable GST/);
  assert.match(inputTaxMigration, /eligible_itc is null/);
  assert.match(inputTaxAuthority, /classifySupplierInvoiceItc/);
  assert.match(inputTaxAuthority, /Tax component total/);
  assert.match(inputTaxRoute, /Input GST \/ ITC Review/);
});

test("period hard close locks journals and preserves posted journal immutability", () => {
  assert.match(migration, /epr_finance_period_closures/);
  assert.match(migration, /trg_vyndi_finance_period_lock/);
  assert.match(migration, /trg_vyndi_protect_posted_journal/);
  assert.match(migration, /Posted finance journals are immutable/);
  assert.match(statutoryAuthority, /needsApproval = data\.status === "hard_closed"/);
  assert.match(statutoryAuthority, /periodBlockers/);
  assert.match(statutoryAuthority, /pendingSupplierItc/);
  assert.match(statutoryAuthority, /approvedBankReconciliations/);
});

test("bank reconciliation uses audited match, explicit unmatch and two-sided period close", () => {
  assert.match(migration, /epr_finance_bank_match_audit/);
  assert.match(migration, /epr_finance_bank_reconciliation_sessions/);
  assert.match(accountingAuthority, /unmatchBankStatementLine/);
  assert.match(accountingAuthority, /Journal .* is already matched/);
  assert.match(statutoryAuthority, /closeBankReconciliation/);
  assert.match(statutoryAuthority, /zero-activity bank period/);
  assert.match(statutoryAuthority, /posted Bank journal\(s\) are not represented by matched statement lines/);
  assert.match(statutoryAuthority, /Bank statement movement differs from Bank-GL movement/);
});

test("CA evidence packs are blocker-aware and approval controlled", () => {
  assert.match(migration, /epr_finance_ca_evidence_packs/);
  assert.match(inputTaxMigration, /epr_finance_ca_readiness/);
  assert.match(statutoryAuthority, /captureCaEvidencePack/);
  assert.match(statutoryAuthority, /approveCaEvidencePack/);
  assert.match(statutoryAuthority, /Only a blocker-free review-ready CA evidence pack can be approved/);
  assert.match(statutoryRoute, /Statutory Control Center/);
  assert.match(statutoryRoute, /CA Evidence Pack/);
});

test("accounting statutory child routes inherit finance accounting access", () => {
  assert.match(access, /route\.startsWith\(`\$\{ACCOUNTING_ROUTE\}\/`\)/);
  assert.match(receivables, /to="\/command\/accounting\/statutory"/);
  assert.match(inputTaxRoute, /to="\/command\/accounting\/statutory"/);
});
