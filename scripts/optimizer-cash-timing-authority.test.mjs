import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("optimizer preparation uses exact parent IBPE input for cash anchor and supplier payment timing", async () => {
  const authority = await source("src/lib/advanced-optimizer-authority.ts");
  const preparation = await source("src/lib/advanced-optimizer-preparation.ts");
  assert.match(authority, /snapshot_at::text,input_json,result_json/);
  assert.match(authority, /input:\s*parent\.input_json/);
  assert.match(preparation, /cashAnchorPeriod/);
  assert.match(preparation, /cashAnalysisStartPeriod/);
  assert.match(preparation, /paymentLagBySku/);
  assert.match(preparation, /compileCashGuardrailsFromIbpe\([\s\S]*cashTiming\.analysisStartPeriod/);
});

test("cash guardrails exclude anchored periods and time procurement using governed payment lag", async () => {
  const guardrails = await source("src/lib/advanced-planning-cash-guardrails.ts");
  assert.match(guardrails, /for \(let period = analysisStartPeriod; period <= horizonPeriods; period \+= 1\)/);
  assert.match(guardrails, /paymentLagBySku/);
  assert.match(guardrails, /contractualPaymentPeriod = decision\.orderPeriod \+ paymentLagPeriods/);
  assert.match(guardrails, /paymentPeriod = Math\.max\(analysisStartPeriod, contractualPaymentPeriod\)/);
  assert.match(guardrails, /deferredProcurementBeyondHorizonLakh/);
});

test("optimizer execution persists and applies the frozen cash timing controls", async () => {
  const execution = await source("src/lib/advanced-optimizer-execution.ts");
  const governance = await source("src/lib/advanced-planning-cash-governance.ts");
  assert.match(execution, /prepared\.cashTiming/);
  assert.match(execution, /cashTiming:\s*prepared\.cashTiming/);
  assert.match(governance, /VYNDI-ADVANCED-CASH-GOVERNANCE-0\.5/);
  assert.match(governance, /evaluateProcurementCashGuardrails\([\s\S]*paymentLagBySku: timing\.paymentLagBySku/);
});
