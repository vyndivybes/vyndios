# 5P Finance BI Foundation — 2026-11-01

## Plan and boundaries
This branch extends the existing VYNDI OS posted-general-ledger statement engine and exposes management BI through the existing signed, read-only VAOS financial bridge. No duplicate accounting ledger, financial posting rights, statutory CA approval or paid AI API is introduced.

## Prepared sources
- Financial statements: `src/lib/finance/financial-statements.ts` (posted ledger; accounting source of truth)
- Accounting display: `src/routes/command/accounting-statements.tsx`
- Cross-system projection: VAOS `intelligence/financial-scorecard.mjs`
- CA/Tally authority and the signed-accounts register are intentionally unchanged.

## Proceed / Perform
- Source-derived cash inflow classification: operating, investing and financing.
- Cash CAPEX is the eligible **direct fixed asset (account 1500) to bank (account 1000) outflow**, capped by fixed-asset debit; independently documented reversals may offset the expenditure.
- `indicativeFreeCashFlowInr = operatingCashFlowInr - directCashCapexInr`.
- **This is not complete certified FCF.** Asset-purchase payments clearing payable account 2000, prepaid capex settlements, split/indirect payments and other investing flows may be absent. Do not relabel it as full FCF.
- Company gross and net margins from accrual posted statements.
- Closing working capital from the existing statement engine.
- Closing-balance management proxies: DSO = closing AR/period sales × calendar days; inventory days = closing on-book inventory/period COGS × days; payables-to-COGS days = closing AP/period COGS × days; indicative cash conversion cycle = sum of DSO and inventory days less payables proxy. Payables proxy is NOT formal purchase-based DPO.
- No period journal activity, invalid denominators and failed balance/cash/fund reconciliation suppress inapplicable measures instead of displaying synthetic zeros.
- Both applications show data status and source qualification notes.

## Persist / Qualification
- Focused tests: `src/lib/finance/financial-intelligence.test.ts`, `src/lib/finance/financial-statements.test.ts`.
- PR workflow: `.github/workflows/finance-bi-foundation.yml`.
- Run broader typecheck/browser/production UAT before release.
- Report results from Actions runs and production endpoints separately. Unit test PASS never equals production PASS.

## Outstanding engineering gates (not claimed complete)
1. Join CAPEX invoices/payable-clearance records and bank settlement lineage; qualify full FCF calculation.
2. Implement an authorized 13-week liquidity forecast using actual AR/AP due dates, payroll, tax and purchase commitments.
3. Link product model/SKU revenue to job-cost snapshots before publishing per-product contribution/profitability.
4. Qualify 36-month approved plan actuals against posted ledger after period-close.
5. Materialize signed, auditable KPI evidence metadata, anomaly alerts, and CA-sensitive read permissions for each tenant.
6. Add independent browser production checks and multi-tenant isolation validation before general availability.

## Release policy
Review both draft PRs independently. Merge VYNDI first after complete CI; merge VAOS only when the corresponding financial-statement schema is deployed and signed bridge verified. Do not infer missing actuals, replace unavailable with zero, or change certification without human CA approval.
