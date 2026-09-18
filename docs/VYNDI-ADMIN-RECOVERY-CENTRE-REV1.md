# VYNDI Admin Backup & Recovery Centre — Rev 1

**Baseline:** production-certified V1 SHA `3ecf954443fdc2a6f879c07af87ca355b666f09c`  
**Scope:** zero-cost operational recovery governance layered over the existing H2 backup/restore proof.

## Purpose

The Recovery Centre gives an Administrator one controlled place to:

- register recovery checkpoints produced by Neon history/branches, `pg_dump`, or another managed snapshot;
- request a full disaster restore without overwriting the damaged production database;
- request selective recovery of revisioned VYNDI entities;
- preview the current state versus the recovery state;
- enforce different-Admin maker/checker approval;
- execute supported selective recovery through canonical business writers;
- record full-restore validation and infrastructure cutover evidence;
- retain append-only recovery events.

It does **not** store database credentials, connection strings, API tokens, or backup bytes.

## Zero-cost operating model

VYNDI does not require a paid Neon backup feature for this control plane.

Current zero-cost layers are:

1. Neon Free history / recent recovery window where available.
2. A no-compute certified recovery branch when free branch capacity permits.
3. PostgreSQL custom-format external backups using `pg_dump -Fc`.
4. Local or existing synced-drive storage for rotating dumps.
5. H2 `pg_restore` recovery validation.
6. Admin Recovery Centre evidence, approval and selective-recovery control.

The application cannot safely invoke `pg_dump` from Cloudflare Workers and therefore does not pretend that a UI button is a physical database backup. Physical backups remain an infrastructure operation; the Admin page registers their evidence and governs recovery from them.

The Admin Recovery Centre also reports the runtime release SHA when exposed by the release marker path, confirms that the Recovery Centre database query is healthy, and shows external backup state as **REGISTERED** or **MISSING**. Missing external backup evidence is never silently treated as healthy.

## Selective recovery boundary

V1 executable selective recovery is intentionally limited to entities with a proven revisioned canonical writer:

- `sales_order` → `save_vyndi_sales_order`
- `monthly_actual` → `save_vyndi_monthly_actual`

The Admin surface also exposes a fail-closed support matrix for domains that are **compare / corrective-action-only** rather than generically restorable:

- Purchase Order → Procurement authority
- GRN / Receipt → Receiving authority
- Production Job Card → Production authority
- Inventory lot / serial / controlled identity → Inventory movement / stocktake / return authority
- Customer Invoice → Sales Ledger credit/debit/reversal authority
- Supplier Payment → Payables / cash-reconciliation authority
- Quality Record → Quality disposition / retest / correction authority

These types are deliberately not raw-restored from backup because doing so could bypass FIFO, serial/lot identity, finance journals, tax evidence or production/quality genealogy.

A selective recovery:

1. loads a historical revision or an externally recovered snapshot;
2. captures the current canonical state and its fingerprint;
3. previews current versus recovery state;
4. creates a pending recovery request;
5. requires a different Admin to approve;
6. rechecks that the current entity has not changed since the request;
7. invokes the canonical writer;
8. creates a **new** revision;
9. appends recovery and canonical audit evidence.

It never runs raw `UPDATE` / `DELETE` against the owning business table.

For inventory, procurement execution, production/quality genealogy, invoices, collections, payments and statutory postings, V1 continues to use their owning reversal/correction processes. Generic row replacement is prohibited because it could break FIFO, serial/lot identity, journal, tax or genealogy lineage.

## External-backup selective recovery

When a record must be recovered from an external database dump:

1. restore the dump to a new isolated database;
2. extract the required entity snapshot from that restored database;
3. register the backup/checkpoint evidence in the Recovery Centre;
4. select **External backup** as the recovery source;
5. supply the recovered entity snapshot;
6. preview;
7. raise the request;
8. obtain independent Admin approval;
9. execute through the canonical writer.

## Full disaster restore

A full restore is not executed against live production from the Admin page.

Required sequence:

1. register the source checkpoint;
2. Admin maker raises the full-restore request;
3. different Admin approves;
4. restore into a **new** database/branch;
5. migrate to the authorized release;
6. verify critical-state hash/lineage;
7. verify runtime database health;
8. pass Golden Order;
9. pass authenticated protected-route smoke;
10. record validation in the Recovery Centre;
11. perform the authorized infrastructure connectivity cutover;
12. record the cutover reference;
13. retain the damaged source for root-cause analysis.

The Recovery Centre refuses cutover-ready state unless all four required validation flags are true.

## Recovery objectives

- RPO target: **≤ 24 hours** once daily external dump rotation is operating.
- RTO target: **≤ 60 minutes** for a validated restore.
- Production in-place overwrite: **prohibited**.
- Recovery event deletion/update: **prohibited**.
- Maker self-approval: **prohibited**.
- Selective execution after intervening canonical change: **prohibited**.

## Files

- `migrations/0089_admin_recovery_centre.sql`
- `src/lib/recovery-control.ts`
- `src/routes/command/recovery.tsx`
- `scripts/admin-recovery-control.test.mjs`
- `scripts/vyndi-zero-cost-backup.ps1`
- `scripts/vyndi-zero-cost-restore.ps1`
- `.github/workflows/admin-recovery-centre.yml`

