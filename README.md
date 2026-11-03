# VYNDI OS

VYNDI OS helps the Vāyú Shastr team plan work, manage orders, track materials and builds, and review finances. Each transaction stays linked to its source records and approvals.

## Find your workspace

Open [VYNDI OS](https://vyndios.vayushastr.workers.dev/command) and sign in with your assigned account.

| To work on | Open |
| --- | --- |
| Today's actions and order progress | Command Centre |
| Forecasts and the 36-month plan | Plan & Commercial |
| Product definitions and BOM revisions | Product & Engineering |
| Inventory, purchasing, receiving and builds | Supply & Operations |
| Staffing, office costs and assets | People & Office |
| Cash, invoices and accounting | Finance |
| Approvals, risk and audit records | Governance & Assurance |

Use the shared search to find an order, item, supplier or page. Search results follow your account permissions.

For the four demo orders, open the [simulation workspace](https://vyndios.vayushastr.workers.dev/command/ibpe-operating-workspace/simulation). Simulation results are for testing and planning. Physical production needs its own design and release approvals.

## Production-qualified baseline

Historical qualification reference:

`c341f627df69882536a7a4d848f8d27c63af4462`

The recorded checks for that commit were:
- Golden Enterprise: 10 governed stages
- Exact-SHA production smoke: 19 protected routes
- Responsive production UX: 56 route/viewport checks

These results apply to that commit. Check the current deployment and its verification results before treating a newer version as qualified.

## Control model

- Each person signs in with an assigned role that controls what they can view and change.
- Changes must come from an allowed request origin.
- Database constraints and controlled SQL functions enforce the business rules.
- Actions that require a maker and a separate checker retain those approval steps.
- IBPE, forecasts and other analytical tools provide advice. Your team still approves purchases, production releases, payments and other commitments.

## Release model

Building the app does not change the database schema. Follow the separate migration step when a release needs schema changes.

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

Automated checks show which behavior was tested at a specific commit. Financial, statutory, inventory and engineering controls still need their required independent reviews.

## Licensing

VYNDI OS is proprietary software of Vāyú Shastr Pvt Ltd. No public or open-source software licence is granted.

See [LICENSE](./LICENSE) for the proprietary software notice. Third-party components remain governed by their respective upstream licences and notices.

<!-- Cloudflare Git integration trigger: 2026-10-07 -->
