# VYNDI OS Production Qualification — Rev 1

## Controlled baseline

Qualification baseline before this final acceptance PR:

`4366e8b61f5825aea3013b129780b8394d23ad83`

The final production acceptance must set `VYNDI_TEST_EXPECTED_SHA` to the exact merge/deployment SHA being certified. The browser gate verifies that SHA against `/api/runtime/release-marker`; a missing or different SHA fails closed.

## Qualified stages

- Stage 1 — build/code qualification: PASS.
- Stage 2 — migration, runtime reconciliation and Hyperdrive schema parity: PASS.
- Stage 3 — Golden Enterprise and protected-route browser qualification: PASS.
- Stage 4 — resilience, session/security, migration fail-closed and governed integration evidence: PASS.
- Stage 5 — isolated PostgreSQL H3: PASS at concurrency 5/10/20 with existing latency and throughput thresholds unchanged.
- Stage 5 — governed optimizer: PASS.
- Stage 5 — concurrent write/revision/audit invariants: PASS.

The H3 PostgreSQL qualification records connection establishment separately from steady-state timed phases. The qualification did not weaken the 1500 ms read P95, 3000 ms write P95 or 5000 ms hotspot P95 gates.

## Production operating envelope

Production sequential functional journeys and successful-request latency qualify. Sustained concurrent route sweeps on the current **Cloudflare Free** Worker have produced moving HTTP 503 / CPU-limit failures across computationally heavier routes. This is recorded as **PLATFORM-CONSTRAINED**, not converted into application PASS and not hidden by relaxed thresholds or fabricated retries.

Accordingly, the release classification is:

**FUNCTIONAL / DATABASE / GOVERNANCE: PASS**

**SUSTAINED PRODUCTION LOAD: PLATFORM-CONSTRAINED**

An unconditional sustained-load certification requires a deployment execution envelope that can pass the existing load gate without CPU-limit failures.

## Final acceptance command

The final acceptance runner is read-only against production and requires an exact expected SHA:

`npm.cmd run test:production:acceptance`

Required environment:

- `VYNDI_TEST_EMAIL`
- `VYNDI_TEST_PASSWORD`
- `VYNDI_TEST_EXPECTED_SHA`
- optional `VYNDI_TEST_BASE_URL` (defaults to the production Worker URL)

The runner forces `VYNDI_E2E_ALLOW_MUTATION=0` and executes, in order:

1. Golden Enterprise cross-workspace journey.
2. Exact-SHA protected-route production Playwright smoke.
3. Responsive production UX qualification across desktop 1440, desktop 1180, tablet 768 and mobile 390.

Any failed gate terminates acceptance with a non-zero exit.
