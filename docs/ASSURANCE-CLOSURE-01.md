# ASSURANCE-CLOSURE-01

## Purpose

Close the current VYNDI OS assurance-operations gap without restoring every historical heavyweight workflow.

## Active code gates

Development CI now verifies:

- deployable migration syntax and explicit historical migration lineage;
- Golden MES controls across order, production, reservation/FIFO, traveller, Quality and serialized dispatch;
- H2 recovery qualification;
- H4 IAM / segregation-of-duties controls;
- scanner controls;
- TypeScript compatibility;
- the Cloudflare production bundle.

A single active Production Assurance workflow runs weekly and on demand. It checks the exact deployed SHA, runtime/database/schema health, authenticated protected routes, SLO evidence and operator viewport behavior.

The files under `.github/workflows-enterprise/` remain reference material. They are not treated as active controls.

## Migration lineage

`0023_operating_plan_versions.sql` is an historical applied-only ledger entry. Production migration history must retain that row. The file must not be recreated as a deployable migration and the production row must not be deleted merely to make raw counts equal.

## Operational evidence still required

The following are real governance operations and **must not be claimed complete from source code alone**:

1. Capture the first real H4 access certification in production.
2. Register a real recovery checkpoint in the VYNDI Recovery Centre.
3. Execute and retain evidence from an isolated restore drill.
4. Run the production assurance workflow against the deployed commit.

Those records complete the operational assurance layer; this commit only makes the required controls active and testable.
