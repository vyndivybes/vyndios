import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("production optimizer injects governed cash headroom as a hard HiGHS capital envelope", async () => {
  const execution = await source("src/lib/advanced-optimizer-execution.ts");
  const adapter = await source("src/lib/advanced-planning-highs-adapter.ts");
  const hardCapital = await source("src/lib/advanced-planning-hard-capital.ts");

  assert.match(execution, /GOVERNED_HARD_CAPITAL_VERSION/);
  assert.match(execution, /hardCapitalEnvelope/);
  assert.match(execution, /prepared\.cashGuardrails\.map/);
  assert.match(execution, /fundingPlan:\s*prepared\.fundingPlan/);
  assert.match(adapter, /compileGovernedHardCapitalConstraints/);
  assert.match(adapter, /encodeAdvancedMathModelToCplexLp\(math, hardCapital\.constraints\)/);
  assert.match(hardCapital, /CAPITAL_CUMULATIVE/);
  assert.match(hardCapital, /Math\.max\(0, guardrail\.cumulativeHeadroomLakh\)/);
  assert.match(hardCapital, /paymentLagBySku/);
});

test("approved five-tranche ₹2 Cr plan remains the controlled funding ladder and standby stays separate", async () => {
  const company = await source("src/lib/data/company.ts");
  assert.match(company, /id:"T1",amount:15,month:1/);
  assert.match(company, /id:"T2",amount:35,month:3/);
  assert.match(company, /id:"T3",amount:35,month:6/);
  assert.match(company, /id:"T4",amount:50,month:10/);
  assert.match(company, /id:"T5",amount:65,month:14/);
  assert.match(company, /id:"STBY",amount:25,month:9/);
  assert.match(company, /MILESTONES=\["₹15 L","₹50 L","₹85 L","₹1\.35 Cr","₹2\.00 Cr"\]/);
});

test("optimizer preparation freezes governed funding cash flows instead of inventing capital", async () => {
  const preparation = await source("src/lib/advanced-optimizer-preparation.ts");
  assert.match(preparation, /row\.category === "funding"/);
  assert.match(preparation, /row\.direction === "inflow"/);
  assert.match(preparation, /approvedFundingPlanLakh/);
  assert.match(preparation, /forwardFundingPlanLakh/);
  assert.doesNotMatch(preparation, /\[15,\s*35,\s*35,\s*50,\s*65\]/);
});
