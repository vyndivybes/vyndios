# VYNDI Production Assurance — Auth session lookup failure (2026-11-15)

## Evidence and exact lineage

- Production Worker `vyndios` deployed version `c74c4439-9dc5-4c4c-8aa0-d03762ff5090`, 100% traffic, on 2026-11-06.
- Running source SHA `53332dcb701e8f257fa630fef11c5e4987a03a6c`.
- GitHub Production Assurance run `43691582317`, 2026-11-15, exited during **Independent four-department browser acceptance**.
- Reported failure: `/command/purchase-execution` returned HTTP 500.
- Cloudflare Workers Observability, UTC 2026-11-15 07:49:53: same request emitted
  - `[auth] Better Auth getSession failed`;
  - `session-lookup` operational failure;
  - `failureCategory: better-auth`, `errorName: Error`;
  - `sessionCookiePresent: true`, `bearerPresent: false`;
  - `databaseTransport: database-url`.
- Therefore the first **observed failure boundary** is authenticated session resolution, not a demonstrated purchasing SQL failure. Root exception cause is not available in sanitized telemetry. Do not claim the underlying exception is proven.

## Non-mutating database reconciliation

Read-only Neon catalog inspection verified that the canonical `user`, `session`, `account` and `verification` tables contain the expected Better Auth columns. Their runtime role has SELECT permission. The relevant purchasing tables and views also have the expected SQL columns and read permissions; five representative SELECTs completed under `hyperdrive-user`. These checks rule out obvious schema/permission errors for the inspected queries but do **not** prove successful deployed Better Auth session access via `DATABASE_URL`.

## Narrow remediation in this PR

The existing Better Auth HTTP route wraps `auth.handler()` inside `requestSafePostgresDialect.runInRequest()`; the SSR/server-function `auth.api.getSession()` path did not. This patch applies the same request-owned Postgres lifecycle to SSR session verification and leaves cookie validation, role assignment and deny-by-default authorization unchanged.

This is a candidate remediation of a plausible lifecycle defect, **not** a proven cure for the observed production 500 until the identical session journey passes in production.

## Verification and limits

- RED regression test was added before the implementation to require the SSR request-scoped lifecycle.
- The new `npm run test:auth:ssr-scope` participates in the normal `npm test` gate.
- Existing request-local Postgres driver tests exercise one connection per request and closure at request completion.
- Requires full TypeScript typecheck, repository tests, build, signed-in browser acceptance for `/command/purchase-execution`, exact deployed SHA, and post-deploy Cloudflare log verification. No real-world production check can be inferred from local or CI code tests.
- **Do not** change Cloudflare secrets, production database roles, stored business transactions or issue purchasing approvals as part of this patch.
