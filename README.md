# VYNDI OS

VYNDI OS is the governed business operating system for Vāyú Shastr. It connects planning, commercial operations, engineering, procurement, inventory, production, quality, finance, governance and evidence without treating analytical output as authority.

## Production-qualified baseline

Known-good production baseline:

`c341f627df69882536a7a4d848f8d27c63af4462`

That baseline passed:
- Golden Enterprise: 10 governed stages
- Exact-SHA production smoke: 19 protected routes
- Responsive production UX: 56 route/viewport checks

A newer commit must be re-qualified before it replaces the baseline.

## Control model

- Authentication and assigned RBAC protect business reads and writes.
- Writes also enforce same-site request isolation.
- Database constraints and governed SQL functions remain canonical authority.
- Maker/checker and approval rules are enforced where the relevant business action occurs.
- Advisory engines such as IBPE, forecasting, Monte Carlo and decision intelligence do not authorize business commitments.

## Release model

Normal application build does **not** apply database migrations.

1. `npm ci`
2. `npm test`
3. `npm run typecheck`
4. `npm run build:bundle`
5. backup / migration evidence
6. `npm run release:migrate` with explicit production approval
7. deploy Cloudflare Worker
8. verify exact release-marker SHA
9. `npm run qualify:production`

Runtime database roles must not apply privileged DDL.

## Migration policy

Historical duplicate numeric migration prefixes are frozen for compatibility. New migrations must use an unused numeric prefix. `npm run db:validate` enforces this policy.

## Repository hygiene

Operational code lives under `src/`, migrations under `migrations/`, qualification under `scripts/`, and controlled supporting material under `docs/`.

Historical status artifacts are retained under `docs/archive/` rather than presented as current operating state.

## PWA install page

`scripts/install-page.html` is intentionally retained. It is consumed by `scripts/grok-pwa-plugin.mjs` to provide Add-to-Home-Screen guidance and is not a demo or showcase route.

## Assurance boundary

Internal automated qualification is evidence of tested behavior for a specific SHA. It is not a substitute for independent audit of financial, statutory, inventory or engineering-control logic.

## Licensing

VYNDI OS is proprietary software of Vāyú Shastr Pvt Ltd. No public or open-source software licence is granted.

See [LICENSE](./LICENSE) for the proprietary software notice. Third-party components remain governed by their respective upstream licences and notices.
