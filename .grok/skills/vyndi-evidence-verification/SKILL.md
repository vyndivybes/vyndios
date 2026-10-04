---
name: vyndi-evidence-verification
description: Enforce evidence-backed completion, CI, build, smoke, merge, deployment, and production-status reporting for all VYNDI engineering work. Use before making any claim that work is done, fixed, passed, green, ready, merged, deployed, live, or production-verified.
---

# VYNDI Evidence Verification

This skill exists to prevent optimistic status reporting from outrunning the evidence.

Use it for every VYNDI implementation, bug fix, PR, CI result, deployment, browser smoke, release, and production-status report.

## Core rule

**State is evidence, not intention.**

Never promote work because code exists, a command was requested, a workflow was triggered, a PR was opened, a build was queued, or a prior commit was green.

Evidence must belong to the **exact artifact lineage** being reported: commit SHA, PR head SHA, merge SHA, deployment version, or production revision.

## Allowed lifecycle states

Use these exact states when reporting engineering status.

| State | Minimum evidence required |
|---|---|
| `CODED` | Source change exists at an identified branch/commit SHA. |
| `TESTED` | Required named tests actually executed successfully against that exact code lineage. A queued, skipped, cancelled, or zero-step job does not qualify. |
| `BUILD_GREEN` | The required production build actually executed successfully for that exact lineage. Typecheck/test success alone is not a build. |
| `SMOKE_GREEN` | Required browser/Playwright smoke actually executed successfully against the intended built/deployed artifact, with no blocking console/runtime/navigation failures. |
| `MERGED` | Repository confirms the PR merged and provides the merge commit SHA. An open or closed-unmerged PR is not merged. |
| `DEPLOYED` | Deployment authority confirms a deployed version/revision tied to the merged source lineage. A successful build is not deployment. |
| `PRODUCTION_VERIFIED` | The live production surface was exercised after deployment and the required user journey(s) passed against the deployed revision. |
| `FAILED` | A required verification step actually ran and failed. State the exact failing stage and evidence. |
| `UNVERIFIED` | The required verification did not run, evidence is unavailable, lineage is ambiguous, or infrastructure failed before the check executed. |

A feature may be `CODED` while its release qualification is `UNVERIFIED`. Report both when useful; never collapse them into “done”.

## Promotion rules

Promote only one evidence boundary at a time.

`CODED → TESTED → BUILD_GREEN → SMOKE_GREEN → MERGED → DEPLOYED → PRODUCTION_VERIFIED`

A later state can be claimed only when its own evidence exists and all required predecessor gates for the requested outcome are satisfied.

Do not infer a later state from an earlier one:

- tests passing ≠ build green
- build green ≠ smoke green
- smoke green ≠ merged
- merged ≠ deployed
- deployed ≠ production verified
- “workflow started” ≠ tested
- “build queued” ≠ build green
- “PR exists” ≠ implemented safely
- “Cloudflare comment exists” ≠ deployment success

## Language gate

Do not say **done**, **fixed**, **passed**, **green**, **ready**, **working**, **merged**, **deployed**, **live**, **released**, or **production verified** unless the evidence required by this skill exists for the exact lineage being described.

Specific minimums:

- **“fixed”**: reproduction/regression test or equivalent verification has passed. If the defect was production-only, production verification is required before saying the production issue is fixed.
- **“passed” / “green”**: the named gate actually executed and returned success.
- **“ready to merge”**: all required pre-merge gates for that PR are successful on the current head SHA.
- **“merged”**: repository merge state and merge SHA are confirmed.
- **“deployed” / “live”**: deployment authority confirms the deployed revision.
- **“done”**: the user-requested terminal outcome has reached its terminal evidence state. For a live product change, default terminal state is `PRODUCTION_VERIFIED`.

If evidence is incomplete, say `UNVERIFIED` and name the missing evidence. Do not soften it with optimistic prose.

## Infrastructure failures

A job that fails before its verification steps execute is **not evidence that the application failed**.

Examples:
- zero-step GitHub Actions job
- runner quota/account failure
- provider outage before checkout
- authentication failure before the intended test
- browser service unavailable before navigation

Report these as:

`UNVERIFIED — infrastructure blocker: <reason>`

Do not convert infrastructure failure into `FAILED` application code unless the required check actually ran and failed.

## Stacked PR rule

For stacked PRs, downstream qualification inherits the weakest unresolved upstream boundary.

If PR B is stacked on PR A:

- B may be `CODED`.
- B may have its own focused tests.
- B **cannot be called qualified, ready, passed, or green** while A has a required upstream `FAILED` or `UNVERIFIED` gate that B depends on.
- A downstream Cloudflare/CI failure that includes the upstream changes cannot be attributed to the downstream package without isolation evidence.
- Fix and qualify the **first blocking stage** before claiming downstream release readiness.

When several PRs are red, identify the earliest known regression boundary and isolate it.

## Evidence hierarchy

Prefer direct evidence in this order:

1. exact test/build/smoke result for the current SHA
2. repository/deployment platform state for the current SHA
3. exact logs showing the required step executed
4. deterministic local verification of the exact source lineage
5. static source inspection

Static inspection can establish `CODED`; it cannot establish `TESTED`, `BUILD_GREEN`, `SMOKE_GREEN`, `DEPLOYED`, or `PRODUCTION_VERIFIED`.

## First-blocker reporting

When qualification is not complete, report the **first blocking stage**, not the most impressive completed work.

Required form:

`<artifact> — <STATE> — first blocker: <stage> — evidence: <concrete result>`

Examples:

- `PR #331 — CODED / UNVERIFIED — first blocker: CI runner did not execute steps.`
- `PR #338 — CODED / UNVERIFIED — first blocker inherited from #331; downstream package not independently qualified.`
- `main@abc123 — DEPLOYED / UNVERIFIED — production smoke has not run yet.`

Do not bury a red or unverified gate beneath a list of completed features.

## Exact-lineage checks

Before any completion claim, answer all applicable questions:

1. What exact commit/PR/deployment revision am I reporting?
2. Did the required test run on that lineage?
3. Did the production build run on that lineage?
4. Did browser smoke run against that built/deployed artifact?
5. If stacked, are all upstream required gates qualified?
6. If merged, what is the merge SHA?
7. If deployed, what deployment/version is tied to that merge?
8. If production verified, what live journey was actually exercised?

If any required answer is unknown, the corresponding state is `UNVERIFIED`.

## Re-runs

A re-run promotes nothing by itself.

After a retry:
- verify that steps were actually allocated and executed;
- inspect the new result, not the old result;
- tie the result to the same current head SHA;
- if code changed after a passing result, the old result no longer qualifies the new SHA.

Do not repeatedly re-run an unchanged clean test merely for reassurance.

## Required closeout format

For substantial engineering work, final status should be compact and evidence-first:

| Artifact | State | Evidence | Blocker / next required gate |
|---|---|---|---|

Then state only one of:

- `Terminal outcome reached: <state>.`
- `Terminal outcome not reached. First blocker: <stage>.`

No resolution speech, promise, or motivational language substitutes for evidence.

## Authority boundary

This skill governs **reporting and release qualification**, not business/engineering approval authority.

It does not grant permission to:
- merge;
- deploy;
- alter production data;
- rotate secrets;
- approve engineering release;
- accept risk;
- commit funding.

Existing repository authorization rules remain in force.
