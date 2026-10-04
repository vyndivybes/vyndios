# VIBPE Co-Pilot reliability qualification

This change implements the agreed first improvement package: answer qualification,
analytical routing, evidence assessment and conversation continuity, with source
resilience required for release. It uses existing authorities and adds no paid API,
new transaction authority or database migration.

## Changed behavior

- Scenario follow-ups apply only explicitly changed assumptions. Product, cost,
  capacity, lead time and funding context survive subsequent questions.
- Funding delays require a known amount and arrival month. Out-of-range inputs
  are withheld rather than silently changed by scenario sanitization.
- Explicit UI scenario changes take precedence; an unchanged UI selection does
  not erase a subsequent conversational adjustment.
- Saved context is scoped by owner and session. A changed governed baseline
  invalidates implicit reuse, and failed writes do not poison the warm cache.
- Scenario and horizon requests bypass exact-ledger handlers. Comparison uses
  the scenario engine and checks the baseline lineage.
- Optimizer questions retrieve existing validated solver evidence for the latest
  governed IBPE baseline. Chat does not execute HiGHS or approve transactions.
- Monte Carlo answers disclose that they describe saved simulations, surface
  retained limitations and point to controlled input review.
- Answer receipts retain the actual snapshot capture time. Fixed confidence
  values are replaced with an explicit evidence-coverage checklist: source,
  lineage, availability, authority, freshness and demonstrated method.
- The legacy numeric `confidence` field remains for compatibility, but new
  receipts identify it as `evidence-coverage-not-probability`. It is not calibrated
  answer accuracy. The 24-hour freshness threshold is an advisory policy.
- Failed source, baseline or audit operations do not become generic success.
  Failed receipt persistence returns no receipt ID and discloses the failure.

## Verification

Run:

```sh
node --test scripts/vibpe-reliability.test.mjs scripts/vibpe-copilot-2-intent.test.mjs src/lib/vibpe-reasoning-core.test.ts src/lib/vibpe-persistence.test.ts
```

The new behavioral suite executes production parser, context resolver, session
persistence, scenario transformation, orchestration and server-handler code.
Database and external services use explicit fixtures. It checks numerical input
transformation, intent routing, repeated follow-ups, owner isolation, RBAC before
data access, missing/stale evidence and audit/receipt failures. It is included in
`npm test`; existing suites remain enabled.

These fixture tests do not establish production database health, independently
revalidate the numerical solver, or certify complete application behavior.
Required release gates remain full tests, application typecheck/build and live
authenticated acceptance on the deployed revision.

## Production acceptance

1. Ask for a product-specific demand scenario and a funding injection with an
   explicit month; delay that funding and compare again. Verify unchanged inputs,
   scenario deltas, lineage and persisted receipt.
2. Change the UI scenario, then issue two follow-ups. The second must retain the
   first adjustment. A new governed baseline must not silently reuse old context.
3. Ask for HiGHS status and Monte Carlo percentiles. Verify exact captured records,
   method limitations and no implied new execution.
4. Use a restricted account and confirm it cannot read protected records. In an
   isolated qualification environment exercise unavailable sources and receipt/
   audit failures; do not intentionally interrupt production data services.

## Remaining maturity work

Broad multi-domain production benchmarks, empirically calibrated confidence,
comprehensive cross-source contradiction detection, governed transaction-draft
handoffs and an operator correction/outcome feedback workflow remain separate
work. Existing forecast-learning metrics are not model self-training.
