# VYNDI Finance & Accounting Backbone

**Status:** implementation baseline for governed management accounting and transaction evidence. Statutory filing/certification remains subject to appointed CA review and applicable law.

## Authority model

VYNDI must not maintain a second parallel finance truth. The existing operational records remain the source of business events:

`Demand / Sales / PO / GRN / Inventory / Job Card / Traveller / Dispatch`

Those events feed the finance backbone in this order:

1. **Governed cost source** — FIFO actual cost, then approved PO price, then supplier/planning fallback under the existing procurement authority.
2. **Job cost accounting** — actual material + direct labour + outsourcing + consumables + manufacturing/support depreciation + allocated overhead + scrap/rework.
3. **Inventory valuation** — raw material → WIP → finished goods → COGS.
4. **Accounting posting** — balanced double-entry journal with source reference and immutable posted state.
5. **General ledger / trial balance** — derived only from posted journals.
6. **Statutory-control evidence** — invoice-level GST, bank reconciliation, fixed-asset evidence and payroll/statutory evidence.
7. **VIBPE** — consumes finance outputs and exceptions; it does not silently invent or rewrite accounting actuals.

## F1 — Existing ledgers become canonical

The existing People & Office and Equipment ledgers are retained. New finance assumptions default to itemised People & Office costs. The old aggregate OPEX function remains only as a compatibility fallback when no itemised ledger exists.

No duplicate People, Office, CAPEX or consumables ledger is introduced.

## F2 — Cost accounting

`src/lib/finance/cost-accounting.ts` calculates job-level actual cost with:

- actual FIFO/governed material cost input;
- standard material comparison and variance;
- direct labour;
- outsourcing;
- manufacturing consumables;
- manufacturing and support depreciation;
- other allocated manufacturing overhead;
- scrap and rework;
- unit actual cost;
- finished-goods capitalization and remaining WIP.

The resulting snapshot is persisted in `epr_job_cost_snapshots` with Job Card traceability.

## F3 — Accounting core

`src/lib/finance/general-ledger.ts` provides:

- core chart of accounts;
- journal validation;
- balanced double-entry posting;
- reversal instead of silent mutation of posted journals;
- trial balance generation;
- source posting helpers for supplier invoices, material issues, production completion, sales invoices, COGS, customer receipts and supplier payments.

Persistent tables:

- `epr_finance_journals`
- `epr_finance_journal_lines`

Accounting actuals must move through `draft → posted`; corrections to posted entries must be represented by reversal/adjustment entries.

## F4 — Statutory / evidence controls

`src/lib/finance/statutory-controls.ts` adds deterministic controls for:

- invoice-level output/input GST and ITC evidence;
- bank-book versus bank-statement reconciliation;
- fixed-asset capitalization/evidence and net-book-value support;
- payroll/statutory payment and return evidence.

Persistent tables:

- `epr_finance_gst_ledger`
- `epr_finance_bank_statement_lines`
- `epr_finance_fixed_assets`
- `epr_finance_payroll_controls`

These controls support management governance and reconciliation. They do not constitute a statutory audit, tax opinion, GST filing, TDS filing or certification.

## Required integration sequence after merge

1. Post governed PO/GRN/supplier-invoice/payment events to the journal service.
2. Post material issues from Traveller/Job Card against FIFO actual cost.
3. Capture job-cost snapshot at controlled production completion/release.
4. Capitalize completed value from WIP to Finished Goods.
5. Recognize COGS on dispatch/invoice under the approved commercial lifecycle.
6. Post customer invoices/receipts and supplier liabilities/payments.
7. Import bank statement lines and clear reconciliation exceptions.
8. Require GST, asset and payroll evidence before the CA/statutory launch gate can clear.

## Non-negotiable controls

- No manual overwrite of a posted journal.
- No finance posting without a source record/reference.
- No duplicate finance truth where an operational authority already exists.
- No VIBPE recommendation may directly create an accounting commitment without the governed transaction/action workflow.
- Statutory external reliance remains blocked until appointed-CA reconciliation and evidence controls are complete.
