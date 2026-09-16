# VIBPE Co-Pilot Autonomous QA / Governed Correction Loop

Baseline: `262cac9ff5cfc37a8dd66a14b1b57fa3c3024ad8`

This control rebuilds the useful intent of closed PR #205 on the certified VYNDI baseline without rebasing or cherry-picking the stale branch wholesale.

## Objective

Continuously exercise VIBPE answers against a governed synthetic fixture and detect answer defects before merge. The QA layer evaluates:

1. correctness;
2. completeness;
3. provenance;
4. ledger-vs-plan semantics;
5. snapshot freshness;
6. repetition;
7. actionability.

The corpus contains two cases in each of eight packs:

- cash / ledger reconciliation;
- procurement recommendations;
- committed-demand feasibility;
- inventory;
- job-card / Traveller lineage;
- liquidity;
- funding;
- actual-vs-plan.

## Current architecture rule

The runner uses the current certified VIBPE routing stack:

1. current read-only live-specialist routing where the production architecture already owns that question class;
2. the real `runVibpeCopilot2()` path for governed planning / operational / knowledge fallback.

The obsolete `vibpe-qa-governed-queries.ts` layer from PR #205 is intentionally not restored.

## Autonomous boundary

The QA loop may:

- ask governed synthetic-fixture questions;
- assess answers;
- classify defect dimensions;
- propose a bounded correction scope;
- emit JSON and Markdown audit evidence.

It may not autonomously:

- write transaction business data;
- create, approve, issue or commit purchase orders;
- commit funding;
- make customer promises;
- release production;
- create or alter database migrations;
- modify non-VIBPE business-authority routes or transaction writers.

Any future `apply` callback that mutates a test fixture must be explicitly sandboxed and must pass `validateVibpeCorrectionProposal()`.

## Evidence

Each execution writes:

- `artifacts/vibpe-qa/vibpe-qa-<timestamp>.json`
- `artifacts/vibpe-qa/vibpe-qa-<timestamp>.md`

CI retains the audit package for 30 days and fails if either evidence format is missing.

## Merge gate

This work remains draft until all of the following are green against the current branch head:

- TypeScript typecheck;
- autonomous QA guard tests;
- 16-case governed-fixture QA;
- VIBPE regression suite;
- repository test suite;
- CodeQL / normal repository checks;
- subsequent Stage D / Golden Order / authenticated production-equivalent smoke before release.

A failing QA case is evidence of an unresolved answer-contract defect; it must not be bypassed by weakening transaction authority, truth classes, RBAC, finance/statutory controls, or release gates.
