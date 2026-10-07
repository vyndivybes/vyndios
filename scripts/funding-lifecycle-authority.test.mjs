import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
const read=(p)=>readFile(p,"utf8");

test("Funding lifecycle has append-only loan and grant authority ledgers",async()=>{
  const m=await read("migrations/0142_funding_lifecycle_authority.sql");
  for(const table of [
    "vyndi_funding_loans","vyndi_funding_loan_ledger",
    "vyndi_funding_grants","vyndi_funding_grant_receipts",
    "vyndi_funding_grant_utilisation","vyndi_funding_grant_conditions"
  ]) assert.match(m,new RegExp("create table if not exists "+table,"i"),table);
  assert.match(m,/deny_vyndi_funding_ledger_mutation/i);
});

test("Loan authority derives principal interest and total outstanding without double-counting drawdown cash",async()=>{
  const m=await read("migrations/0142_funding_lifecycle_authority.sql");
  assert.match(m,/vyndi_funding_loan_balance/i);
  assert.match(m,/register_vyndi_loan_drawdown/i);
  assert.match(m,/accrue_vyndi_loan_interest/i);
  assert.match(m,/post_vyndi_loan_repayment/i);
  assert.match(m,/apply_vyndi_verified_cash_movement/i);
  assert.match(m,/funding_source='loan'/i);
  assert.match(m,/principal_outstanding_lakh/i);
  assert.match(m,/accrued_interest_lakh/i);
});

test("Grant authority tracks award receipt conditions utilisation and available balance",async()=>{
  const m=await read("migrations/0142_funding_lifecycle_authority.sql");
  assert.match(m,/vyndi_funding_grant_balance/i);
  assert.match(m,/register_vyndi_grant_receipt/i);
  assert.match(m,/post_vyndi_grant_utilisation/i);
  assert.match(m,/record_vyndi_grant_condition/i);
  assert.match(m,/funding_source='grant'/i);
  assert.match(m,/available_to_utilise_lakh/i);
  assert.match(m,/open_condition_count/i);
  assert.match(m,/cannot exceed received grant funds/i);
});

test("Funding server exposes governed loan and grant lifecycle operations",async()=>{
  const a=await read("src/lib/cash-funding-authority.ts");
  for(const fn of [
    "listFundingLifecycle","createFundingLoan","registerLoanDrawdown","accrueLoanInterest","postLoanRepayment",
    "createFundingGrant","registerGrantReceipt","postGrantUtilisation","recordGrantCondition"
  ]) assert.match(a,new RegExp("export const "+fn+"\\b"),fn);
});
