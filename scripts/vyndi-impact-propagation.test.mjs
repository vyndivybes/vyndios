import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read=(path)=>readFile(new URL(`../${path}`,import.meta.url),"utf8");
const [model,authority,page,component,vibpe,migration]=await Promise.all([
  read("src/lib/impact-propagation-model.ts"),
  read("src/lib/impact-propagation-authority.ts"),
  read("src/routes/command/engineering.tsx"),
  read("src/components/engineering-impact-panel.tsx"),
  read("src/lib/vibpe-governance-queries.ts"),
  read("migrations/0103_vyndi_impact_propagation.sql"),
]);

test("impact model uses relation-aware graph traversal and does not activate superseded history",()=>{
  assert.match(model,/case "DERIVES_FROM"/);
  assert.match(model,/case "REQUIRES"/);
  assert.match(model,/case "SUPERSEDES":\s*return \[\]/);
  assert.match(model,/evidence_suspect/);
  assert.match(model,/release_gate_review/);
});

test("impact assessments are immutable advisory evidence and cross-link program/risk",()=>{
  assert.match(migration,/Immutable advisory Engineering Graph impact snapshots/);
  assert.match(authority,/vyndi_impact_assessments/);
  assert.match(authority,/affectedProgramTasks/);
  assert.match(authority,/affectedRisks/);
  assert.match(authority,/advisoryOnly:true/);
  assert.match(authority,/ENGINEERING_IMPACT_ASSESSED/);
});

test("Engineering exposes graph impact analysis without automatic release mutation",()=>{
  assert.match(page,/EngineeringImpactPanel/);
  assert.match(component,/Engineering Impact Analysis/);
  assert.match(component,/advisory only/i);
  assert.match(component,/Evidence suspect/);
  assert.match(component,/Release gates/);
  assert.match(component,/Program impact/);
  assert.match(component,/Risk impact/);
});

test("VIBPE impact answers require a controlled source node and stay advisory",()=>{
  assert.match(vibpe,/isEngineeringImpactQuestion/);
  assert.match(vibpe,/does not identify a controlled Engineering Graph node ID/);
  assert.match(vibpe,/analyzeEngineeringImpact/);
  assert.match(vibpe,/does not approve a change, supersede evidence, or release engineering authority/);
});
