# VYNDI V1 H1 Observability & SLO Policy — Rev 1

**Baseline:** `ee47744b89b9f9aa16da0c110fc0cdfa8471c426`  
**Purpose:** operational reliability evidence only. Telemetry is not business truth and cannot write business transactions.

## Signals

VYNDI emits structured `vyndi.operational` events for:
- Better Auth endpoint success/failure, HTTP status and duration;
- server-side session lookup failures with credential-safe failure classification;
- VIBPE Co-Pilot query success/failure and duration;
- runtime health/database readiness;
- exact deployed source SHA when available.

No event may contain passwords, cookies, bearer tokens, question text, financial payloads, customer/supplier content, or transaction values.

`GET /api/runtime/health` is read-only. It returns only:
- runtime availability;
- deployed source SHA;
- database readiness;
- whether at least one governed IBPE run exists.

## Initial SLOs

These are initial operating thresholds for V1. Recalibrate after 14 days of representative production evidence; never relax a threshold to hide a defect.

| Service indicator | Window | Initial objective |
| --- | --- | --- |
| Runtime health / DB readiness | rolling 30 days | >= 99.9% successful probes |
| Auth endpoint availability | rolling 24 hours | >= 99.5% non-5xx/transport success |
| Auth endpoint latency | rolling 24 hours | p95 <= 1.5 s |
| Protected-route availability | rolling 24 hours | >= 99.5% successful authenticated renders |
| Protected-route latency | rolling 24 hours | p95 <= 4 s; p99 <= 8 s |
| VIBPE Co-Pilot request success | rolling 24 hours | >= 99.0% governed response success |
| VIBPE Co-Pilot latency | rolling 24 hours | p95 <= 12 s |
| Exact-SHA release certification | every release | 100% health + protected-route probe success and deployed SHA match |

## Alert policy

Operational alerts are separate from transactions and approvals:
- **Immediate:** runtime health returns 503; deployed SHA differs from certified SHA.
- **5-minute window:** protected-route or auth error rate exceeds 5%.
- **15-minute window:** protected-route p95 > 4 s, auth p95 > 1.5 s, or VIBPE p95 > 12 s.
- **Security/identity:** repeated session lookup failures or `postgres-transport` auth failures require investigation; never auto-modify users or sessions from telemetry.
- **Database/runtime:** repeated health failures are operational incidents; telemetry does not repair or mutate data.

## Evidence runner

Run:

`npm run observe:slo`

Required environment:
- `VYNDI_TEST_BASE_URL`
- `VYNDI_TEST_EMAIL`
- `VYNDI_TEST_PASSWORD`
- optional `VYNDI_TEST_EXPECTED_SHA`
- optional `VYNDI_SLO_SAMPLE_COUNT` (1–10, default 3)

The runner:
1. verifies the release marker;
2. verifies read-only DB health;
3. authenticates once;
4. samples the eight release-critical protected routes;
5. reports success/error rate, p50, p95, p99 and max latency;
6. writes `.grok/evidence/observability-slo-*/slo-report.json`.

Latency thresholds are evidence by default. Set `VYNDI_SLO_ENFORCE_LATENCY=1` only when the execution environment is representative enough to make latency a release gate.

## Governance boundaries

- Telemetry/logs are derived operational evidence, not canonical business records.
- No telemetry event may create orders, stock movements, journals, approvals, plans, actions, users, or engineering changes.
- No page polling is introduced by H1.
- Platform log retention and alert routing remain infrastructure configuration; this repository defines the event contract and thresholds.
- The existing Golden Order, CI, CodeQL, VIBPE and Stage D gates remain mandatory.
