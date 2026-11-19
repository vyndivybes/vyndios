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
2. **Isolated rollback and concurrency:** real multi-session PostgreSQL 18
   source lock ordering, transaction rollback, lock timeout, consistent
   repeatable-read snapshot and forbidden-witness-role access now **PASS** in
   an isolated CI fixture. **Still HOLD** real source workload contention/SLO,
   tenant-scoped access, all-page keyset pagination and DB restore/replay.
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


## 19 November 2026 isolated PostgreSQL qualification

The *public-repository* A01 workflow now includes an isolated PostgreSQL 18
service with a dedicated `a01_test` database and test-only credentials.
The script refuses non-loopback hosts and every database name except
`a01_test`. No Neon branch, production business record, or company credential
is involved.

- **GREEN (11/11 tests)**: [PostgreSQL job 135427801137](https://github.com/vyndivybes/vyndios/actions/runs/44485495134/job/135427801137).
- **Prior RED (reproduced)**: [PostgreSQL job 135425852573](https://github.com/vyndivybes/vyndios/actions/runs/44484914345/job/135425852573) identified two false acceptances: same-name wrong-function trigger and inherited child source table.
- **Additional RED (reproduced)**: [PostgreSQL job 135427277351](https://github.com/vyndivybes/vyndios/actions/runs/44485339363/job/135427277351) identified an empty partitioned root that was incorrectly accepted.
- Real database coverage: statement-level ALWAYS DML/TRUNCATE hooks on seven tables, competing writers serialized until first writer commit/rollback, no orphaned aborted revision, fail-closed lock timeout, stable read-only REPEATABLE READ snapshot, and denial of private witness SELECT/UPDATE to a non-owner role.
- Hardened migration rejects inherited parents/children, partitioned roots even before the first child exists, and same-name trigger definitions whose handler or event bitmask is incorrect.
- Direct independent Neon catalog read **confirmed** all seven watched tables in production and stage9 were regular (`relkind='r'`), with zero inheritance parents or children. **No migration has been applied to either database**.

These checks establish a bounded local PostgreSQL behavioral foundation.
They do **not** certify external writer coverage, realistic high-throughput
latency, business tenant scope, signed provenance, historic transactions, or
end-to-end VAOS source-of-record authority. Source promotion remains HOLD.

## 19 November — observed cross-venture aggregation collision and isolated candidate

An **independent read-only production PostgreSQL audit** found two distinct
`venture` values in both inventory physical and cost ledgers, with one
overlapping SKU+canonical-unit. The existing legacy
`public.vyndi_inventory_balance` view groups by `sku,unit` alone (not
`venture`), while available-to-promise and job-card shortage views use
that global balance. This establishes cross-venture **calculation mixing**,
not proof that another customer accessed a tenant's data. It forbids
current A01 per-company inventory or shortage certification.

[Issue #153](https://github.com/vyndivybes/vyndios/issues/153) tracks the
full tenant-bound inventory, ATP, reservation, job-card and PO redesign.
Separate [PR #152](https://github.com/vyndivybes/vyndios/pull/152)
proposes an immediate fail-closed bridge guard: inventory and shortage
signed reads are held if the same source snapshot observes zero or more
than one ledger venture. It does not fix the underlying legacy view.

This draft adds `migrations/0197_vaos_venture_isolated_inventory_candidate.sql`:
a private, `security_invoker` view, grouping quantity and cost by
**(venture, SKU, canonical unit)** and joining on *all three keys*. It
does not modify any existing ERP view, introduce runtime grants, authorize
source reads, or certify shortage ATP or tenant membership. The
`hyperdrive-user` production role has `BYPASSRLS` and `REPLICATION`
privileges and watched source tables currently lack RLS policies; **do not
mistake security_invoker for an independent tenant protection layer**.

The isolated [PostgreSQL 18 per-venture qualification](https://github.com/vyndivybes/vyndios/actions/runs/44493496055/job/135454755903)
passed 4/4 tests: two ventures sharing the same SKU retained separate
quantity and cost, cost-only records in another venture could not
cross-join, and the private view withheld direct untrusted access. This
test uses only a disposable test DB, not enterprise data. Production
migration and A01 promotion are still HOLD pending app-role tenant scope,
full multi-page pagination, signed source revision validation and
reviewed rollout, without paid services or business writes.

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
