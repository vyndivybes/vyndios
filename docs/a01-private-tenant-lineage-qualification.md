# A01: Private tenant-ownership and business lineage (candidate only)

**Status: DESIGN / HOLD. Not a live tenant service, not authenticated
source-of-record authority, and not deployed to production or Stage9.**

## Why this work exists

An independent read-only Neon catalog audit identified two overlapping
internal `venture` inventory groups and no identifiable company/tenant/
organization/membership registry in the current production tables/views.
`venture` is not a verified legal company ID. The production Hyperdrive
runtime role carries `BYPASSRLS`; a signed VAOS service key is also not
a verifiable company member. A01 and business writes must remain HOLD.

## Private two-migration candidate

- **0210** creates private `vyndi_a01_tenant_candidate` identities,
  candidate memberships and owner-attribution labels with real PostgreSQL
  RLS enforced against separate, non-BYPASSRLS fixture roles. The tests
  prove two-company read separation, revocation, forged
  `app.tenant_id` rejection, pending attribution exclusion and no
  PUBLIC/runtime grant. The synthetic `approval_sha256` and
  `provenance_sha256` fields are **not independently attested signatures**.
- **0211** extends that same private schema with append-only membership
  event history, immutable maker/checker object-owner bindings and two
  `security_invoker` + `security_barrier` candidate views for existing
  business relational links. A reservation may obtain a
  `CANDIDATE_ONLY_UNVERIFIED` tenant label only when its reservation,
  job card, job line and sales-order bindings all match one tenant and
  its SKU/canonical unit and source revisions agree. Purchase orders
  require a matching PO→job→sales-order owner chain. Cross-company or
  missing bindings, missing PO job parent and incorrect revisions return
  `HOLD_OWNER_OR_PARENT_MISMATCH` and a NULL tenant label.

Neither migration changes existing public inventory balances, ATP,
procurement shortage views, sales orders, reservations, or permissions.
The new mapping tables have **no runtime grants** and **FORCE RLS**.
The private event history has a current-principal read policy but no
runtime SELECT grant; owner bindings have no permissive SELECT policy.
0201 tightens 0210's private source-attribution RLS: an approved base
membership also needs the latest append-only member event to be GRANT.
A REVOKE or absent member event denies visibility even if the older
mutable membership row remains approved. All candidate source flags are `false`,
including `source_authority_verified` and
`production_write_authorized`. The binding labels are not authentic
evidence of owner identity, even in a correctly linked parent chain.

## Isolated qualification

One disposable PostgreSQL 18 workflow uses **two distinct real database
roles** lacking BYPASSRLS. A second disposable PG18 workflow exercises
a *different* two-company fixture with overlapping SKU/unit against
reservation/job/line/sales-order and PO links. It rejects unbound,
cross-tenant, wrong-revision, deleted or forged lineage, and verifies
append-only history, grant→revoke state and no PUBLIC access. The
additional RED→GREEN negative control proves latest-event REVOKE denies
an otherwise still-approved source-ownership RLS read. It refuses
a non-loopback host and any database other than `a01_test`.

The earlier A01 [#145](https://github.com/vyndivybes/vyndios/pull/145)
remains separate: 0196 commit-ordered source revisions, 0197 per-venture
quantity/value and 0198 conservative ATP. These are not installed nor
promoted to production.

## Still mandatory before any A01 release

1. Independently validated legal-company namespace, IdP subject and
   invitation/revocation authority, with two-person reviewer audit.
2. Real immutable tenant IDs and foreign keys on every authorized
   source-of-record row and the job/line/reservation/PO relationship,
   with migration/backfill reconciliation and collision/HOLD reporting.
3. Dedicated least-privilege database runtime identity **without**
   `BYPASSRLS`, reviewed per-table RLS, negative unauthorized
   read/write tests, session impersonation and revocation proof.
4. Tenant/venture/warehouse/store-aware balance, reservations, ATP
   and shortage, signed committed revision witness, complete keyset
   pagination, and immutable receipts; prove no unrelated company data.
5. Independent production load, rollback, exact SHA and schema acceptance
   before releasing founder authority and any business write.

**No source authority can be inferred from a synthetic owner binding.**
If any required proof is absent, return HOLD, not an empty or optimistic
business balance.
