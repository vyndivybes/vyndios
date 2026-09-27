import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const migration = read("migrations/0063_live_finance_posting.sql");
const cashReceiptMigration = read("migrations/0066_cash_funding_receipts.sql");
const peopleOfficeActualMigration = read("migrations/0079_people_office_actual_spend.sql");
const salesCreditMigration = read("migrations/0080_sales_credit_to_cash.sql");
const salesLedgerMigration = read("migrations/0081_sales_ledger_spare_components.sql");
const spareIdentityMigration = read("migrations/0082_spare_sales_identity_fifo_fix.sql");
const accountingSourceAuthorityMigration = read("migrations/0084_accounting_source_authority.sql");
const actualCogsMigration = read("migrations/0086_actual_job_cost_cogs_chain.sql");
const toolingRecoveryMigration = read("migrations/0087_tooling_cost_recovery_authority.sql");
const founderPaidMigration = read("migrations/0094_founder_paid_expense_authority.sql");
const authority = read("src/lib/finance/accounting-authority.ts");
const cashFundingAuthority = read("src/lib/cash-funding-authority.ts");
const peopleOfficeActualAuthority = read("src/lib/finance/people-office-actual-spend-authority.ts");
const generalLedger = read("src/lib/finance/general-ledger.ts");
const financialStatements = read("src/lib/finance/financial-statements.ts");
const shipmentAuthority = read("src/lib/shipment-authority.ts");
const salesLedgerAuthority = read("src/lib/sales-ledger-authority.ts");
const cashRoute = read("src/routes/command/cash.tsx");
const peopleOfficeActualRoute = read("src/routes/command/accounting/people-office-payments.tsx");
const receivablesRoute = read("src/routes/command/receivables.tsx");
const salesLedgerRoute = read("src/routes/command/sales-ledger.tsx");
const workflow = read("src/lib/operating-workflow.ts");
const rootRoute = read("src/routes/__root.tsx");
const workbench = read("src/routes/command/accounting.tsx");
const access = read("src/lib/page-access.ts");
const financeControl = read("src/routes/command/finance-control.tsx");
const accountingRoute = read("src/routes/command/accounting.tsx");
const peopleOfficeAuthority = read("src/lib/people-office-authority.ts");
const peopleOfficeRoute = read("src/routes/command/people-office.tsx");

test("manufacturing finance migrations use valid PL/pgSQL dollar quoting", () => {
  for (const [name, sql] of [
    ["0086 actual job COGS", actualCogsMigration],
    ["0087 tooling recovery", toolingRecoveryMigration],
  ]) {
    assert.doesNotMatch(sql, /\bas \$\r?\n/, `${name} contains a single-dollar PL/pgSQL opening delimiter`);
    assert.doesNotMatch(sql, /^\$;\s*$/m, `${name} contains a single-dollar PL/pgSQL closing delimiter`);
  }
});

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
  assert.doesNotMatch(authority, /export const saveFixedAsset/);
  assert.match(authority, /savePayrollControl/);
  assert.match(authority, /save_vyndi_linked_payroll_control/);
  assert.match(access, /ACCOUNTING_ROUTE = "\/command\/accounting"/);
  assert.match(access, /domain: "finance"/);
  assert.match(access, /owner: "finance"/);
});

test("asset and payroll controls cannot create parallel accounting truth", () => {
  assert.match(accountingSourceAuthorityMigration, /manual asset creation is disabled/);
  assert.match(accountingSourceAuthorityMigration, /source_expenditure_id/);
  assert.match(accountingSourceAuthorityMigration, /source_category='payroll'/);
  assert.match(accountingSourceAuthorityMigration, /Payroll employer cost must equal governed payroll obligation amount/);
  assert.match(accountingSourceAuthorityMigration, /Payroll payment evidence must match a governed People & Office payment/);
  assert.match(accountingSourceAuthorityMigration, /save_vyndi_linked_payroll_control/);
  assert.doesNotMatch(workbench, /Save asset/);
  assert.match(workbench, /read-only for financial source truth/);
  assert.match(workbench, /Governed payroll expenditure ID/);
  assert.match(workbench, /does not post cash/);
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

test("founder-paid People and Office spend creates a director payable without moving company cash", () => {
  assert.match(founderPaidMigration, /funding_source/);
  assert.match(founderPaidMigration, /founder_personal/);
  assert.match(founderPaidMigration, /'2400'/);
  assert.match(founderPaidMigration, /'6250'/);
  assert.match(founderPaidMigration, /SOLE_OPERATOR_SELF_APPROVAL/);
  assert.match(founderPaidMigration, /create_vyndi_people_office_actual_expenditure_v2/);
  assert.match(founderPaidMigration, /approve_vyndi_people_office_actual_expenditure_v2/);
  assert.doesNotMatch(founderPaidMigration, /founder_personal[\s\S]{0,1200}apply_vyndi_verified_cash_movement/);
  assert.match(founderPaidMigration, /post_vyndi_founder_reimbursement/);
  assert.match(founderPaidMigration, /'accountCode','2400','debitInr'/);
  assert.match(founderPaidMigration, /'accountCode','1000','creditInr'/);
  assert.match(peopleOfficeActualAuthority, /FOUNDER_PERSONAL/);
  assert.match(peopleOfficeActualAuthority, /soleOperatorSelfApproval/);
  assert.match(peopleOfficeActualAuthority, /postFounderReimbursement/);
  assert.match(peopleOfficeActualRoute, /Founder \/ Director personal funds/);
  assert.match(peopleOfficeActualRoute, /Sole-operator self-approval/);
  assert.match(generalLedger, /code: "2400", name: "Founder \/ Director Current Account"/);
  assert.match(generalLedger, /code: "6250", name: "Travel \/ Business Development Expense"/);
  assert.match(financialStatements, /CURRENT_LIABILITY_CODES = \["2000", "2100", "2200", "2400"\]/);
  assert.match(financialStatements, /OPERATING_EXPENSE_CODES = \["5100", "5200", "6100", "6200", "6250"/);
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
  assert.match(salesCreditMigration, /\r?\n {4}null,\r?\n {4}v_actual\.payables/);
  assert.match(receivablesRoute, /Collection cash month · actual receipt month/);
  assert.match(receivablesRoute, /Dr 1000 Bank \/ Cr 1100 Trade Receivable/);
  assert.match(receivablesRoute, /Canonical cash/);
});

test("actual Sales Ledger is a standalone Finance view and excludes forecasts and leads", () => {
  assert.match(salesLedgerMigration, /create or replace view vyndi_report_sales_ledger/);
  assert.match(salesLedgerMigration, /sale_type in \('bicycle','spare_component'\)/);
  assert.match(salesLedgerMigration, /Actual invoiced Sales Ledger across bicycles and spare\/components/);
  assert.match(salesLedgerRoute, /createFileRoute\("\/command\/sales-ledger"\)/);
  assert.match(salesLedgerRoute, /Actual Sales Ledger/);
  assert.match(salesLedgerRoute, /Actual invoices only/);
  assert.match(workflow, /to: "\/command\/sales-ledger", label: "Sales Ledger"/);
  assert.match(salesLedgerAuthority, /vyndi_report_sales_ledger/);
});

test("spare and component sales reuse canonical Master Inventory FIFO and preserve controlled identity evidence", () => {
  assert.match(salesLedgerMigration, /create table if not exists vyndi_spare_sales/);
  assert.match(salesLedgerMigration, /post_vyndi_spare_sale_dispatch/);
  assert.match(salesLedgerMigration, /post_vyndi_inventory_issue/);
  assert.match(salesLedgerMigration, /spare_dispatch_cogs/);
  assert.match(salesLedgerMigration, /'accountCode','5000','debitInr'/);
  assert.match(salesLedgerMigration, /'accountCode','1200','creditInr'/);
  assert.match(salesLedgerMigration, /FIFO authority was not bypassed/);
  assert.match(salesLedgerMigration, /allocated_identity_refs/);
  assert.match(spareIdentityMigration, /array_agg\(q\.identity_uid/);
  assert.match(salesLedgerAuthority, /master_inventory_items/);
  assert.match(salesLedgerAuthority, /vyndi_inventory_available_to_promise/);
  assert.match(salesLedgerRoute, /Serial selection cannot bypass FIFO/);
});

test("spare invoices share GST, receivable and credit controls instead of creating a parallel accounting path", () => {
  assert.match(salesLedgerMigration, /issue_vyndi_spare_credit_tax_invoice/);
  assert.match(salesLedgerMigration, /tax_profile_status/);
  assert.match(salesLedgerMigration, /credit_profile_status/);
  assert.match(salesLedgerMigration, /'controlled','spare_component'/);
  assert.match(salesLedgerAuthority, /issueSpareSaleInvoice/);
  assert.match(salesLedgerRoute, /Spare tax invoice/);
  assert.match(salesLedgerRoute, /Trade Receivable/);
  assert.match(salesLedgerRoute, /to="\/command\/receivables"/);
});

test("aftermarket revenue reaches VIBPE financial actuals without corrupting bicycle unit actuals", () => {
  assert.match(salesLedgerMigration, /sum\(amount_lakh\)::numeric\(18,4\) revenue/);
  assert.match(salesLedgerMigration, /sum\(units\) filter\(where sale_type='bicycle'\)/);
  assert.match(salesLedgerMigration, /Revenue\/AR include all issued sale types; units count bicycles only/);
  assert.match(salesLedgerRoute, /Spare quantities do not enter bicycle unit actuals/);
});

test("route loading feedback keeps the top bar and adds a Vayu cursor halo", () => {
  assert.match(rootRoute, /data-page-loading-status="route-transition"/);
  assert.match(rootRoute, /function CursorLoadingHalo/);
  assert.match(rootRoute, /data-page-loading-cursor-halo="vayu"/);
  assert.match(rootRoute, /VAYU_LOGO_PATH/);
  assert.match(rootRoute, /motion-safe:animate-spin/);
  assert.match(rootRoute, /pointermove/);
});


test("actual manufacturing cost flows from evidenced source cost to WIP, FG and dispatch COGS", () => {
  assert.match(actualCogsMigration, /epr_job_conversion_cost_allocations/);
  assert.match(actualCogsMigration, /approve_vyndi_job_conversion_cost/);
  assert.match(actualCogsMigration, /Source journal line must be posted/);
  assert.match(actualCogsMigration, /Job allocation exceeds the evidenced source journal debit/);
  assert.match(actualCogsMigration, /'1210','debitInr'/);
  assert.match(actualCogsMigration, /v_total:=round\(v_material\+v_labour\+v_outsourcing\+v_consumables\+v_mfg_dep\+v_support_dep\+v_overhead\+v_scrap\+v_rework/);
  assert.match(actualCogsMigration, /'1220','debitInr',v_total/);
  assert.match(actualCogsMigration, /unit_actual_cost_inr/);
  assert.match(actualCogsMigration, /Dispatch blocked: completed Job Card % has no governed actual finished-goods unit cost/);
  assert.match(actualCogsMigration, /unitActualCostInr/);
  assert.match(actualCogsMigration, /vyndi_job_actual_cost_trace/);
});

test("Accounting Workbench controls conversion-cost allocation without creating parallel cost truth", () => {
  assert.match(authority, /createJobConversionCostAllocation/);
  assert.match(authority, /approveJobConversionCostAllocation/);
  assert.match(authority, /rejectJobConversionCostAllocation/);
  assert.match(authority, /epr_job_conversion_cost_allocations/);
  assert.match(authority, /sourceCostLines/);
  assert.match(accountingRoute, /Actual Job Conversion Cost/);
  assert.match(accountingRoute, /Posted source cost → approved WIP allocation → Finished Goods → dispatch COGS/);
  assert.match(accountingRoute, /Approve to WIP/);
  assert.match(accountingRoute, /Total actual/);
});


test("tooling authority separates accounting depreciation from commercial recovery", () => {
  assert.match(toolingRecoveryMigration, /vyndi_tooling_cost_profiles/);
  assert.match(toolingRecoveryMigration, /vyndi_tooling_depreciation_runs/);
  assert.match(toolingRecoveryMigration, /approve_vyndi_tooling_cost_profile/);
  assert.match(toolingRecoveryMigration, /post_vyndi_tooling_depreciation/);
  assert.match(toolingRecoveryMigration, /'6500','debitInr',v_dep/);
  assert.match(toolingRecoveryMigration, /'1590','creditInr',v_dep/);
  assert.match(toolingRecoveryMigration, /v_remaining:=greatest\(v_depreciable-coalesce\(v_asset\.accumulated_depreciation_inr,0\),0\)/);
  assert.match(toolingRecoveryMigration, /least\(v_monthly,v_remaining\)/);
  assert.match(toolingRecoveryMigration, /'manufacturing_depreciation'/);
  assert.match(toolingRecoveryMigration, /row_number\(\) over\(order by j\.id\)/);
  assert.match(toolingRecoveryMigration, /round\(v_dep-v_allocated,2\)/);
  assert.match(toolingRecoveryMigration, /sum\(s\.units\) filter\(where j\.id is not null\)/);
  assert.match(toolingRecoveryMigration, /vyndi_tooling_recovery_status/);
  assert.match(toolingRecoveryMigration, /Commercial recovery does not post accounting journals/);
  assert.match(toolingRecoveryMigration, /manufacturing_tooling/);
  assert.match(toolingRecoveryMigration, /when v_category in \('office_admin','manufacturing_tooling'\) then '1500'/);
  assert.match(toolingRecoveryMigration, /asset_class in \('office_admin','manufacturing_tooling'\)/);
  assert.match(toolingRecoveryMigration, /refresh_vyndi_tooling_depreciation_allocation_status/);
  assert.match(toolingRecoveryMigration, /fully_approved/);
});

test("Accounting Workbench exposes tooling depreciation and non-ledger recovery KPIs", () => {
  assert.match(authority, /createToolingCostProfile/);
  assert.match(authority, /approveToolingCostProfile/);
  assert.match(authority, /postToolingDepreciation/);
  assert.match(authority, /toolingRecovery/);
  assert.match(accountingRoute, /Tooling Cost & Recovery Authority/);
  assert.match(accountingRoute, /Dr 6500 \/ Cr 1590/);
  assert.match(accountingRoute, /Commercial recovery/);
  assert.match(accountingRoute, /management\/pricing measures only; they do not inflate accounting COGS/);
  assert.match(accountingRoute, /Unrecovered tooling/);
  assert.match(accountingRoute, /Depreciation & allocation runs/);
  assert.match(accountingRoute, /Open source Asset Register/);
  assert.match(accountingRoute, /Open actual CAPEX \/ payment evidence/);
});


test("manufacturing tooling is a first-class governed capital asset", () => {
  assert.match(peopleOfficeAuthority, /"manufacturing_tooling"/);
  assert.match(peopleOfficeRoute, /Manufacturing tooling \/ mould \/ fixture/);
  assert.match(toolingRecoveryMigration, /asset_class in \('office_admin','office_consumable','manufacturing_tooling'\)/);
  assert.match(toolingRecoveryMigration, /when v_category in \('office_admin','manufacturing_tooling'\) then '1500'/);
  assert.match(toolingRecoveryMigration, /a\.asset_class in \('office_admin','manufacturing_tooling'\)/);
});
