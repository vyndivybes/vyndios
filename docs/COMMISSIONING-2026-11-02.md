# Commissioning and staged credential remediation, 2026-11-02

## Observed baseline, before PR #105

Main and Cloudflare source binding: 732e822c776de9c2a0aa2efbd1748db80c906824.
Cloudflare version: 3f6dc06c-bba9-414c-9954-ff056cd92c3a, 100% traffic.
Production Assurance run 41396195492 reported success.
The signed-in simulation screen contains 4 accepted demo orders, 1 virtual R3
successor, 0 simulation mismatches, 34 IBPE material rows, engine VYNDI-IBPE-1.3.0.
That baseline does not invoke HiGHS.

Read-only Neon audit confirms the four source cards remain unchanged:
three released without approved_by/approved_at; one held R2 card for an R3 order.
Latest completed IBPE and advanced packet use source
5b4a0b1b3eccee8841989e2648cb200d6696a9ac from 2026-10-11.
An old packet is historical evidence, not authority for current software.

## Simulation boundary

The new scoped MILP uses only the exact four accepted IDs, active approved
planning BOMs and approved capacity standards. Every work centre constrains
every bicycle using its planning hours per unit. Whole orders are assigned
one month from their requested month through month 36. No order splitting or
early production. Objective is weighted unit-month lateness, weights 1000+i
in stable order-ID order. Virtual unlimited zero-lead supply equals the BOM
requirements in that scheduled month. This is deliberately an optimistic
material-availability scenario, not supplier feasibility or cash optimization.

A short-lived browser Web Worker loads the existing pinned HiGHS 1.15.3 package.
This uses the established browser offload architecture and requires no PC
installation, local service, paid API, external solver service or new resource.
Preparation and validation use authenticated POST server functions and explicit
SIMULATION_ONLY consent. Fresh server inputs and deployed source SHA are hashed.
Validation re-reads those inputs, rejects drift, and independently checks every
expected column, bounds, integrality, assignments, per-work-centre capacity,
material balance and objective. HiGHS reports optimality; server validation
proves primal feasibility only. Receipts are memory-only and are never inserted
into governed IBPE/optimizer, stock, PO, finance, manufacturing or audit tables.

## Runtime credential finding: HOLD

Hyperdrive 5111123a562d469b9a812f8378c1862e connects as hyperdrive-user.
Read-only pg_roles audit confirms INHERIT, CREATEROLE, CREATEDB, BYPASSRLS and
effective neon_superuser membership. PostgreSQL rolsuper=false does not make
this a least-privilege runtime role. Hyperdrive query caching is enabled.
PR #102 must remain draft and unmerged; no retirement workflow activation.

## Staged remediation, prepared but NOT executed

1. Inventory table ownership, grants, default privileges, SECURITY DEFINER
   functions, search_path and all runtime writes, including authentication.
   Separate migration/owner credentials from runtime credentials. Do not
   blindly revoke the current role before these dependencies are known.
2. Rehearse a distinct ordinary LOGIN runtime role in isolated synthetic full
   PostgreSQL: NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS,
   no neon_superuser membership and no ownership of business tables/functions.
   Grant CONNECT, schema USAGE and explicitly reviewed table/sequence/function
   rights only. Avoid blanket ALL and PUBLIC function-execution grants.
3. Rehearse unauthenticated, viewer, maker/checker and admin paths; verify
   append-only audit and statutory history protections, migration denial,
   forbidden DELETE/TRUNCATE denial, RLS and SECURITY DEFINER search paths.
   Schema initialization must remain outside runtime request handling.
4. Use an existing isolated synthetic environment within confirmed free quotas.
   Production already has 10 branches including 9 archived recovery branches.
   Do not delete backups, wake archived recovery branches, allocate paid
   resources or clone sensitive actuals into a broadly accessible environment.
5. After successful rehearsals, owner-controlled secret provisioning and a
   staged Hyperdrive/DATABASE_URL switch must preserve rollback to the
   previous deployed version and credential. Never print passwords or embed
   them in repository, logs or receipts. Validate both binding paths before
   retiring the old credential; no credential rotation is performed here.
6. Segregate demo records through a reviewed additive classification/projection,
   exact source fingerprints and independent maker/checker approval. Preserve
   original transaction, inventory, COGS, finance, PO, serial and audit history.
   Rehearse reversibility before any production activation of PR #102.
7. Resolve real ECN, current-revision job-card and physical approval evidence
   through the existing authorized workflows. Never auto-approve manufacturing
   to satisfy a software readiness check.

## Verification discipline

Test-first missing-module failure is recorded in Development CI run 41398999854
on c7f56eb7d7d0c768aae343a017081f7820010028.
Implementation, full CI, bundle, merge, deployment and live acceptance are
separate evidence boundaries. This document does not declare them successful.
No production records, credentials, recovery branches or plan tiers were changed
as part of the baseline read-only audit.
