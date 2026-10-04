import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read=(path)=>readFile(new URL(`../${path}`,import.meta.url),"utf8");
const [model,authority,migration,route,component,vibpe,ux]=await Promise.all([
  read("src/lib/manufacturing-quality-model.ts"),
  read("src/lib/manufacturing-quality-authority.ts"),
  read("migrations/0107_vyndi_manufacturing_quality_intelligence.sql"),
  read("src/routes/command/quality.tsx"),
  read("src/components/manufacturing-quality-intelligence-panel.tsx"),
  read("src/lib/vibpe-governance-queries.ts"),
  read("scripts/operator-ux-hardening.mjs"),
]);

test("quality prediction is sample-gated and capability requires actual measurement evidence",()=>{
  assert.match(model,/BETA_BINOMIAL_UNIFORM_PRIOR_NORMAL_APPROX_V1/);
  assert.match(model,/At least.*inspected units/);
  assert.match(model,/At least.*actual measurements/);
  assert.match(model,/Cp\/Cpk calculated from actual persisted measurements/);
});

test("quality measurement and intelligence snapshots are canonical auditable evidence",()=>{
  assert.match(migration,/vyndi_quality_measurements/);
  assert.match(migration,/vyndi_quality_intelligence_runs/);
  assert.match(authority,/QUALITY_MEASUREMENT_RECORDED/);
  assert.match(authority,/QUALITY_INTELLIGENCE_CAPTURED/);
  assert.match(authority,/Observed scrap\/rework cost is an actual-cost signal, not a future scrap-rate prediction/);
});

test("canonical Quality workspace hosts manufacturing and quality intelligence",()=>{
  assert.match(route,/ManufacturingQualityIntelligencePanel/);
  assert.match(component,/Manufacturing & Quality Intelligence/);
  assert.match(component,/Inspection defect \/ yield forecast/);
  assert.match(component,/Process Capability/);
  assert.match(component,/Record governed measurement/);
});

test("VIBPE reports only captured governed Quality Intelligence evidence",()=>{
  assert.match(vibpe,/isManufacturingQualityIntelligenceQuestion/);
  assert.match(vibpe,/vyndi_quality_intelligence_runs/);
  assert.match(vibpe,/No governed Quality Intelligence snapshot has been captured/);
});

test("Quality stays in responsive qualification",()=>{
  assert.match(ux,/\/command\/quality/);
});
