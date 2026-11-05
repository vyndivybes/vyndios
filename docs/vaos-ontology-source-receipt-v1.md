# P0.1 — Signed-source Ontology observation (bounded, read-only)

The signed VYNDI bridge returns a **single-statement** count + bounded row page for inventory and demand shortages. Every read includes the source scope, a content-addressed SHA-256 snapshot, query time, row count, and `hasMore`/`complete`. It also includes source job-card and line IDs for future entity-resolution review.

Important: `complete` means the exact scoped SQL statement returned all matching rows within the requested limit. It does **not** mean independent source reconciliation, CDC, durable hydration or business truth certification. `sourceRevisionAuthority=CONTENT_DIGEST_ONLY`; `asOfAuthority=EXTRACT_TIME_NOT_SOURCE_CHANGE_TIME`; `sourceCompletenessVerified=false`.

Zero shortages is a legitimate empty scoped observation; it is not authorization to create a PO. Queries execute read-only after existing P-256 verification and replay-denial. Existing `write-execute` restrictions remain unchanged.

Run: `node --experimental-strip-types --test scripts/vaos-ontology-source-receipt.test.mjs`.

Open gaps: independently verified DB revision/watermark, tenant-safe canonical IDs, durable VAOS storage, PO source read route, independently reconciled count/chain, signed production canary. None is automatically commissioned by this change.
