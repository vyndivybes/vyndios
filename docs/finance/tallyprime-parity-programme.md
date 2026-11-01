# TallyPrime feature parity programme — VYNDI OS

**Scope:** Vāyú Shastr India operations; accounting-grade parity without copying proprietary Tally code or screens. TallyPrime is a feature benchmark, not a dependency.

**Status (2026-10-16):** Implementation programme opened. Presence of code or tests is not a production-compliance certification. No claim of complete feature parity, CA acceptance, government portal certification, or successful live integration.

## Existing VYNDI OS implementation evidence (reviewed paths)

| Domain | Repo evidence | Assessment |
| --- | --- | --- |
| Transaction posting; GL; trial balance | `migrations/0063_live_finance_posting.sql`, `src/lib/finance/general-ledger.ts`, `scripts/live-finance-posting.test.mjs` | Code and source-oriented tests present; full transactional and live accuracy unverified |
| Financial statements and finance workbench | `src/lib/finance/financial-statements.ts`, `src/routes/command/accounting.tsx` | Code present; regulatory presentation unverified |
| Bank matching and bank controls | `src/lib/finance/accounting-authority.ts`, `scripts/finance-ca-sod-gates.test.mjs` | Controls present; connected-bank parity unverified |
| Inventory stocktake and variance accounting | `scripts/stocktake-statutory-controls.test.mjs` | Integration tests present; end-to-end production acceptance unverified |
| GST, ITC, IRN and financial hard close | `src/lib/finance/statutory-authority.ts`, `scripts/finance-hard-close-runtime.test.mjs` | Statutory gates present; tax accuracy and portal filing unverified |
| Finance audit, segregation of duties | `scripts/books-edit-audit.test.mjs`, `scripts/finance-ca-sod-gates.test.mjs` | Test cases present; external audit unverified |

## Complete feature-family backlog

**P0: Accounting integrity (release-blocking):**
- Voucher engine: payment, receipt, contra, journal, sales, purchase, debit/credit note; unique sequences, reversal rather than destructive edits, per-entity fiscal periods.
- Chart of accounts, account groups, opening balances, debit/credit rules, currency rounding; enforce every journal balances at database boundary.
- Customer/supplier subledgers and bill-wise allocations, advances, partial settlement, ageing, interest, write-offs and allocations.
- Cost centres, projects, divisions, job costing, budgets and variance, consolidated and separate books.
- Trial balance, general ledger, cash/bank books, day book, P&L, balance sheet, cash/fund flow, statutory schedules; each reconciles to the same posted ledger.
- Immutable edit log, maker/checker, permission-gated backdating and period close/reopen, export/recovery and restore drill.

**P0: India taxation and regulatory controls (CA-validated before live filing):**
- GST classification, place of supply, HSN/SAC, rates/exemptions, reverse charge, credit/debit notes, GSTIN validation and tax calculations.
- GSTR-1/3B summaries, input tax credit and IMS/2B reconciliation; exception workflow, amendments, evidence retention and portal export with schema-version tests.
- E-invoice IRN lifecycle, cancellation, QR and e-way bill lifecycle through authorised integration; no fabricated identifiers or falsely claimed government acceptance.
- TDS/TCS ledgers, rates, thresholds, challan and return-preparation checks; configurable effective-dated tax rules.
- Financial-year controls, MSME reporting where applicable, GST audit evidence and exportability. CA approval is a deployment gate.

**P1: Banking and finance operations:**
- Bank statement ingestion and normalized deduplication, suggestions/matching, suspense, reconciliation, refunds, payment advice.
- Connected banking only with opted-in provider credentials, scopes, transaction limits, independent approval and sandbox testing.
- Multi-currency revaluation/exchange gains and losses; interest calculations; cash management and cash flow forecast.

**P1: Procurement, sales, inventory and manufacture:**
- Quotes, estimates, price lists, purchase and sales orders, receipts/delivery notes, invoice and returns lifecycle, debtor/creditor ageing.
- Multiple stores/godowns, bins, batches, serial numbers, transfers, reorder levels, reservation, physical stocktake and FIFO/weighted cost per approved policy.
- Approved engineering BOM and revision links, manufacturing consumption and scrap, job work, subcontracting, production cost allocation, WIP and finished-goods COGS.
- Multi-division books and internal transfer/elimination; never treat a draft BOM as a released manufacturing authority.

**P1: Payroll and assets:**
- Employee master, attendance, leave, payroll structures, deductions, payslips, reimbursement, PF/ESI/professional tax and income-tax controls, with effective-dated compliance.
- Fixed-asset capitalization, depreciation, disposal and GL reconciliation, permissioned approval.

**P2: Reporting and interoperability:**
- Audit drill-through from every financial metric to source vouchers; selectable period, department, party, site, project and product dimensions.
- Excel/CSV/JSON exports, validated imports, duplicate and idempotency controls, optional Tally data migration via lawful documented export formats.
- Scheduled encrypted offsite backups, tested restore/RPO/RTO; complete access logs.
- JARVIS natural-language analytics backed only by authorized posted transactions with provenance; autonomous agents may propose but never unilaterally approve/post statutory filings, banking transfers or hard-close.

## Release acceptance contract

1. **Accounting invariant:** journal debits equal credits for every posted transaction, negative and unsupported currency amounts rejected as appropriate; source-to-ledger idempotency and reversals validated.
2. **Reconciliation:** GL = TB = statements = subledgers and inventory valuation/COGS at selected date, company and currency, including returns and backdated changes.
3. **Security:** tenant isolation, assigned RBAC, maker/checker, immutable audit logs; privilege and period-close bypass attempts fail.
4. **Tax:** approved effective-dated rules, reproducible example fixtures and accountant-signed expected outputs for GST/TDS/e-invoice cases; portal sandbox confirmation before enabling live gateways.
5. **Operations:** migration rehearsal + point-in-time backups/restore test, monitored failures, rollback plan and exact release commit qualification.
6. **User acceptance:** founder, accountant/CA, finance clerk and procurement operator workflows pass on production-like seeded data. No production financial records are required for synthetic tests.

## Execution sequence

1. Inventory routes, migrations and tests; build a machine-verifiable feature coverage manifest marked `verified`, `partial` or `missing`. Never mark present code as end-to-end verified without running relevant test suites.
2. Close accounting invariant and reporting reconciliation gaps first.
3. Add tax and statutory export validation with accountant-approved fixtures, **before** government/financial API connectivity.
4. Complete bank/inventory/payroll and asset accounting parity by priority.
5. Qualify analytics, audit evidence, backups and operational commissioning.

**Source benchmark:** https://help.tallysolutions.com/tally-prime/ ; https://help.tallysolutions.com/tallyprime-features-release-wise/ ; https://help.tallysolutions.com/tallyprime-get-started/

**Ownership:** Finance controls belong to VYNDI OS; VAOS may orchestrate and explain, not bypass approval and financial authority.
