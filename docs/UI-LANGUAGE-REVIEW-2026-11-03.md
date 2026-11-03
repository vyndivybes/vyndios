# VYNDI UI language review

Reviewed against `f05eff3ecb6ca44bf7d36a83ee8f2d5c845e2819` on 3 November 2026.

All 108 route files and 46 shared UI components were read. 83 route files and 18 shared components have direct wording or presentation changes. Other files retain existing clear labels, technical reference text, compatibility redirects or shared-shell behavior. See [the full file inventory](ui-language-coverage-2026-11-03.json) for every file and its source blob.

The pass covers instructions, explanations, empty/loading states, sign-in wording, guided-work purposes, manual section summaries and public copy. Shared KPI and panel captions use normal casing and muted text. Each operating workspace retains its established names, controls and required technical terms.

Examples:

| Before | After |
| --- | --- |
| Authorize · Enter Command | Sign in to VYNDI OS |
| Clearance Granted | Signed in |
| Canonical SKU identity workflow | Create and approve item identities |
| We engineer symphonies of carbon and geometry | Explore the frame geometry, carbon construction and component choices |
| Protected fields are transaction truth | Instructions explain which records supply each value |

BOM, FIFO, GST, ITC, NCR/CAPA, ledger names, approval states, evidence references, monetary values and mathematical constraints retain their business meanings. Historical/source-owned records are not rewritten. Authentication behavior, calculations, transaction functions, routes and permissions are unchanged. Browser helpers follow the revised visible sign-in labels.

The review includes UI-owned guidance in `src/lib/guided-work.ts` and descriptive product pitch strings in `src/lib/data/company.ts`. Prices, product IDs, schedules and engineering specifications are unchanged.

This inventory records source review. It does not certify that every protected page has passed live desktop/mobile acceptance. CI, build, deployment and live acceptance must be recorded separately for the final commit.
