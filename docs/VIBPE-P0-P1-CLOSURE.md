# VIBPE P0 + P1 Closure

## Scope

This release closes the standalone VIBPE maturity gaps independently of VEDM repository integration. VEDM remains an evidence source; it is not the reasoning engine.

## P0 — reasoning and truth layer

| Requirement | Implementation |
| --- | --- |
| Evidence graph / claim ledger | `VibpeEvidenceClaim` and immutable `vyndi_vibpe_answer_receipts` payloads carry claim, source, revision, effective date, authority and support class. Existing VIBPE authority/assurance registries remain the governed evidence graph. |
| Structured reasoning contract | `vibpe-reasoning-core.ts` defines answer receipts, contradictions, calculations, source state and five-dimension verification. |
| Five dimensions | Every persisted top-level answer receipt records mathematical, theoretical, physical, practical and scientific status/basis. |
| No silent fallback | VIBPE 2 and the outer IBPE Co-Pilot expose unavailable decision-context, governance, operational, truth-contract, knowledge, external-AI and receipt services as degraded source states. |
| Persistent context | Migration 0099 and `vibpe-persistence.ts` persist VIBPE session/decision state outside process-local memory. The Map remains cache only. |
| Benchmark/calibration | Existing governed QA corpus, optimizer benchmark/backtest and enterprise coverage gates remain active; `vyndi_vibpe_answer_quality_events` adds human correction/outcome calibration telemetry. |

## P1 — finite planning and decision intelligence

The P1 execution model already exists in the Advanced Planning stack and is retained as the single authority rather than duplicated:

- machine, labour, work-centre and tool capacity — `advanced-planning-constraints.ts`;
- operation routing, predecessor sequence, run/setup hours and yield — `advanced-planning-constraints.ts`;
- supplier lanes, approval state, capacity, alternate rank, MOQ, order multiple, lead time, reliability and landed cost — `advanced-planning-constraints.ts`;
- material positions, safety stock, committed receipts, BOM quantity and scrap — `advanced-planning-constraints.ts`;
- prioritised committed/forecast demand and service penalties — governed objective weights;
- deterministic finite feasibility and constrained CTP — `deterministic-feasibility.ts`, `constrained-capable-to-promise.ts`;
- governed LP/MILP optimisation with HiGHS and explicit binding constraints — `advanced-planning-optimizer.ts`, `advanced-planning-highs-adapter.ts`;
- immutable decision packet and VIBPE evidence projection — `advanced-planning-decision-packet.ts`, `advanced-planning-vibpe-evidence.ts`;
- optimizer plan-vs-actual error/bias backtesting — `advanced-optimizer-backtest.ts`;
- sensitivity ranking and binding-constraint explanation primitives — `vibpe-reasoning-core.ts`;
- answer-quality telemetry and later confidence calibration — migration 0099.

## Authority boundary

VIBPE remains advisory. None of these changes grants authority to create/approve purchase orders, production releases, finance postings, inventory movements, funding commitments, customer promises or approved-plan changes.

## Release gate

The feature is mergeable only after:

1. migration syntax validation;
2. new reasoning-core tests;
3. new persistence tests;
4. existing VIBPE QA regression;
5. advanced-planning/optimizer tests;
6. typecheck/build;
7. repository-required CI checks.

