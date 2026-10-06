# Department expansion — implementation and acceptance contract

Status: PREPARATION ONLY. No departmental implementation or qualification is claimed.
Source baseline: 3e8ff8a937db8885da4f07816d10b94de2348138.
One PR covers Quality, Maintenance, HR, Finance/financing, Taxation, Audit, recovery and VIBPE.
Guided Work/User Manual PR #423 is independent and deferred; do not merge it as part of this work.

## Architecture

Follow docs/VYNDI-BUSINESS-OPERATOR.md and the evidence-verification skill.
One canonical business source per concept. Extend existing authorities and ledger ownership.
Trace entry, validation, persistence, authorization, state transition, downstream effects, UI and audit.
Plans and forecasts stay separate from posted actuals. VIBPE remains advisory.
Do not invent payroll, leave, tax, retention, approval or recovery policies.
No paid AI APIs. No production test transactions or destructive restores.

## Initial source findings

These are static observations, not runtime certification or a complete gap audit.

| Area | Evidence | Finding / required follow-up |
|---|---|---|
| Quality | src/lib/quality-authority.ts | Inspections, NCR/CAPA and releases exist. Actor is command:role rather than individual identity. Release checks any historical final pass; investigate later failed inspections and linked Job Card/lot holds. Multi-statement changes require transaction/race review. |
| Maintenance | src/lib/asset-maintenance-authority.ts | Plans and work orders exist. Completion inserts maintenance parts and costs; that function does not issue canonical inventory. Coordinate atomic stock issue, cost ownership and duplicate protection. |
| HR | src/lib/people-office-authority.ts | Existing source is person/engagement and 36-month cost planning. Actor is command:role. Several listing queries are unbounded; lifecycle updates lack expected-revision predicates. Attendance/leave/training/exit coverage still requires wider audit. |
| Finance/tax | docs/STATUTORY-FINANCE-CONTROLS.md | Existing contract includes GST, bank matching, close locks and CA packs. Verify implementation and extend gaps, do not recreate these ledgers. Loan/grant operational coverage remains unverified. |
| Audit | Quality and People authority functions | Audit events exist but individual actor attribution needs correction. Audit-program/finding/independent-closure coverage remains unverified. |
| Recovery | scripts/h2-recovery-drill.mjs | Snapshot verifies migration names, one seeded order, its revisions, one cash actual and associated audits, then a restored order write. It does not demonstrate recovery of all departments or external attachments. |
| Restore safety | scripts/vyndi-zero-cost-restore.ps1 | Isolated-target switch and literal source/target URL comparison exist. Verify actual database identity, empty destination, archive integrity and transaction behavior before extending. |
| VIBPE | src/lib/vibpe-operational-status.ts and related operational query modules | Existing query/receipt architecture found. Department authorization, freshness, factual reconciliation and intent coverage require inspection and executable tests. |

## Required delivery inventory

- [ ] Quality: inspection register, criteria, NCR/CAPA, disposition/quarantine, calibration linkage, controlled release and traceability.
- [ ] Maintenance: equipment, preventive schedules, breakdown/work orders, stock-linked parts, labour/costs, downtime and verified restoration to service.
- [ ] HR: employee/engagement records, joining/exit, attendance/leave, qualifications/training, payroll inputs and assigned-asset/access closure.
- [ ] Finance: authoritative journals, GL, AR/AP, cash/bank, fixed assets, reconciliation, locks and reversals; preserve working existing features.
- [ ] Financing: funding sources, loan/repayment/interest records, grants and conditions; distinguish modelled schedules from posted transactions.
- [ ] Taxation: configured treatment, transaction-linked registers, obligations, reconciliation, payment/filing evidence and professional review; no invented rates or filing claims.
- [ ] Audit: programmes, findings, evidence, actions and independent closure.
- [ ] Shared: individual identity, department permissions, maker/checker rules, numbering, revisions, attachments, search/export/print, retention/archive, opening imports, reminders and business-unit/cost allocation.
- [ ] Concurrency: atomic mutation plus audit, expected revisions, idempotent retries and ledger reconciliation.
- [ ] Performance: bounded/paginated reads and no automatic loading of every department ledger.
- [ ] Recovery: database and attachment/configuration manifest, protected backup access, retention/failure records, migration compatibility and isolated restore.
- [ ] VIBPE: canonical authorized reads, evidence references, freshness, actual/forecast distinction, missing-data behavior and links to authorized workflows.
- [ ] UI: existing canonical workspaces, accessible forms, actionable validation, mobile/desktop tables and navigation.

## Acceptance matrix — all unchecked until executed

| Test group | Required evidence |
|---|---|
| Records | Create, save, reload, retrieve, update with revision, approve, correct/reverse and trace evidence |
| Permissions | Allowed and denied roles, individual audit identity, HR/payroll confidentiality and separation of duties |
| Consistency | Invalid input, stale edits, concurrent transitions, duplicate retries, partial-failure rollback and exact ledger effects |
| Quality | Failed inspection/hold prevents unauthorized material use or release; later failure cannot be bypassed by old pass |
| Maintenance | Work order/stock consumption/cost link reconcile; unavailable equipment blocked; return-to-service evidence |
| HR | Attendance/leave/payroll input lineage, training validity and controlled exit without silently deleting history |
| Finance/tax | Balanced postings, AR/AP and bank reconciliation, closed-period rejection, reversals, configured tax evidence and funding actuals |
| Audit | Finding ownership, actions, evidence and independent closure |
| Recovery | Populated fixtures for all six departments, attachments and configuration; source/restored hashes and relationships; post-restore workflows; production destination rejected |
| VIBPE | Authorized factual answers, amounts reconciled to ledgers, stale/missing evidence explicit, sensitive answers denied, no unauthorized mutation |
| Browser | Candidate-build desktop/mobile navigation, forms, tables, save/reload, validation, console and overflow |
| Release | Migration checks, typecheck, build, regressions and final diff tied to exact PR head; post-deploy acceptance tied to deployed SHA |

## PowerShell qualification preparation

Prepare one fail-fast runner using npm.cmd and explicit LASTEXITCODE checks.
Require an expected commit; reject mismatched/dirty tracked checkout; write evidence with actual SHA.
Run new departmental transactional suites and existing regression/build gates against the candidate.
Browser acceptance must target the candidate, not current production.
Restore requires a separately verified isolated database and non-production fixtures.
Record unavailable prerequisites as UNVERIFIED; never turn skipped checks into PASS.
The final command and test script names will be frozen after implementation; do not run guessed scripts.

## Current execution constraints

GitHub connector read/write is available. Local authenticated git clone was unavailable in this session.
No PowerShell executable or user Windows terminal control is available here.
No isolated database/attachment restore target or authenticated candidate-browser test session has been established.
These block qualification, not source inspection. Do not merge or claim completion until resolved.

## Execution sequence

1. Finish source/UI/schema/test inventory and classify every requested capability.
2. Freeze exact record definitions, ownership and migration plan.
3. Implement foundational identity/transaction controls, then departmental gaps, then recovery/VIBPE/UI.
4. Execute focused tests and final candidate qualification, including PowerShell and isolated restore.
5. Merge only after exact-head evidence. Verify deployed production separately.
