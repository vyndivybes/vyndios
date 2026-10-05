# Page duplication audit
Baseline: PR #424 branch. Source inspection only; not browser or data reconciliation certification.

| Routes | Finding | Disposition |
|---|---|---|
| /command/epr-live and /command/quality | Functional overlap confirmed: Live EPR invokes recordEprInspection and recordNcrCapa from src/lib/epr/traceability.ts, inserting epr_inspections and epr_ncr_capa. Quality authority uses vyndi_quality_inspections, vyndi_quality_ncrs and vyndi_quality_capas. | High priority: trace consumers, triggers and release rules; define canonical mapping preserving characteristic-level EPR measurements, evidence and existing IDs. Do not delete or redirect either writer until replacement covers its operations. |
| /command/epr-workflow, /command/epr-execution, /command/epr-live | Workflow is a link guide; Execution renders static gates and ALL_KNOWLEDGE; Live hosts transactions. Names imply three execution surfaces. | Consolidate/reference-label the first two; Live remains transactional pending domain ownership reconciliation. Preserve unique reference content and old links. |
| /command/legal and /command/legal-control | Legal uses listCanonicalLegalAuthority and lifecycle controls; Legal Control renders static LEGAL_CONTROLS. Static page calls itself a controlled legal register. | Keep persisted Legal/IP register authoritative; clearly classify static controls as reference guidance, preferably within that workspace. |
| /command/qa-verification and /command/quality | QA Verification edits operating action/checklist status; Quality handles product inspection/NCR/release. | Not equivalent records. Clarify governance checklist versus product quality; do not replace one with the other. |
| /command/ca-audit and /command/accounting-statements | CA Audit builds planning/store-based accounting and launch checks; Statements uses getAccountingStatements. | Distinguish planning-model assurance from posted-accounting statements. CA Audit must not be presented as statutory audit completion. |
| /command/balance-sheet and /command/accounting-statements | Balance Sheet reads posted snapshots through listCanonicalBalanceSheetAuthority; Statements reads accounting authority by financial year. | Related financial views, not proven identical. Reconcile periods, units, sources and snapshot age; make snapshots a clearly labelled view of finance, not an independent truth. |
| /command/procurement, /command/procurement-planning, /command/purchase-execution | Supplier risk/performance and shortage visibility; planning requirements; PO transactions are different roles. | Retain specialist functions under one procurement workspace; avoid duplicate input forms. |
| /command/manufacturing and /command/production | Maintenance/control registers versus job-card production execution. | Distinct tasks. Improve navigation discoverability of Maintenance instead of creating another copy. |
| /command/finance, /command/ops, /command/production-jobcards | Actual route files throw redirects to financial-cockpit, operations and production respectively. | Already compatibility aliases, not duplicate implementations. Preserve old bookmarks. |
| Inventory variants | Metadata distinguishes canonical inventory, hidden admin reconciliation, openings, audit and legacy routes. inventory-ledgers.tsx is an Outlet layout, not a duplicate ledger page. | Inspect child routes before consolidation; route count alone does not establish duplication. |

## Additional confirmed metadata drift
page-metadata.ts labels Operations as planning and Production as Production Planning.
Its balance-sheet ownership description says planning projection while the current page explicitly reads posted snapshots.
Correct descriptions only after ownership reconciliation; mode/domain also affect access, so do not change permission classifications as cosmetic renames.

## Required before consolidation
- Inventory each page's reads, writes, entity IDs, unique fields and source tables.
- Trace EPR/Quality triggers, release consumers and historical records; establish whether any synchronization already exists.
- Implement one writer per business object with compatibility adapters or governed migration.
- Retain unique workflow capabilities, evidence and audit history.
- Align navigation/search/manual/VIBPE links and labels.
- Test direct old URLs, role restrictions, persistence and candidate mobile/desktop navigation.
- Do not report duplicates cleared until the replacement flows and redirects have run successfully.

No routes or historical records were removed by this audit.
