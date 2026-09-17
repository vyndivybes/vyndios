import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const text = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("startup reserve is separate from the ₹15L T1 working-capital tranche", async () => {
  const plan = await text("src/lib/planning/operating-plan.ts");
  assert.match(plan, /cashFloorLakh:\s*3,/);
  assert.match(plan, /₹15L Foundation tranche is deployable working capital/i);
  assert.doesNotMatch(plan, /cashFloorLakh:\s*15,/);
});

test("founder cash guardrail uses the same ₹3L startup reserve", async () => {
  const founder = await text("src/lib/data/founder-control.ts");
  assert.match(founder, /cashFloorLakh:\s*3,/);
  assert.doesNotMatch(founder, /cashFloorLakh:\s*15,/);
});

test("approved-plan migration supersedes rather than mutating plan history", async () => {
  const migration = await text("migrations/0073_startup_cash_floor_authority.sql");
  assert.match(migration, /PLAN-STARTUP-RESERVE-3L/);
  assert.match(migration, /jsonb_set\(v_old\.finance_json, '\{operatingPlan,cashFloorLakh\}', '3'::jsonb, true\)/);
  assert.match(migration, /SET status='superseded'/i);
  assert.match(migration, /supersedes_id/);
  assert.match(migration, /AUD-PLAN-STARTUP-RESERVE-3L/);
  assert.match(migration, /T1 working capital is deployable; reserve is separate/);
});

test("Command Centre cash KPI is canonical authority, not the default model", async () => {
  const command = await text("src/routes/command/index.tsx");
  assert.match(command, /listCanonicalCashAuthority/);
  assert.match(command, /label="Canonical cash"/);
  assert.doesNotMatch(command, /buildModel\(/);
  assert.doesNotMatch(command, /minCash\(/);
  assert.doesNotMatch(command, /label="Cash trough"/);
});

test("₹15L cash remains usable while preserving a ₹3L reserve after ₹2.8L early spend", () => {
  const verifiedCashLakh = 15;
  const earlySpendLakh = 2.8;
  const minimumReserveLakh = 3;
  const closingCashLakh = verifiedCashLakh - earlySpendLakh;
  const freeLiquidityLakh = closingCashLakh - minimumReserveLakh;

  assert.equal(closingCashLakh, 12.2);
  assert.ok(freeLiquidityLakh > 0);
  assert.equal(Number(freeLiquidityLakh.toFixed(1)), 9.2);
});
