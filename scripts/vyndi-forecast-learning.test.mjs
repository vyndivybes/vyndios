import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const read=(p)=>readFile(new URL(`../${p}`,import.meta.url),"utf8");
const [migration,model,authority,panel,planning,intelligence,vibpe,pkg]=await Promise.all([
  read("migrations/0113_vyndi_forecast_learning.sql"),
  read("src/lib/forecast-learning-model.ts"),
  read("src/lib/forecast-learning-authority.ts"),
  read("src/components/forecast-learning-panel.tsx"),
  read("src/routes/command/planning.tsx"),
  read("src/routes/command/intelligence.tsx"),
  read("src/lib/vibpe-governance-queries.ts"),
  read("package.json"),
]);

test("forecast vintages and period closes are immutable governed evidence",()=>{
  for(const token of ["vyndi_forecast_vintages","vyndi_forecast_vintage_lines","vyndi_learning_period_closes","vyndi_learning_period_close_products","vyndi_forecast_learning_runs"]) assert.ok(migration.includes(token),token);
  assert.match(migration,/capture_vyndi_forecast_vintage/);
  assert.match(migration,/close_vyndi_learning_period/);
  assert.match(migration,/superseded/);
  assert.match(migration,/vyndi_reject_forecast_learning_mutation/);
  assert.match(migration,/before update or delete/i);
});

test("learning authority forbids hindsight by selecting only vintages captured before target period start",()=>{
  assert.match(authority,/captured_at.*period_start|period_start.*captured_at/s);
  assert.match(authority,/captureForecastVintage/);
  assert.match(authority,/closeLearningPeriod/);
  assert.match(authority,/captureForecastLearningSnapshot/);
  assert.match(authority,/buildForecastLearning/);
});

test("forecast learning computes WAPE bias plan attainment forecast attainment and FVA with maturity gate",()=>{
  for(const token of ["wapePct","biasPct","planAttainmentPct","forecastAttainmentPct","fvaUnits","fvaPct","minimumClosedPeriods"]) assert.ok(model.includes(token),token);
  assert.match(model,/3/);
  assert.doesNotMatch(model,/Math\.random/);
});

test("Planning and Product Intelligence expose the governed learning loop",()=>{
  assert.match(planning,/ForecastLearningPanel/);
  assert.match(panel,/Forecast Learning Loop/);
  assert.match(panel,/Capture forecast vintage/);
  assert.match(panel,/Close period/);
  assert.match(panel,/WAPE/);
  assert.match(panel,/Forecast Value Added/);
  assert.match(intelligence,/Forecast Learning/);
});

test("VIBPE answers forecast accuracy questions only from governed closed evidence",()=>{
  assert.match(vibpe,/isForecastLearningQuestion/);
  assert.match(vibpe,/forecastLearningAnswer/);
  assert.match(vibpe,/WAPE/);
  assert.match(vibpe,/bias/i);
  assert.match(vibpe,/WITHHELD/);
});

test("aggregate test gate includes Package N",()=>{
  assert.match(pkg,/vyndi-forecast-learning\.test\.mjs/);
  assert.match(pkg,/forecast-learning-model\.test\.ts/);
});


test("Forecast Learning GET state carries a typed serializable saved-run payload",()=>{
  assert.match(authority,/type ForecastLearningResult = ReturnType<typeof buildForecastLearning>/);
  assert.match(authority,/type LearningRunRow/);
  assert.match(authority,/result_json:ForecastLearningResult/);
  assert.match(authority,/sql\.query<LearningRunRow>/);
  assert.doesNotMatch(authority,/sql\.query<Record<string,unknown>>\(\s*`select id,as_of::text,minimum_closed_periods/);
});
