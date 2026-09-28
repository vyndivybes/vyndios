# VIBPE Cross-Repository Knowledge Control

**Effective:** 24 September 2026  
**Status:** Governed read-only Co-Pilot knowledge layer  
**Applies to:** VYNDI OS VIBPE Co-Pilot 2.0

## Objective

VIBPE may use reviewed information from other Vāyú repositories without performing a private GitHub fetch on every production question.

The runtime uses a curated, commit-pinned snapshot in `src/lib/vibpe-repository-knowledge.ts`. This keeps answers fast, auditable and deterministic while preserving each source repository's authority boundary.

## Current source baselines

| Source | Pinned commit | Role |
|---|---|---|
| `vayu-shastr/veloxis-engineering-design-manual` | `b874cde910ce462724b63bac6b7e7f79e7d68785` | controlled engineering/configuration reference |
| `vayu-shastr/adv-vibpe` | `3ca30a7891272870190b3f21340102451d7ff94b` | development/reference finance, governance and Co-Pilot doctrine |
| `vayu-shastr/vyndios` | `89de43701c16776a834b4ba67e38620d670160f7` | last independently audited self-repository evidence anchor; current runtime remains authoritative |

## Authority classes

- **controlled-reference** — source is declared controlling/approved inside its owning repository domain. Import into VYNDI is read-only and does not create a new approval.
- **advisory** — useful reference/development knowledge; cannot overwrite current governed truth.
- **unresolved** — may support investigation but cannot satisfy a release, transaction or master-data gate.

## Current engineering precedence

The reviewed VEDM configuration at the pinned commit declares:

- VEDM-301 Rev 5.3.9 Candidate E-K75 — controlling frame-geometry authority.
- Rev 5.4 FK75 — preferred VAEA fork/front-end development freeze; not released.
- VEL-PLY-2026 Rev 5.4.1 — current approved-reference / Toray-facing frame-laminate source.
- Rev 5.4.2 — development/reconciliation; not approved.

Older repository documents that still describe Rev 5.3.8 as current are stale for present configuration resolution and must not override the current configuration status.

## VYNDI precedence

ERP transactions, actual ledgers, approved masters, governed IBPE packets and current VYNDI runtime services remain authoritative for their owning domains.

Cross-repository knowledge cannot directly:

- create or approve a PO;
- post a journal;
- alter inventory;
- release production;
- approve a design;
- modify a governed plan;
- raise or commit funding;
- change master data.

## Optimizer operation

Current VYNDI optimization sequence:

1. create/refresh the governed IBPE snapshot;
2. build or refresh the immutable advanced-planning packet;
3. satisfy authority/model/cash preparation gates;
4. explicitly run governed HiGHS from the Optimizer page;
5. review persisted mathematical and cash-governance evidence;
6. review Outputs & Evidence;
7. review Assurance;
8. review Release Readiness.

Chat cannot auto-run the solver.

## Refresh procedure

When a source repository changes materially:

1. review the source repository's current authority/control record;
2. capture the new exact commit SHA;
3. update only the affected snapshot records;
4. preserve the previous source lineage in Git history;
5. run `scripts/vibpe-repository-knowledge.test.mjs`;
6. run the VIBPE Co-Pilot regression gate;
7. deploy only after normal repository review and production controls.

A newer date, filename or branch is not by itself proof of authority.

For `vayu-shastr/vyndios` itself, the pin is intentionally the last independently audited main SHA rather than the commit that contains the register. A source file cannot contain its own future commit SHA. Current runtime lineage is carried separately by `VYNDI_SOURCE_SHA` and the release-marker endpoint.
