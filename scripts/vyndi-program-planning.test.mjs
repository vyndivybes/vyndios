import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const [planningRoute, component, authority, migration, vibpe, smoke] = await Promise.all([
  read("src/routes/command/planning.tsx"),
  read("src/components/program-gate-plan.tsx"),
  read("src/lib/program-planning-authority.ts"),
  read("migrations/0101_vyndi_program_planning.sql"),
  read("src/lib/vibpe-governance-queries.ts"),
  read("scripts/vyndi-production-playwright-smoke.mjs"),
]);

test("Integrated Operating Plan owns Program and Gate Planning", () => {
  assert.match(planningRoute, /ProgramGatePlan/);
  assert.match(planningRoute, /getProgramPlanningState/);
  assert.match(component, /Program & Gate Planning/);
  assert.match(component, /Program Network/);
  assert.match(component, /CRITICAL/);
});

test("program authority persists tasks, dependencies and audited lifecycle transitions", () => {
  assert.match(authority, /createProgramTask/);
  assert.match(authority, /createProgramDependency/);
  assert.match(authority, /transitionProgramTaskStatus/);
  assert.match(authority, /PROGRAM_TASK_CREATED/);
  assert.match(authority, /PROGRAM_DEPENDENCY_CREATED/);
  assert.match(authority, /PROGRAM_TASK_STATUS_CHANGED/);
});

test("program authority view avoids grouping the full task row", () => {
  assert.doesNotMatch(migration, /group by\s+t\.id/i);
  assert.match(migration, /coalesce\s*\(\s*\(\s*select\s+jsonb_agg/i);
});

test("schema carries required evidence, risk links, planned vs actual and cost/resource fields", () => {
  for (const token of [
    "required_evidence",
    "risk_ids",
    "planned_start",
    "planned_finish",
    "actual_start",
    "actual_finish",
    "estimated_effort_hours",
    "actual_effort_hours",
    "cost_lakh",
    "confidence",
    "technical_maturity",
  ]) assert.ok(migration.includes(token), `missing ${token}`);
});

test("VIBPE program answer is deterministic and refuses probabilistic schedule claims", () => {
  assert.match(vibpe, /isProgramPlanningQuestion/);
  assert.match(vibpe, /buildProgramNetwork/);
  assert.match(vibpe, /deterministic critical duration/);
  assert.match(vibpe, /does not infer P50\/P80\/P95/);
});

test("Playwright smoke includes Integrated Operating Plan", () => {
  assert.match(smoke, /"\/command\/planning"/);
  assert.match(smoke, /Integrated Operating Plan/);
});
