# A01 P0 candidate: transactional source revision witness

**State: isolated qualification only — NOT a certified source-of-record.**
Owner tracking: [VYNDI OS #140](https://github.com/vyndivybes/vyndios/issues/140).
VAOS mission tracking: [VAOS #312](https://github.com/vyndivybes/vaos/issues/312).

## Problem and source dependency

The current signed bridge uses bounded count+page SQL reads and content digests.
Those digests detect changed returned content, but do not prove all source
changes, transaction commit order, completeness across pages, or historical
provenance. The pre-existing books-audit trigger misses job-card lines and
inventory reservations. The integration outbox is not a substitute for a
committed source revision.

The prospective source universe comprises seven relations:

| Read scope | Underlying source tables |
| --- | --- |
| Inventory | `epr_inventory_ledger`, `epr_inventory_cost_ledger` |
| Scoped shortages | Both ledgers plus `epr_inventory_reservations`, `epr_production_job_card_lines`, `epr_production_job_cards` |
| Open POs / joined demand lineage | `vyndi_purchase_orders`, `epr_production_job_cards`, `vyndi_sales_orders` |

## Migration candidate: 0196

`migrations/0196_vaos_source_revision_witness.sql` creates a **private**
`vyndi_vaos_authority.source_revision` singleton with generation UUID,
non-negative `revision`, and baseline seed time. An UPDATE of that row in
each AFTER STATEMENT DML/TRUNCATE trigger acquires a row lock and advances
the counter **inside the same PostgreSQL transaction as the source
mutation**. An aborted source transaction rolls back the counter too. Row-lock
serialization imposes an ordering on committed source changes (with multiple
increments permitted in one transaction). Unlike `nextval`, this is not an
out-of-transaction sequence; unlike timestamps/LSNs and content hashes, the
witness is transaction-coupled to instrumented writes.

The triggers are ENABLE ALWAYS on all seven source tables; installation
fails if one relation is missing. The private function uses a schema-qualified
UPDATE and fixed search_path, has no direct public EXECUTE grant, and changes
**metadata only**. An existing server-side `hyperdrive-user` role receives
only SELECT on the private witness via RLS. No browser, anonymous, or
authenticated-user grant is introduced, and no existing business row is
rewritten.

Generation `revision=0` is **an initial install baseline**, not a history
reconstruction, independent transaction log, or certification of preexisting
rows. Restoring or recreating the database creates an independently
distinguishable generation; it must not be merged blindly with the prior
ledger's history.

## Operational and qualification holds

This is a **candidate design**. Do not release the new migration to the
production database until these checks independently PASS:

1. **Source discovery:** independently enumerate view dependencies and all
   writer paths, including trigger side effects and functions; prove that
   no alternate write path, import, replication role, or trigger-disable
   pathway can bypass any required revision increment.
2. **Isolated rollback and concurrency:** exercise two separately connected
   Postgres writers, conflicting transaction commit order, rollback,
   changes during keyset pagination, and direct-tenant denial. A PGlite
   unit test alone is insufficient for multi-session certification.
3. **Performance and recovery:** test expected and burst DML concurrency,
   row-lock wait times, deadlock/timeout behavior, restoration and replay
   fence, database backup consistency, and system health under realistic
   source writes. Revert/disable only as a governed schema release with
   explicit read-side HOLD; never silently stop revision tracking.
4. **Canonical read-side contract:** bind `generation_id`, `revision`,
   source scope and canonical IDs to each one-statement count+page read;
   implement deterministic keyset pages with same-generation/version
   verification, and reject gaps, duplication, mutation drift or
   incomplete pages. A separate VAOS-side checker must independently
   verify all pages and total count in the selected scope.
5. **Signed and independently reviewed provenance:** bind digest,
   version, scope, nonce, DB generation, source code SHA and trusted actor
   to P-256 source attestation; validate nonce/replay, tenant scope and
   negative cases at VAOS. An approved source baseline, independent
   maker/checker and staged no-charge shadow canary are required.

**Fail-closed defaults remain:** `SOURCE_UNVERIFIED`,
`sourceRevisionAuthority=CONTENT_DIGEST_ONLY`,
`sourceCompletenessVerified=false`, action authorization denied.
This migration alone must never change these flags, approve purchasing,
move stock, post finance entries, release engineering or promote an agent.

## Tests and rollout

Isolated deterministic test:
`node --test scripts/vaos-source-revision-witness.test.mjs`

A01 scoped CI also runs the existing signed-source tests; Development CI
runs isolated database tests, full migrations from empty, regression suite,
typecheck and bundle. No production credentials or live business data are
needed to qualify this code-level foundation.

**Release decision for this branch:** keep draft/HOLD until genuinely
independent database concurrency and scope testing plus reviewed migration
impact. Only after the production release is explicitly authorized and
verified should the signed bridge be changed to consume this witness.
