# Pre-production commissioning clarification and security cleanup

On 2026-11-02 the owner clarified: "There is no released job card yet. No approved because the design is still not confirmed."

## Business state

Real manufacturing is NOT RELEASED. Design confirmation and genuine engineering/physical approval are future prerequisites, not software defects to bypass.
The four existing accepted demo orders remain simulation-only. Their legacy status, historical approval, inventory, PO, COGS and audit fields are preserved.
Migration-seeded engineering baselines with CUTOVER sources or system:migration approvers are not genuine design releases; the existing engineering-baseline reconciliation already rejects that interpretation.
No ECN or physical approval has been fabricated, and PR #102 is not activated.

Production presentation excludes exact known demo IDs, held/stale cards, shared command actors and migration actors from real approval counts.
Known demo orders are blocked before normal synchronization, batch approval, reservation refresh and FIFO consumption at the application boundary.
This guard does not activate retirement classification or remove any source record from planning/history.
Simulation remains independently accessible and does not confer physical authority.

## Dependency remediation

Hosted audit of the original lock reports 24 findings: 6 critical, 2 high, 14 moderate and 2 low.
An uncommitted compatible candidate still left Better Auth affected and changed unrelated packages, so it was not adopted.
The targeted candidate pins patched TanStack Start 1.168.60, Better Auth 1.7.15 and Zod 4.6.7 with the corresponding resolved dependency tree.
The first targeted candidate left 14 moderate lint-chain findings. A separate hosted minimatch 11.0.1 candidate passed actual ESLint rule execution, repository config matching and TypeScript/TSX parsing, and its full audit reports zero findings.
The qualified minimatch override is adopted with a permanent compatibility regression. No lint package or linting check was removed.
Qualification now requires zero known advisories in both production and full dependency trees.
Better Auth 1.7 removed genericOAuthClient and moved generic sign-in to the standard social API. Client and popup calls are migrated together; Grok identity uses immutable OpenID sub and PKCE remains enabled.
Production has only credential-provider account rows and no duplicate provider/account keys. Better Auth 1.7.15 keeps the 1.6 account schema; no production auth-account backfill is performed.
No unreviewed blanket npm audit fix --force was used.

## Runtime credential boundary

The production runtime role still inherits neon_superuser. This dependency/UI change does not cut over credentials or silently revoke working production privileges.
The staged process in COMMISSIONING-2026-11-02.md remains required: explicit runtime privilege inventory, isolated ordinary-role qualification, then a controlled binding/credential transition with rollback.
Production transaction, inventory, finance, audit history and recovery branches remain protected.
