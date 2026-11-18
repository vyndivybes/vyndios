# P0.1 — Signed-source Ontology observation (bounded, read-only)

The signed VYNDI bridge returns a **single-statement** count + bounded row page for inventory and demand shortages. Every read includes the source scope, a content-addressed SHA-256 snapshot, query time, row count, and `hasMore`/`complete`. It also includes source job-card and line IDs for future entity-resolution review.

Important: `complete` means the exact scoped SQL statement returned all matching rows within the requested limit. It does **not** mean independent source reconciliation, CDC, durable hydration or business truth certification. `sourceRevisionAuthority=CONTENT_DIGEST_ONLY`; `asOfAuthority=EXTRACT_TIME_NOT_SOURCE_CHANGE_TIME`; `sourceCompletenessVerified=false`.

Zero shortages is a legitimate empty scoped observation; it is not authorization to create a PO. Queries execute read-only after existing P-256 verification and replay-denial. Existing `write-execute` restrictions remain unchanged.

Run: `node --experimental-strip-types --test scripts/vaos-ontology-source-receipt.test.mjs`.

Open gaps: independently verified DB revision/watermark, tenant-safe canonical IDs, durable VAOS storage, PO source read route, independently reconciled count/chain, signed production canary. None is automatically commissioned by this change.

## A01 independent read-path witness and status correction (18 November 2026)

VYNDI's `vyndi_purchase_orders_status_check` permits `part_received` but NOT `partially_received`. The signed PO source predicate is aligned to the canonical database-constrained status. The open-status receipt scope remains `vyndi_purchase_orders:open_status_v1`, preserving VAOS schema compatibility: the intended meaning is open operational POs, excluding fully received and cancelled orders. No mutation route is affected.

The script `scripts/vaos-a01-external-count-witness.sql` is a direct read-only aggregate witness for an **independently authorized database connection**. Use an independent source channel and compare its three counts against the bounded signed VYNDI bridge plus VAOS durable projection. Preserve the witness timestamp and source identifier in restricted founder evidence; never commit live values or rows into this public repository.

Count equality is a check on the scoped source population at separately observed times; it cannot establish a CDC watermark, signed authoritative change version, historical immutability, transaction-level coordination between systems or completeness of all enterprise business data. `sourceRevisionAuthority: CONTENT_DIGEST_ONLY` and `sourceCompletenessVerified: false` remain unchanged. A mismatch is a HOLD and must not authorize a purchase, invoice, production release or business write.

Focused regression: `node --experimental-strip-types --test scripts/vaos-ontology-source-receipt.test.mjs`.
