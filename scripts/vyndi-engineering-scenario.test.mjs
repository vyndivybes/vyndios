import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read=(path)=>readFile(new URL(`../${path}`,import.meta.url),"utf8");
const [model,authority,migration,route,component,vibpe,ux]=await Promise.all([
  read("src/lib/engineering-scenario-model.ts"),
  read("src/lib/engineering-scenario-authority.ts"),
  read("migrations/0105_vyndi_scenario_engine.sql"),
  read("src/routes/command/scenarios.tsx"),
  read("src/components/engineering-scenario-panel.tsx"),
  read("src/lib/vibpe-governance-queries.ts"),
  read("scripts/operator-ux-hardening.mjs"),
]);

test("Engineering Scenario combines graph impact and scenario-only forecast overrides",()=>{
  assert.match(model,/analyzeEngineeringImpact/);
  assert.match(model,/buildProgramForecast/);
  assert.match(model,/scenarioAssumptions/);
  assert.match(model,/scheduleDelta/);
  assert.match(model,/costDelta/);
  assert.match(model,/target program task is required/i);
});

test("scenario persistence is immutable advisory evidence",()=>{
  assert.match(migration,/Immutable advisory engineering what-if snapshots/);
  assert.match(authority,/vyndi_engineering_scenario_runs/);
  assert.match(authority,/ENGINEERING_SCENARIO_CAPTURED/);
  assert.match(authority,/Engineering Scenario execution requires Engineering, QA or Admin authority/);
  assert.match(authority,/method:"ENGINEERING_GRAPH_PLUS_PERT"/);
});

test("existing Scenario Studio hosts Engineering Scenario without removing IBPE scenario capability",()=>{
  assert.match(route,/EngineeringScenarioPanel/);
  assert.match(route,/getEngineeringScenarioState/);
  assert.match(route,/runIbpeScenario/);
  assert.match(component,/Engineering Scenario Engine/);
  assert.match(component,/Baseline vs scenario forecast/);
  assert.match(component,/Technical \/ release impact/);
  assert.match(component,/scenario assumptions and do not update the governed task/i);
});

test("engineering scenario page remains in responsive qualification",()=>{
  assert.match(ux,/\/command\/scenarios/);
});

test("VIBPE can report captured Engineering Scenario evidence",()=>{
  assert.match(vibpe,/isEngineeringScenarioQuestion/);
  assert.match(vibpe,/vyndi_engineering_scenario_runs/);
  assert.match(vibpe,/advisory scenario evidence/i);
});
