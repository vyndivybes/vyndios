# VYNDI OS — Day-1 Bookkeeping Operational Acceptance

**Scope:** readiness to START and routinely maintain legally usable books, **not** the ability to close and certify an accounting period.

## Two independent release decisions

- **Day-1 software acceptance:** The 18 gates in `src/lib/finance/bookkeeping-day1-acceptance.ts` require independently reviewed, baseline-SHA-specific evidence. Operational books must be balanced, editable only by authorized workflows, fully auditable and exportable, with genuine source documents, a tested restore path and India-resident daily backups when subject to Indian Companies (Accounts) Rules.
- **CA-period review:** The 13 statutory period-close blockers in `src/lib/finance/statutory-authority.ts` apply when the company actually closes its first period. Do not require prior reconciled bank sessions, a posted monthly stocktake or a CA evidence pack merely to start recording bona fide operations.

A **technical integrity PASS** on the Accounting Workbench proves only the current database-level integrity subset (source-linked posted journals, balanced double entry, no posting exceptions, active edit-audit triggers and posted-journal/period locks). It is **not** overall operational acceptance or an external CA opinion.

## Pre-use evidence checklist

| Domain | Verifiable acceptance evidence |
|---|---|
| Entity and tax setup | Legal status, incorporation date if applicable, FY, PAN, GST/TDS applicability; do **not** fabricate a GSTIN or force GST where not registered |
| Account master / opening books | Reviewed chart of accounts and opening balances. For a new entity, an explicitly approved zero-opening setup is valid |
| Authentication | Logged-in role enforcement, CSRF/Origin validation, session invalidation and denial of unauthorized writes |
| SoD and escalation | Maker/checker negative tests on actual SQL authorities for high-risk actions; no AI or founder override |
| Double-entry | Real SQL-backed source-to-journal mapping, balanced postings, AP/AR and payment/receipt lifecycle |
| Immutability | Posted journals and lines cannot be edited; reversal/adjustment retains links; hard-closed periods cannot accept backdated posting |
| Audit trail | Non-disableable insert/update/delete edit trail for **all** book transaction tables including material changes, with identity and original/new values; export and integrity review |
| Documents and retention | Invoices, receipts, contracts and vouchers linked to source events; legible export and retrievable documents |
| India daily backup | Evidence of automated **daily** backup of books, vouchers and audit trail on servers **physically located in India**, including provider location and completed run checks |
| Restoration | Successful **independent** restore drill, completeness check, checksum and recovery evidence |
| Purchase, sales and taxes | Supplier invoice/ITC, customer tax invoice/HSN/POS/IRN conditional on applicability, GST/TDS controls and CA-reviewable exports |
| Manufacturing | Governed PO→GRN→FIFO issue→Job Card WIP→FG→dispatch COGS; no size-specific ledger duplication where product/variant suffices |
| Bank / cash | Bank statement ingest and matching, bank GL movement, approved reconciliations when periods are closed |
| Reports | Full journal, general ledger, daybook, TB, P&L, balance sheet, GST/TDS working papers, AR/AP ageing, inventory valuation and fixed-asset register |
| Engineering release | CI green, reproducible deployment SHA, migrations readback, protected credentials and verified rollback |

For each gate, store the exact tested release SHA, independent reviewer identity, timestamp, evidence reference, test outcome and any deviation. A self-entered PASS label or a synthetic fixture is not independent evidence.

Run `npm run finance:day1:verify` with an actual evidence manifest (`DAY1_EVIDENCE_JSON`) and exact `DAY1_DEPLOY_SHA`; its manifest assessment cannot replace inspection of the underlying artifacts.

## Current infrastructure item requiring implementation

The connected production Neon project has region `aws-us-east-2` (Ohio). No independent evidence of a daily India-resident backup has yet been established through the connected infrastructure.

**Do not assume** that an `apac` Cloudflare R2 location hint guarantees storage physically in India; Cloudflare explicitly describes location hints as best-effort. A separate, India-region storage service with contractually verifiable physical residency, daily automated exports of the complete books **and audit trail**, encryption, retention and routine restore evidence must be commissioned and validated before certifying the India-backup gate. The primary database need not itself be in India if applicable rules are met, but the required backup must be.

## Distinct first-month workflow

Start with controlled master data and authorized daily postings. Reconcile actual bank movements, perform applicable inventory observation and classify GST/ITC with genuine evidence. At period end, clear all applicable 13 close blockers, review TB/returns/asset schedules and obtain independent CA acceptance. The fact that a new company has not yet closed a month is **not** itself a day-one technical product defect.

This document is a control specification, not legal advice, an audit opinion or a statutory certification. An appointed CA should review the company's applicable tax and reporting requirements before relying on external financial statements.
