# Conversational BI v1

## Acceptance contract

Create and revise dashboard definitions through bounded natural-language requests. Read real sources on demand, filter dates, switch charts/tables, inspect source definitions and SQL, save/reopen definitions, and copy links that retain existing reporting permissions. Never synthesize performance data or execute user/model SQL.

## Architecture and business truth

- Production source repository: `vyndivybes/vaos`. Existing `wrangler.jsonc` deploys Worker `vaos` through Cloudflare Workers Builds, with the `VYNDI` service binding to Worker `vyndios`.
- Existing Supabase project `jjzycduoujbmiegqfiud` owns VAOS workforce records in `vaos_private`. Departmental business ledgers remain in VYNDI's existing Hyperdrive-backed database. No business data is moved or duplicated.
- The studio is inside the existing Intelligence page, in a disclosure above existing reports. VYNDI integrates the same studio in Command Centre. Shared `bi-model.mjs`, `bi-studio.mjs`, and `bi-studio.css` must stay byte-identical across repositories.
- `bi-model.mjs` interprets a bounded catalog deterministically. No AI service, model credits, new subscriptions, arbitrary SQL, cron or paid chart dependency is required. Unsupported financial metrics are rejected.
- VYNDI keeps canonical finance, production, engineering/VEDM, procurement, CRM and people source ownership. CRM activity uses `vyndi_crm_activities`, not an invented sales proxy.
- VAOS uses the existing signed founder-only `/api/enterprise-bi` read bridge and the existing `/api/workforce-analytics` function. Agent closures require independent handoff evidence. All 16 existing workforce IDs are retained.

## Semantics

`REAL` means an observed source record aggregate, not independent certification of business origin or agent productivity. `EMPTY` means an observed zero. `UNAVAILABLE` means unknown, never zero. No performance demo is supplied. Unknown source origins and excluded training counts are visible in inspection.

Activity is the current row's first available source date, not immutable event history. Backlog is all-date current state and does not change with period selection. Department ledgers overlap, so no sum is labeled company output. Verified closures support rolling 7/30/90-day windows ending at the fresh workforce observation, not calendar-day midnight. Reporting-day defaults use Asia/Kolkata; ledger date fields retain their recorded meaning.

## Security and persistence

`/api/dashboards` verifies the existing founder session. POST additionally requires same origin, JSON, bounded payloads and catalog validation. The new `vaos-control` operation calls a server-key-verified founder RPC. Definitions live in `vaos_private.dashboard_definitions`; browser roles receive neither table access nor RPC execution. No source results, tokens or executable SQL are stored. Revision checks prevent lost updates.

VAOS's existing founder-only permission means the authorized audience is currently the founder. Copying a URL does not grant the checker access. VYNDI authorized sharing rechecks the recipient's current role against every source route, including on saved-report opening. Only the owner can update a definition. Role revocation takes effect on the next read. The studio never provisions accounts or broadens role permissions.

## Verification and release

Run `npm run test:bi`, the existing web verification and lint checks, and `npx wrangler deploy --dry-run`. PostgreSQL tests exercise actual persistence, stale revisions, invalid server keys, founder restrictions and browser-role denial. The local acceptance harness uses empty test ledgers and has no production credentials.

Release is coordinated: qualify VYNDI's source changes and its metadata migration, apply the VAOS metadata migration, deploy the updated `vaos-control` function, deploy the two Workers through their existing build authority, then test authenticated production creation/editing/save/reopen and RBAC denial. Do not advertise the feature as production verified before those checks.

Cloudflare production connector reauthentication was required during inspection on 17 October 2026. The secondary connection does not contain these Workers. No production schema, function or Worker was changed during local qualification. Quota and production lineage therefore remain unverified.
