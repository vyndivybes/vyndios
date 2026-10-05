import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read=(path)=>readFile(new URL(`../${path}`,import.meta.url),"utf8");
const [model,authority,migration,planning,planningDeck,intelligence,intelligenceDeck,vibpe,component]=await Promise.all([
  read("src/lib/forecast-model.ts"),
  read("src/lib/forecast-authority.ts"),
  read("migrations/0104_vyndi_forecast_engine.sql"),
  read("src/routes/command/planning.tsx"),
  read("src/components/planning-intelligence-deck.tsx"),
  read("src/routes/command/intelligence.tsx"),
  read("src/components/intelligence-advisory-deck.tsx"),
  read("src/lib/vibpe-governance-queries.ts"),
  read("src/components/program-forecast-panel.tsx"),
]);

test("forecast engine uses explicit three-point PERT and declares limitations",()=>{
  assert.match(model,/PERT_NORMAL_APPROXIMATION/);
  assert.match(model,/0\.841621/);
  assert.match(model,/1\.644854/);
  assert.match(model,/Critical path is fixed at expected task durations/);
  assert.match(model,/correlation is not modeled/);
  assert.doesNotMatch(model,/MONTE_CARLO/);
});

test("forecast persistence carries O M P inputs and immutable run evidence",()=>{
  for(const token of ["optimistic_days","most_likely_days","pessimistic_days","cost_forecast_required","vyndi_program_forecast_runs"]){
    assert.ok(migration.includes(token),`missing ${token}`);
  }
  assert.match(authority,/PROGRAM_FORECAST_INPUTS_UPDATED/);
  assert.match(authority,/PROGRAM_FORECAST_RUN_CAPTURED/);
  assert.match(authority,/Forecast withheld/);
});

test("Planning owns forecast inputs and captured forecast runs",()=>{
  assert.match(planning,/PlanningIntelligenceDeck/);
  assert.match(planningDeck,/ProgramForecastPanel/);
  assert.match(planningDeck,/getProgramForecastState/);
  assert.match(component,/Schedule & Cost Forecast/);
  assert.match(component,/Capture governed forecast run/);
  assert.match(component,/P quantiles withheld/);
});

test("Product Intelligence surfaces only captured governed forecast quantiles",()=>{
  assert.match(intelligence,/IntelligenceAdvisoryDeck/);
  assert.match(intelligenceDeck,/Program forecast/);
  assert.match(intelligenceDeck,/captured/i);
  assert.match(intelligenceDeck,/Schedule P50/);
  assert.match(intelligenceDeck,/PERT-normal approximation only/);
});

test("VIBPE withholds uncaptured quantiles and explains captured PERT boundary",()=>{
  assert.match(vibpe,/isProgramForecastQuestion/);
  assert.match(vibpe,/No governed Program Forecast run has been captured/);
  assert.match(vibpe,/withholds P50\/P80\/P95/);
  assert.match(vibpe,/Monte Carlo remains a later governed engine/);
});
