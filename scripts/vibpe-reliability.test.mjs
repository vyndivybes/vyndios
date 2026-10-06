import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";

// Execute production TypeScript; only external services are replaced by explicit fixtures.
const url = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
async function sourceModule(path, replacements = {}) {
  let source = stripTypeScriptTypes(await readFile(new URL(`../${path}`, import.meta.url), "utf8"));
  for (const [specifier, replacement] of Object.entries(replacements)) source = source.replaceAll(JSON.stringify(specifier), JSON.stringify(replacement));
  return url(source);
}
const intentUrl = await sourceModule("src/lib/vibpe-intent.ts");
const contextUrl = await sourceModule("src/lib/vibpe-scenario-context.ts");
const qualityUrl = await sourceModule("src/lib/vibpe-answer-quality.ts");
const coreUrl = await sourceModule("src/lib/vibpe-reasoning-core.ts");
const persistenceUrl = await sourceModule("src/lib/vibpe-persistence.ts");
const sessionUrl = await sourceModule("src/lib/vibpe-session.ts", { "@/lib/vibpe-persistence": persistenceUrl });
const { parseVibpeIntent, isVibpeContextualRequest } = await import(intentUrl);
const { resolveVibpeScenarioContext } = await import(contextUrl);
const { assessVibpeEvidenceQuality, requiredVibpeMethod, describeVibpeMethod } = await import(qualityUrl);
const { hydrateVibpeSession, updatePersistedVibpeSession } = await import(sessionUrl);

const baseScenario = { id: "existing", label: "Existing", demandMultiplier: 1, demandMultiplierByProduct: { premiumCarbon: 1.2 }, capacityMultiplier: 1.3, procurementCostMultiplier: 1.1, leadTimeMultiplier: 1.4, receiptDelayMonths: 1, cashInjectionLakh: 50, cashInjectionPeriod: 4 };

for (const [question, method] of [
  ["Show the Monte Carlo schedule", "monte-carlo"],
  ["Explain probabilistic schedule uncertainty", "monte-carlo"],
  ["Explain HiGHS binding constraints", "highs-optimisation"],
  ["What if funding is delayed 2 months?", "scenario"],
  ["Show the approved ECO revision", "record-retrieval"],
  ["What is our funding requirement?", "planning"],
]) test(`analytical routing: ${question}`, () => assert.equal(requiredVibpeMethod(question), method));

test("funding follow-up preserves product, cost, capacity and lead-time assumptions", () => {
  const parsed = parseVibpeIntent("What if funding arrives 2 months late?");
  const { scenario } = resolveVibpeScenarioContext(parsed, baseScenario);
  assert.equal(scenario.cashInjectionPeriod, 6);
  assert.equal(scenario.cashInjectionLakh, 50);
  for (const key of ["demandMultiplierByProduct", "capacityMultiplier", "procurementCostMultiplier", "leadTimeMultiplier", "receiptDelayMonths"]) assert.deepEqual(scenario[key], baseScenario[key]);
  assert.equal(baseScenario.cashInjectionPeriod, 4);
});
test("funding delay without a funded scenario requests missing inputs", () => {
  assert.match(resolveVibpeScenarioContext(parseVibpeIntent("delay funding 2 months")).clarification, /Specify the funding amount/);
});
test("funding outside M36 is withheld instead of silently clamped", () => {
  assert.match(resolveVibpeScenarioContext(parseVibpeIntent("delay funding 3 months"), { ...baseScenario, cashInjectionPeriod: 35 }).clarification, /beyond M36/);
});
test("explicit funding month and amount are parsed", () => {
  const result = parseVibpeIntent("inject 25 lakh in month 5");
  assert.equal(result.scenario.cashInjectionPeriod, 5);
  assert.equal(result.scenario.cashInjectionLakh, 25);
});
test("independent cost and demand percentages do not cross-contaminate", () => {
  const result = parseVibpeIntent("increase Altitude demand 20% and reduce procurement cost 10%");
  assert.equal(result.scenario.demandMultiplierByProduct.premiumCarbon, 1.2);
  assert.equal(result.scenario.procurementCostMultiplier, 0.9);
});
test("an explicit reset discards the old scenario", () => {
  const result = resolveVibpeScenarioContext(parseVibpeIntent("new scenario inject 10 lakh"), baseScenario);
  assert.equal(result.scenario.capacityMultiplier, 1);
  assert.equal(result.scenario.cashInjectionLakh, 10);
  assert.equal(result.scenario.demandMultiplierByProduct, undefined);
});
test("family follow-up preserves other family settings", () => {
  const result = resolveVibpeScenarioContext(parseVibpeIntent("increase Latitude demand 10%"), baseScenario);
  assert.deepEqual(result.scenario.demandMultiplierByProduct, { premiumCarbon: 1.2, carbon: 1.1 });
});
test("global demand instruction replaces prior family overrides", () => {
  const result = resolveVibpeScenarioContext(parseVibpeIntent("increase demand 10%"), baseScenario);
  assert.equal(result.scenario.demandMultiplierByProduct, undefined);
  assert.equal(result.scenario.demandMultiplier, 1.1);
});
for (const question of ["inject 25 lakh", "What if funding arrives 2 months late?", "why?", "compare that", "plan for next 6 months", "reset scenario"]) {
  test(`context request avoids exact-ledger fallback: ${question}`, () => assert.equal(isVibpeContextualRequest(question), true));
}
for (const question of [
  "For recent months, compare transaction actual revenue and units with the approved plan and show the variance.",
  "An actual-versus-plan variance is large. Can VIBPE rewrite actuals to match the plan?",
]) {
  test(`actual-vs-plan comparison stays on the governed truth-contract path: ${question}`, () => {
    assert.equal(parseVibpeIntent(question).intent, "assessment");
    assert.equal(isVibpeContextualRequest(question), false);
  });
}

const evidence = { sourceCount: 2, unavailableCount: 0, unresolvedCount: 0, lineageComplete: true, capturedAt: "2026-10-04T10:00:00Z", now: Date.parse("2026-10-04T11:00:00Z"), methodVerified: true };
test("evidence score is explicitly not a correctness probability", () => {
  const result = assessVibpeEvidenceQuality(evidence);
  assert.equal(result.status, "supported");
  assert.equal(result.interpretation, "evidence-coverage-not-probability");
  assert.equal(result.snapshotAgeHours, 1);
});
for (const [name, patch, expected] of [
  ["missing source", { sourceCount: 0 }, "withheld"],
  ["failed source", { unavailableCount: 1 }, "withheld"],
  ["conflicting authority", { unresolvedCount: 1 }, "withheld"],
  ["missing lineage", { lineageComplete: false }, "withheld"],
  ["unexecuted method", { methodVerified: false }, "withheld"],
  ["stale source", { capturedAt: "2026-10-01T10:00:00Z" }, "limited"],
  ["missing age", { capturedAt: undefined }, "limited"],
  ["invalid date", { capturedAt: "not a date" }, "limited"],
  ["future date", { capturedAt: "2027-10-04T10:00:00Z" }, "limited"],
]) test(`evidence assessment: ${name}`, () => {
  const result = assessVibpeEvidenceQuality({ ...evidence, ...patch });
  assert.equal(result.status, expected);
  assert.ok(result.coverageScore < 1);
  assert.ok(result.reasons.length);
});
test("method disclosure cannot claim a solver or simulation execution", () => {
  assert.match(describeVibpeMethod("monte-carlo", false), /does not execute/);
  assert.match(describeVibpeMethod("highs-optimisation", false), /does not execute/);
  assert.match(describeVibpeMethod("scenario", false), /withheld/);
});

function database() {
  const rows = new Map();
  return { rows, async query(query, params) {
    const key = JSON.stringify(params.slice(0, 2));
    if (query.startsWith("select state_json")) return rows.has(key) ? [{ state_json: rows.get(key) }] : [];
    if (query.startsWith("insert into vyndi_vibpe_decision_sessions")) { rows.set(key, JSON.parse(params[2])); return []; }
    throw new Error("Unexpected fixture query");
  } };
}
test("durable sessions isolate owners even with an identical session key", async () => {
  const sql = database();
  await updatePersistedVibpeSession(sql, "alice", "same", { activeScenario: baseScenario });
  assert.equal((await hydrateVibpeSession(sql, "bob", "same")).activeScenario, undefined);
  assert.equal((await hydrateVibpeSession(sql, "alice", "same")).activeScenario.cashInjectionLakh, 50);
});
test("failed persistence cannot poison the next session", async () => {
  const sql = database();
  await updatePersistedVibpeSession(sql, "carol", "s", { activeScenario: baseScenario });
  await assert.rejects(updatePersistedVibpeSession({ query: async () => { throw new Error("unavailable"); } }, "carol", "s", { activeScenario: { ...baseScenario, cashInjectionLakh: 900 } }));
  assert.equal((await hydrateVibpeSession(sql, "carol", "s")).activeScenario.cashInjectionLakh, 50);
});

const baseline = { summary: { expectedUnits: 100, committedOpenUnits: 20, businessHealthScore: 80, totalRecommendedProcurementLakh: 10, capacityShortfallMonths: 0, fulfillmentShortageSkuMonths: 0, minimumFreeLiquidityAfterRecommendationsLakh: -5 }, funding: { incrementalFundingNeedLakh: 5, firstLiquidityBreachAfterRecommendationsPeriod: 4 }, findings: [], demand: [], supply: [], capacity: [], cash: [] };
let evaluated;
let governedCalls = 0;
globalThis.__vibpeReliabilityFixture = {
  evaluateScenario: async (_sql, scenario) => {
    evaluated = scenario;
    return { scenario, lineage: { governedRunId: "run-1" }, result: baseline, comparison: { fundingNeedDeltaLakh: 0, procurementLakhDelta: 0, expectedUnitsDelta: 0, minimumFreeLiquidityAfterRecommendationsDeltaLakh: 0 } };
  },
  governance: async () => { governedCalls++; return null; },
};
const copilotUrl = await sourceModule("src/lib/vibpe-copilot-2.ts", {
  "@/lib/ibpe-scenario-lab": url("export const evaluateScenario=(...args)=>globalThis.__vibpeReliabilityFixture.evaluateScenario(...args);"),
  "@/lib/vibpe-intent": intentUrl,
  "@/lib/vibpe-scenario-context": contextUrl,
  "@/lib/vibpe-answer-quality": qualityUrl,
  "@/lib/vibpe-knowledge-retrieval": url("export const retrieveVibpeKnowledgeEvidence=async()=>[];"),
  "@/lib/vibpe-governance-queries": url("export const tryGovernanceDataAnswer=(...args)=>globalThis.__vibpeReliabilityFixture.governance(...args);"),
  "@/lib/vibpe-operational-queries": url("export const tryOperationalDataAnswer=async()=>null;"),
  "@/lib/vibpe-truth-contract": url("export const tryVibpeTruthContractAnswer=async()=>null;"),
  "@/lib/vibpe-planning": url("export const explainVibpeHorizon=(_result,horizon)=>`Horizon ${horizon}`;"),
  "@/lib/vibpe-business-operator": url("export const vibpeBusinessOperatorContext=()=> 'Advisory only';"),
  "@/lib/vibpe-session": sessionUrl,
  "@/lib/vibpe-reasoning-core": coreUrl,
  "@/lib/vedm-authority-graph": url("export const compileVedmAuthorityGraph=()=>({}); export const createVedmR3aSeed=()=>({});"),
  "@/lib/vibpe-authority-reasoning": url("export const evaluateVibpeAuthorityContext=()=>({});"),
  "@/lib/vibpe-engineering-analysis": url("export const resolveVibpeEngineeringAnalysis=async()=>({handled:false});"),
});
const { runVibpeCopilot2 } = await import(copilotUrl);
test("actual orchestrator preserves assumptions across funding follow-up and comparison", async () => {
  const sql = database();
  const options = { ownerKey: "conversation-owner", sessionKey: "conversation", governedRunId: "run-1" };
  await updatePersistedVibpeSession(sql, options.ownerKey, options.sessionKey, { activeScenario: baseScenario, governedRunId: "run-1" });
  const result = await runVibpeCopilot2(sql, "What if funding arrives 2 months late?", baseline, options);
  assert.equal(evaluated.cashInjectionPeriod, 6);
  assert.equal(result.scenario.capacityMultiplier, 1.3);
  assert.match(result.answer, /advisory only/);
  assert.equal(governedCalls, 0);
  await runVibpeCopilot2(sql, "compare that", baseline, options);
  assert.equal(evaluated.cashInjectionPeriod, 6);
});
test("selected UI scenario takes precedence over saved context", async () => {
  const sql = database();
  const options = { ownerKey: "ui", sessionKey: "ui", governedRunId: "run-1", uiScenario: { ...baseScenario, cashInjectionLakh: 70 } };
  await updatePersistedVibpeSession(sql, "ui", "ui", { activeScenario: baseScenario, governedRunId: "run-1" });
  const result = await runVibpeCopilot2(sql, "delay funding 2 months", baseline, options);
  assert.equal(result.scenario.cashInjectionLakh, 70);
  const next = await runVibpeCopilot2(sql, "delay funding 1 month", baseline, options);
  assert.equal(next.scenario.cashInjectionPeriod, 7, "unchanged UI selection must not reset the preceding follow-up");
});
test("changed baseline refuses implicit reuse of the old scenario", async () => {
  const sql = database();
  await updatePersistedVibpeSession(sql, "changed", "changed", { activeScenario: baseScenario, governedRunId: "run-old" });
  const result = await runVibpeCopilot2(sql, "why?", baseline, { ownerKey: "changed", sessionKey: "changed", governedRunId: "run-1" });
  assert.match(result.answer, /Restate its assumptions/);
  assert.equal(result.scenarioResult, undefined);
});
test("missing context returns an explicit withheld follow-up", async () => {
  const result = await runVibpeCopilot2({ query: async () => { throw new Error("private database details"); } }, "why?", baseline, { ownerKey: "offline", sessionKey: "offline", governedRunId: "run-1" });
  assert.match(result.answer, /cannot be safely restored/);
  assert.doesNotMatch(result.answer, /private database details/);
});
test("scenario persistence failure discloses degraded mode without discarding the calculated result", async () => {
  const sql = { query: async (query) => { if (query.startsWith("select")) return []; throw new Error("private details"); } };
  const result = await runVibpeCopilot2(sql, "inject 25 lakh", baseline, { ownerKey: "save-fails", sessionKey: "save-fails", governedRunId: "run-1" });
  assert.equal(result.scenario.cashInjectionLakh, 25);
  assert.equal(result.dataState.mode, "degraded");
  assert.match(result.answer, /not saved/);
});
test("record-source failure cannot silently become a planning conclusion", async () => {
  const original = globalThis.__vibpeReliabilityFixture.governance;
  try {
    globalThis.__vibpeReliabilityFixture.governance = async () => { throw new Error("private details"); };
    const result = await runVibpeCopilot2(database(), "show supplier records", baseline, { ownerKey: "record-fails", sessionKey: "record-fails" });
    assert.match(result.answer, /conclusion is withheld/);
    assert.doesNotMatch(result.answer, /Business health|private details/);
  } finally { globalThis.__vibpeReliabilityFixture.governance = original; }
});

const serverFnUrl = url("export const createServerFn=()=>({validator(){return this},middleware(){return this},handler(fn){return fn}});");
const scenarioLabUrl = await sourceModule("src/lib/ibpe-scenario-lab.ts", {
  "@/lib/integrated-business-planning-engine": url("export {};"),
  "@tanstack/react-start": serverFnUrl,
  "@/lib/db": url("export const getSql=async()=>globalThis.__vibpeReliabilityFixture.sql;"),
  "@/lib/command-access": url("export const getCommandRole=async()=> 'admin';"),
  "@/lib/page-access": url("export const canPerform=()=>true;"),
  "@/lib/ibpe-runtime-parity": url("export const RUNTIME_IBPE_ENGINE_VERSION='fixture-engine'; export const runRuntimeIbpe=()=>({});"),
});
const { applyIbpeScenario } = await import(scenarioLabUrl);
test("production scenario transformation preserves actuals and commitments while changing residual forecast", () => {
  const input = { demand: [{ productId: "premiumCarbon", actualQty: 10, committedQty: 20, forecastQty: 100, weightedPipelineQty: 10 }], inventory: [{ unitCostLakh: 2, leadTimeMonths: 3 }], capacity: [{ capacityUnits: 100 }], receipts: [{ period: 3 }], cashFlows: [] };
  const before = structuredClone(input);
  const result = applyIbpeScenario(input, baseScenario);
  assert.equal(result.demand[0].forecastQty, 114); // 10 actual + 20 committed + 70 * 1.2
  assert.equal(result.demand[0].actualQty, 10);
  assert.equal(result.demand[0].committedQty, 20);
  assert.equal(result.capacity[0].capacityUnits, 130);
  assert.equal(result.inventory[0].unitCostLakh, 2.2);
  assert.equal(result.receipts[0].period, 4);
  assert.equal(result.cashFlows[0].amountLakh, 50);
  assert.equal(result.cashFlows[0].period, 4);
  assert.equal(result.cashFlows[0].truth, "forecast");
  assert.deepEqual(input, before);
});

const mainUrl = await sourceModule("src/lib/ibpe-copilot.ts", {
  "@tanstack/react-start": serverFnUrl,
  "@/lib/db": url("export const getSql=async()=>globalThis.__vibpeReliabilityFixture.sql;"),
  "@/lib/business-actor": url("export const requireBusinessActor=async()=>{ if(globalThis.__vibpeReliabilityFixture.deny) throw new Error('Forbidden'); return {userId:'test-owner',role:'admin'}; }"),
  "@/lib/ibpe-scenario-lab": url("export const evaluateScenario=(...args)=>globalThis.__vibpeReliabilityFixture.evaluateScenario(...args);"),
  "@/lib/ibpe-brand": url("export const VIBPE_COPILOT_NAME='VIBPE';"),
  "@/lib/observability/server": url("export const observeOperation=(_meta,fn)=>fn();"),
  "@/lib/ibpe-runtime-parity": url("export const RUNTIME_IBPE_ENGINE_VERSION='fixture-engine';"),
  "@/lib/vibpe-copilot-2": copilotUrl,
  "@/lib/vibpe-knowledge-retrieval": url("export const retrieveVibpeKnowledgeEvidence=async()=>[];"),
  "@/lib/vibpe-weekly-review-knowledge": url("export const refreshVibpeWeeklyReviewsIfStale=async()=>{};"),
  "@/lib/vibpe-vayu-shastr-drive": url("export const refreshVayuShastrDriveIfStale=async()=>{};"),
  "@/lib/vibpe-reasoning-core": coreUrl,
  "@/lib/vibpe-answer-quality": qualityUrl,
  "@/lib/vibpe-persistence": persistenceUrl,
});
const { askIbpeCopilot } = await import(mainUrl);
function mainDatabase({ failReceipt = false, failAudit = false, noBaseline = false } = {}) {
  const sessions = database();
  const captured = [];
  return { captured, async query(query, params = []) {
    if (query.includes("from vyndi_ibpe_runs")) return noBaseline ? [] : [{ id: "run-1", engine_version: "fixture-engine", approved_plan_revision: 1, input_hash: "hash-123", source_sha: "sha-123", result_json: baseline, validation_json: {}, captured_at: "2026-09-01T10:00:00Z" }];
    if (query.includes("insert into vyndi_vibpe_answer_receipts")) { if (failReceipt) throw new Error("private receipt SQL"); captured.push(JSON.parse(params[5])); return []; }
    if (query.includes("insert into vyndi_audit_events")) { if (failAudit) throw new Error("private audit SQL"); return []; }
    return sessions.query(query, params);
  } };
}
test("production entry point returns a traceable scenario answer and persists its evidence assessment", async () => {
  const sql = mainDatabase();
  globalThis.__vibpeReliabilityFixture.sql = sql;
  const result = await askIbpeCopilot({ data: { question: "inject 25 lakh" } });
  assert.equal(result.ok, true);
  assert.equal(result.lineage.governedRunId, "run-1");
  assert.equal(result.evidenceQuality.status, "limited");
  assert.match(result.answer, /deterministic scenario recalculation/);
  assert.equal(sql.captured.length, 1);
  assert.equal(sql.captured[0].confidence, result.evidenceQuality.coverageScore);
  assert.equal(sql.captured[0].evidence[0].effectiveDate, "2026-09-01T10:00:00Z");
  assert.equal(sql.captured[0].evidenceQuality.interpretation, "evidence-coverage-not-probability");
});
test("production entry point refuses missing baseline without leaking database details", async () => {
  globalThis.__vibpeReliabilityFixture.sql = mainDatabase({ noBaseline: true });
  const result = await askIbpeCopilot({ data: { question: "inject 25 lakh" } });
  assert.equal(result.ok, false);
  assert.equal(result.dataMode, "degraded");
  assert.match(result.error, /baseline.*unavailable/);
});
test("unsaved receipt never returns a receipt ID", async () => {
  globalThis.__vibpeReliabilityFixture.sql = mainDatabase({ failReceipt: true });
  const result = await askIbpeCopilot({ data: { question: "inject 25 lakh" } });
  assert.equal(result.ok, true);
  assert.equal(result.reasoningReceiptId, undefined);
  assert.equal(result.dataMode, "degraded");
  assert.match(result.answer, /not persisted/);
});
test("required audit failure returns a safe error instead of an unaudited success", async () => {
  globalThis.__vibpeReliabilityFixture.sql = mainDatabase({ failAudit: true });
  const result = await askIbpeCopilot({ data: { question: "inject 25 lakh" } });
  assert.equal(result.ok, false);
  assert.match(result.error, /audit could not be recorded/);
  assert.doesNotMatch(result.error, /private audit SQL/);
});
test("RBAC denial precedes baseline or context access", async () => {
  let queried = false;
  globalThis.__vibpeReliabilityFixture.sql = { query: async () => { queried = true; return []; } };
  globalThis.__vibpeReliabilityFixture.deny = true;
  try {
    await assert.rejects(askIbpeCopilot({ data: { question: "inject 25 lakh" } }), /Forbidden/);
    assert.equal(queried, false);
  } finally { globalThis.__vibpeReliabilityFixture.deny = false; }
});
