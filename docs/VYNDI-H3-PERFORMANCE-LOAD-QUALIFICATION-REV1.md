# VYNDI V1 H3 Performance & Load Qualification — Rev 1

**Parent baseline:** `27a4cf8e02c3d271f1a4cbf4baf87034f6726af4`

H3 establishes a reproducible **minimum qualified operating envelope**. CI results are not an assertion of the maximum production capacity of Cloudflare Workers, Hyperdrive, Neon/PostgreSQL, Vercel, Netlify or the end-user network.

## Qualification surfaces

1. **PostgreSQL read concurrency** — 5, 10 and 20 concurrent workers.
2. **Governed transaction writes** — unique Sales Orders at 5, 10 and 20 concurrent workers.
3. **Hot-row contention** — 12 overlapping revisions of one Sales Order, proving advisory-lock serialization, complete revision history and attributed audit lineage.
4. **Authenticated route concurrency** — concurrent GETs across release-critical protected routes after one governed login.
5. **VIBPE optimizer compute** — deterministic published HiGHS runtime benchmark under the existing 12-second hard execution ceiling.
6. Existing Stage D, H1 SLO, H2 Recovery, CI, VIBPE and CodeQL gates remain mandatory.

## CI qualification thresholds

These thresholds are deliberately below the system's theoretical infrastructure limits and are intended as fail-fast regression limits.

| Surface | CI minimum / limit |
| --- | --- |
| PostgreSQL read concurrency | qualify at 5 / 10 / 20 workers |
| PostgreSQL read p95 | <= 1.5 s |
| PostgreSQL read throughput | >= 10 ops/s |
| governed write concurrency | qualify at 5 / 10 / 20 workers |
| governed write p95 | <= 3 s |
| governed write throughput | >= 5 ops/s |
| hot-row concurrency | 12 overlapping revisions, zero lost revisions |
| hot-row p95 | <= 5 s |
| protected-route concurrent requests | 8 concurrent workers |
| protected-route error rate | 0% in qualification run |
| protected-route p95 | <= 8 s |
| protected-route p99 | <= 15 s |
| optimizer individual solve | < existing 12 s hard runtime ceiling |
| optimizer benchmark error rate | 0% |

## Saturation and safe degradation

- Pool concurrency is bounded; H3 must not respond to pressure by creating unbounded PostgreSQL connections.
- Timeouts/failures must surface as operational failures. They must never be converted into fabricated transaction success.
- Transaction writes remain governed by database constraints, advisory locks, revision history and audit attribution under contention.
- VIBPE optimizer remains advisory-only. Performance pressure cannot grant transaction authority or bypass the solver runtime ceiling.
- No automatic retry of a heavy optimizer request is introduced.
- H3 does not increase concurrency, pool or runtime limits merely to make a benchmark pass.

## Production-like qualification

Before materially increasing real user concurrency or declaring a higher production capacity:
1. run the same workload against the deployed Cloudflare/Hyperdrive/database topology;
2. capture H1 telemetry and provider-side CPU, memory, connection, query and error metrics;
3. identify the first saturation point;
4. set the supported operating envelope below that point with margin;
5. repeat after database topology, connection pooling, auth architecture or optimizer-runtime changes.

## Evidence

H3 stores metadata/metrics only under `.grok/evidence/h3-performance/`. No user credentials, business payloads or database dumps belong in the evidence artifact.
