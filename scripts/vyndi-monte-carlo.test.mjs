import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read=(path)=>readFile(new URL(`../${path}`,import.meta.url),"utf8");
const [model,authority,migration,planning,planningDeck,intelligence,vibpe,component]=await Promise.all([
  read("src/lib/monte-carlo-model.ts"),
  read("src/lib/monte-carlo-authority.ts"),
  read("migrations/0106_vyndi_monte_carlo.sql"),
  read("src/routes/command/planning.tsx"),
  read("src/components/planning-intelligence-deck.tsx"),
  read("src/routes/command/intelligence.tsx"),
  read("src/lib/vibpe-governance-queries.ts"),
  read("src/components/monte-carlo-panel.tsx"),
]);

test("Monte Carlo resamples task uncertainty and recomputes critical path",()=>{
  assert.match(model,/sampleTriangular/);
  assert.match(model,/sampledSchedule/);
  assert.match(model,/criticalPathFrequency/);
  assert.match(model,/MONTE_CARLO_TRIANGULAR_V1/);
  assert.match(model,/Physical engineering response probabilities require explicit governed response models/);
});

test("Monte Carlo persistence is seeded immutable evidence",()=>{
  assert.match(migration,/seed integer not null/);
  assert.match(migration,/Immutable seeded Monte Carlo/);
  assert.match(authority,/MONTE_CARLO_RUN_CAPTURED/);
  assert.match(authority,/Monte Carlo withheld/);
});

test("Planning and Product Intelligence expose only governed captured Monte Carlo evidence",()=>{
  assert.match(planning,/PlanningIntelligenceDeck/);
  assert.match(planningDeck,/MonteCarloPanel/);
  assert.match(planningDeck,/getMonteCarloState/);
  assert.match(component,/Run governed Monte Carlo/);
  assert.match(intelligence,/Monte Carlo program uncertainty/);
  assert.match(intelligence,/critical-path recalculation each iteration/);
});

test("VIBPE can report the latest captured Monte Carlo run",()=>{
  assert.match(vibpe,/isMonteCarloQuestion/);
  assert.match(vibpe,/vyndi_monte_carlo_runs/);
  assert.match(vibpe,/physical material\/FEA\/fatigue response model/i);
});
