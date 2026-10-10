# VYNDI OS platform assurance execution — 2026-10-10

## Authority and release lineage

Production baseline before this execution: `60f4886e3746dbc92842df49294fdc3bdd067484`.
Changes in this PR are infrastructure qualification only; no business-table migration, finance commitment, inventory issue, or engineering-release permission is included.

## P1 — Production authority

- GitHub `main` was observed without branch protection or rulesets. Connected GitHub App lacks repository administration scopes; applying the rule in-app has not been confirmed. **Required administrative setting:** require PRs, `focused-validation` passing, block force-pushes/deletion, preserve emergency authorized rollback. As a single-founder repository, do not mandate an unavailable second reviewer.
- Repository is public with proprietary `LICENSE`. No repository visibility change is authorized as part of this workflow patch. Confirm visibility and Cloudflare Git integration compatibility with the repository owner before considering a private switch.
- Neon project `damp-mountain-07086274`, branch `production` could not be protected: API returned HTTP 422, plan protected-branch quota reached. Do not bypass the plan or purchase upgrades without the owner's approval.
- Since the repository is public, production assurance uploads **only a non-sensitive exact-SHA health record**, never authenticated screenshots, business payloads or session captures.

## P2 — Independent production assurance

`.github/workflows/production-assurance.yml`:
- Automatically runs on pushes to `main`, remains manually dispatchable and scheduled.
- Runs on GitHub-hosted `ubuntu-latest` rather than a personal self-hosted machine.
- Executes pure fail-closed readiness and workflow-policy regression checks.
- Executes business-domain contracts, signed VAOS read bridge, engineering-release readiness and recovery integration tests.
- Waits a bounded interval for Cloudflare to actually serve the **exact** main SHA with DB/schema healthy and no pending migrations.
- Requires `VYNDI_TEST_EMAIL` / `VYNDI_TEST_PASSWORD` GitHub Action secrets for authenticated 19-route browser and UX checks; absence is an explicit unverified failure, not success.
- Does not upload privileged browser captures to public GitHub Actions artifacts.
- On failure, the operator must inspect the exact failing step. Do not blindly redeploy, auto-rollback due only to missing test credentials, or mask a failure.

## P3 — Isolated Neon production snapshot / recovery

Created and queried a fresh independent branch:
`platform-recovery-qualification-20261010` / `br-red-dust-aedktt4x`.
Parent production branch `br-weathered-base-aef23yeq`; parent snapshot at `2026-10-10T17:57:06Z`.

- 14 table counts matched the production branch, including 151 migration ledger entries, 48 purchase orders, 5 sales orders, 4 production job cards, 1 goods receipt, 1064 audit events, 57 optimizer runs, 93 IBPE runs and 275 inventory items.
- 11 critical tables' canonical whole-row MD5 aggregate signatures were independently calculated and matched across production and the clone.
- Branch is ready and contains production data. Restrict access; it is **not** a public test environment.
- This qualifies snapshot/clone fidelity only; it is not off-platform `pg_dump` restore proof, and no immutable independent backup or restore RPO/RTO was asserted.
- No production DB data was altered. Do not write synthetic test fixtures to production.

## P4 — Business journeys

Automated qualification groups now explicitly cover CRM, schedule policy/maker-checker, finance posting, procurement/MES, quality, signed bridge, engineering and recovery contracts. These are isolated tests, **not proof of live end-to-end writes**.

Required human business acceptance records, without fake sales or purchases:
1. CRM real customer / customer-linked sales order;
2. authorized PO approval and supplier evidence;
3. GRN / QA receiving / FIFO inventory;
4. job-card traveller / stage / quality inspection;
5. shipment / GST-compliant invoice / cash collection;
6. approved schedule-revision maker/checker;
7. approved product quality release following physical validation.

## P5 — External integration and engineering gates

- The VAOS-to-VYNDI signed read bridge is included in contract checks; a previous bounded canary write is already recorded, but no new live mutation is authorized.
- H5 native integration contracts remain **zero** in production. Do not create dummy providers or activate third-party adapters without verified free terms, credentials and independent read-only smoke.
- Product family ISO release gates (Longitude, Latitude, Altitude) remain blocked until approved ITPs, test evidence and required release approvals. No code should manufacture their clearance.

## Final promotion contract

`CODED → TESTED → BUILD_GREEN → MERGED → DEPLOYED → EXACT-SHA HEALTH → AUTHENTICATED SMOKE → BUSINESS UAT → RELEASE QUALIFIED`.

All stages are separate. Report the first blocked stage honestly. No general ERP or physical bicycle release is green merely because VIBPE mathematical optimizer passed.
