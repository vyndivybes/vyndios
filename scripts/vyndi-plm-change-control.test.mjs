import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const read=(p)=>readFile(new URL(`../${p}`,import.meta.url),"utf8");
const [migration,model,authority,panel,route,vibpe,pkg]=await Promise.all([
  read("migrations/0115_vyndi_plm_change_effectivity.sql"),
  read("src/lib/engineering-change-control-model.ts"),
  read("src/lib/engineering-change-control-authority.ts"),
  read("src/components/engineering-change-control-panel.tsx"),
  read("src/routes/command/engineering.tsx"),
  read("src/lib/vibpe-governance-queries.ts"),
  read("package.json"),
]);

test("Package P adds ECO effectivity and immutable ECN authority without replacing ECR or baseline truth",()=>{
  for(const token of ["vyndi_engineering_change_orders","vyndi_engineering_change_effectivity","vyndi_engineering_change_notices"]) assert.match(migration,new RegExp(token));
  assert.match(migration,/ecr_id text not null references vyndi_engineering_change_requests/);
  assert.match(migration,/target_baseline_id text not null references vyndi_engineering_baselines/);
  assert.match(migration,/release_vyndi_engineering_change_order/);
  assert.match(migration,/ECR must be approved/);
  assert.match(migration,/target Engineering baseline must be released/);
  assert.match(migration,/target BOM revision must already be released/);
  assert.match(migration,/vyndi_reject_ecn_mutation/);
});

test("effectivity model supports configuration date serial order and job-card scope with fail-closed semantics",()=>{
  for(const token of ['"variant"','"date"','"serial"','"sales_order"','"job_card"']) assert.ok(model.includes(token),token);
  assert.match(model,/AND/i);
  assert.match(model,/OR/i);
  assert.match(model,/return .*effective:false/s);
});

test("PLM authority builds governed baseline comparison and where-used impact from canonical BOM and frozen Job Cards",()=>{
  for(const token of ["vyndi_engineering_change_requests","vyndi_engineering_baselines","vyndi_bom_revision_releases","epr_bom_inventory_mappings","epr_production_job_cards","jsonb_array_elements_text"]) assert.match(authority,new RegExp(token));
  assert.match(authority,/createEngineeringChangeOrder/);
  assert.match(authority,/addEngineeringEffectivityRule/);
  assert.match(authority,/transitionEngineeringChangeOrder/);
  assert.match(authority,/releaseEngineeringChangeOrder/);
  assert.match(authority,/compareEngineeringBaselines/);
  assert.match(authority,/whereUsed/);
});

test("Engineering route exposes ECR to ECO/ECN lifecycle effectivity baseline diff and where-used impact",()=>{
  assert.match(route,/EngineeringChangeControlPanel/);
  assert.match(panel,/PLM Change & Effectivity/);
  assert.match(panel,/ECR → ECO → ECN/);
  assert.match(panel,/Effectivity/);
  assert.match(panel,/Where-used/);
  assert.match(panel,/Baseline comparison/);
});

test("VIBPE answers ECO ECN effectivity and where-used questions from governed PLM authority",()=>{
  assert.match(vibpe,/isEngineeringChangeControlQuestion/);
  assert.match(vibpe,/engineeringChangeControlAnswer/);
  assert.match(vibpe,/ECO/);
  assert.match(vibpe,/ECN/);
  assert.match(vibpe,/effectivity/i);
  assert.match(vibpe,/where-used/i);
});

test("aggregate test gate includes Package P",()=>{
  assert.match(pkg,/vyndi-plm-change-control\.test\.mjs/);
  assert.match(pkg,/engineering-change-control-model\.test\.ts/);
});


test("ECN release revalidates approved ECR revision and BOM scope at the database boundary",()=>{
  assert.match(migration,/target Engineering baseline revision does not match the approved ECR target revision/);
  assert.match(migration,/ECO target BOM revision does not match the approved ECR scope/);
  assert.match(migration,/Variant effectivity contains a value outside the approved ECR product family/);
});

test("Package P TypeScript contains no connector escape artifacts",()=>{
  for(const [name,source] of [["model",model],["authority",authority],["panel",panel],["route",route],["vibpe",vibpe]]){
    assert.equal(source.includes("\\`"),false,`${name} contains an escaped backtick artifact`);
    assert.equal(source.includes("\\\${"),false,`${name} contains an escaped template placeholder artifact`);
  }
});
