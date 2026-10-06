import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const planning = await readFile(new URL("../src/routes/command/planning.tsx", import.meta.url), "utf8");
const deck = await readFile(new URL("../src/components/planning-intelligence-deck.tsx", import.meta.url), "utf8");

test("Planning initial loader keeps only core authoritative reads", () => {
  const start = planning.indexOf('createFileRoute("/command/planning")');
  const end = planning.indexOf("component: MasterPlan", start);
  assert.ok(start >= 0 && end > start);
  const loader = planning.slice(start, end);
  assert.match(loader, /context\.commandRole/);
  assert.match(loader, /getOperatingPlanState\(\)/);
  assert.match(loader, /listEngineeringAuthority\(\)/);
  assert.match(loader, /getPlanningProcurementReality\(\)/);
  assert.doesNotMatch(loader, /getCommandRole\(\)/);
  assert.doesNotMatch(loader, /getProgramPlanningState\(\)|getProgramForecastState\(\)|getMonteCarloState\(\)|getEarnedValueState\(\)|getForecastLearningState\(\)/);
});

test("Planning treats a missing approved plan as a governed blocker", () => {
  const start = planning.indexOf("async function getPlanningProcurementReality()");
  const end = planning.indexOf('createFileRoute("/command/planning")', start);
  assert.ok(start >= 0 && end > start);
  const reality = planning.slice(start, end);
  assert.match(reality, /getProcurementPlanningReport\(\)/);
  assert.match(reality, /PROCUREMENT_PLANNING_NO_APPROVED_PLAN_MESSAGE/);
  assert.match(reality, /planningMappingIssues: \[\]/);
  assert.match(reality, /unprojectedCommitments: \[\]/);
  assert.match(reality, /blockedMessage: error\.message/);
  assert.match(planning, /procurement\.blockedMessage \? \[procurement\.blockedMessage\] : \[\]/);
});

test("Planning advisory intelligence is loaded only when its section is opened", () => {
  for (const fn of [
    "getProgramPlanningState",
    "getProgramForecastState",
    "getMonteCarloState",
    "getEarnedValueState",
    "getForecastLearningState",
  ]) {
    assert.ok(deck.includes(fn), `${fn} must remain available on demand`);
  }
  assert.match(deck, /onToggle/);
  assert.match(deck, /load on demand/i);
  assert.doesNotMatch(deck, /useEffect\s*\(/);
});
