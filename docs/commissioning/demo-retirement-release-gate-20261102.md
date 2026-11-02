# VYNDI OS — Demo retirement commissioning and release hold

**Status:** DRAFT / NO PRODUCTION WRITES. **Observed:** 2026-11-02. **Tracker:** #38. **PR:** #102.

## Verified source and state
- Production source SHA before this draft: `70d2048e03a3baf737cc66160c357a139a96977d`. The new additive `0196_demo_retirement_scope.sql` is not applied in production.
- Read-only Neon: 4 confirmed orders / 1 stale card, 0 recorded governed production changes and 0 released ECNs.
- Exact candidate: `SO-800d46b7-d354-4e80-a3a9-d6c2207be5bf` R3 and held `JBC-78205547-3651-4182-b589-cf917cccee46` R2; original traveller, received PO, consumed material and audit trail **must remain**.
- Candidate footprint: three order revisions, fourteen card lines, one reservation, one inventory movement, one inventory ledger entry, one GRN, one quality-evidence item, one COGS and one inventory-cost ledger entry.
- Posted historical demo activity: **₹1,500 COGS** and **−₹1,500 inventory cost delta**. No direct related sales/supplier invoices found for the candidate. These are *recorded* source values, not authorized accounting reversals.
- User has identified the displayed data as demo; PO audit provenance references `test RFQ`. Three other confirmed orders have not individually been classified as demo. Their released job cards still lack release approver and timestamp evidence.

## Explicit fail-closed constraints
1. Do **not** delete, truncate, alter status/revision, create replacement approvals, or auto-reverse any order, stock, GRN, COGS, purchase order, serial genealogy or audit source record.
2. Treat active classification only as a **prospective planning projection**. It is **not** a general correction to booked inventory balances, revenue, COGS, cash or tax. A clean consolidated balance sheet must not be asserted until those effects are separately qualified.
3. Never treat archived "execution-ready" HiGHS outputs as approval for an updated production baseline.
4. No unsigned request may impersonate an independent checker. `created_by` and `actor_user_id` strings in database fixtures are **not authenticated identities**. There is currently no production writer endpoint for this workflow; activation is not commissioned.
5. **Runtime security P0:** read-only Neon showed `hyperdrive-user` has `BYPASSRLS`, `CREATEDB`, `CREATEROLE` and `REPLICATION`; it is a member of `neon_superuser` with inherited membership. This means table-level `REVOKE` alone is **not** sufficient. Migration 0196 now halts before DDL when the runtime account remains elevated. No credential or role change may occur without an isolated rehearsal and rollback.
6. Neon free_v3 had **10/10** branch slots (9 archived recovery/history branches). Do not recycle or delete a recovery branch without independent offsite preservation and explicit approval, and do not start paid services.

## Controlled release path
- **P1 source map:** verify current row fingerprints, all FK/ledger links, impact on cost authority, open-PO, procurement, finance report, stock valuation and IBPE Operating Workspace. Keep original audit views unfiltered.
- **P2 security:** create and test an independently restricted runtime role in an isolated environment (no neon_superuser membership, bypass, createdb, createrole or replication), provide minimum actual grants, authenticated maker/checker UI/API, idempotent transaction keys, revocation and credential rollback.
- **P3 isolated PostgreSQL rehearsal:** current-HEAD production-consistent schema/data clone in no-cost disposable branch or an independently verified equivalent. Test 4 → 3 → 4 with full before/after SHA-256 manifest, no source edits, no supplier/finance/stock effects, safety hold on three unrelated cards, concurrent requests, replay and source drift. PGlite fixture tests do not substitute for this stage.
- **P4 independent reviews:** Engineering/QA, Stores and Finance sign off *classification* and the historical ₹1,500/−₹1,500 records as preserved synthetic evidence. A classification does not forge cancellation, payment, consumption reversal or a legally valid CA approval.
- **P5 controlled deployment:** review exact main/release SHAs; run syntax, full CI, migrated current-schema rehearsal and authenticated browser/denied-role tests; install additive migration only after role privilege gate passes. No activation by migration default. An authorized maker requests and independent checker approves exact IDs before an activation. Verify projections and retain append-only reversal event as compensating path.

## Verification queries (READ-ONLY only)
```sql
select count(*) from vyndi_sales_orders where status='confirmed';
select count(*) from _migrations where name='0196_demo_retirement_scope.sql';
select pg_has_role('hyperdrive-user','neon_superuser','member') as runtime_inherited_superuser;
select rolbypassrls,rolcreaterole,rolcreatedb,rolreplication
from pg_roles where rolname='hyperdrive-user';
```

**Current release judgement:** Safe to continue *review and isolated tests*, **not** safe to merge/deploy/activate. An orange optimizer warning remains justified until all applicable production readiness gates pass.
