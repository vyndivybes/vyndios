# Finance F2 — Native TallyPrime Trial Balance Export (Read-Only)

## F1 release gate

F1 PR #88 at commit `a08a72438753ab1b3a602de764ef41bb62e7ee22` passed:
- **Finance F1 Tally CA Qualification**: GitHub run 41261448272 — success.
- **Development CI**: GitHub run 41261448311 — success (canonical regressions, strict TypeScript and Cloudflare production bundle).

This is **source qualification**, not actual CA acceptance or production accounting qualification. F1 remains unmerged unless separately approved.

## F2 implemented

`src/lib/finance/tally-native-xml-export.mjs` builds a **native, read-only** TallyPrime XML request for the built-in `Trial Balance` report. It uses:
- `TALLYREQUEST=Export`, `TYPE=Data`, `ID=Trial Balance`;
- mandatory exact company name in `SVCURRENTCOMPANY`;
- bounded, strictly validated start/end dates in `SVFROMDATE` and `SVTODATE`;
- XML escaping and explicit `SVEXPORTFORMAT=$$SysName:XML`;
- `EXPLODEFLAG=Yes` for detail.

No HTTP request, Tally writeback, journal posting or statutory filing is performed. This does **not** parse Tally XML replies or prove the report amounts reconcile. Focused test: `node --test scripts/tally-native-xml-export.test.mjs`.

## Required before connecting actual TallyPrime

1. Confirm the intended TallyPrime company name and reporting period; use test-company data for integration first.
2. Read-only connectivity must originate from a controlled authenticated connector. TallyPrime's typical HTTP service may listen on port 9000 on an operator network; **never expose that service publicly or assume Cloudflare can access localhost**.
3. Allowlist trusted destinations and credentials, require HTTPS for remote gateways, reject redirects and responses above a configured size; retain strictly read-only operations.
4. Validate XML responses with a hardened XML parser (reject DTD/entity expansion) and check Tally status and error messages before normalization.
5. Compare actual source/export period and account mapping against independent VYNDI accounting records and preserve provenance, hash, audit actor and timestamps.
6. Require human review of exceptions and CA-approved evidence; no automatic certification.

Tally documentation:
- https://help.tallysolutions.com/building-tunnel-based-connectivity-for-tallyprime-integrations/
- https://help.tallysolutions.com/xml-integration/
