# A01 venture-keyed inventory shadow — release HOLD

## Scope
This change adds a **private, opt-in, non-runtime** inventory accounting diagnostic.
It does **not** change VYNDI ERP views, signed VAOS routes, data, user roles,
permissions, or the fail-closed HTTP 409 cross-venture guard.

The legacy `vyndi_inventory_balance` aggregates by SKU and canonical unit,
without the `venture` key. Physical and cost ledgers can therefore mix amounts
from two distinct inventory venture categories sharing the same SKU.

The new internal SQL query:
- independently aggregates `epr_inventory_ledger` and
  `epr_inventory_cost_ledger` on `(venture,sku,canonical_unit)`;
- uses a **FULL OUTER JOIN** on all three keys, revealing cost-only,
  quantity-only, negative and invalid-identity exceptions;
- extracts one bounded page and its count within the same SQL statement;
- retains `HOLD` for every result and declares source revision, tenant
  identity, completeness, ATP and business-write authority **unverified**;
- refuses input fields `venture`, `tenantId` or `principal` because an
  arbitrary caller-selected scope is not enterprise tenant authorization.

## Independent production discovery (read only; 19 Nov 2026)
- 2 inventory venture identifiers; 1 shared SKU/unit collision across ventures.
- A venture-keyed shadow count yields 2 distinct balance rows.
- 0 cost-only rows, 0 quantity-only rows, 1 negative quantity group.
- 0 active reservations and 0 released/in-progress job cards at the inspected point.

This is accounting segregation evidence, **not** a legal company ownership
assertion. The two `venture` strings are internal categories, not an
authenticated legal tenant principal. Never use this query in an externally
accessible route before identity and lineage qualification.

## Non-goals and release criteria

Still HOLD: authoritative company/membership proof; per-venture reservations,
job-card lines, sales order and purchase-order owner lineage; least-privilege
non-BYPASSRLS runtime; committed source revisions and stable cursor paging;
independent readback and maker/checker acceptance. Draft #160 contains a
**separate, non-runtime** tenant identity/lineage fixture; draft #145 contains
a **separate, non-runtime** transaction generation fixture. Neither grants
real production identity nor may be merged as a shortcut.

The original 409 source-venture guard stays commissioned. No automatic retry
of historic failed jobs, no backfill, no cleanup of negative stock and no
business writes. The canonical source statuses remain SOURCE_UNVERIFIED.

## Qualification
The isolated PostgreSQL test proves same-SKU separation by venture,
canonical-unit normalization, negative balance, cost-only/quantity-only
detection, bounded partial page and invalid venture HOLD. Contract tests
reject request-selected tenant fields and any business-authority promotion.

Only after verified canonical tenant identity, authorized record lineage,
low-privilege DB role, stable committed source generation, and independent
maker/checker can the shadow become a governed read API. Do not infer those
approvals from a green CI workflow.
