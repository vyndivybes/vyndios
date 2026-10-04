import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [page, authority, migration, model, vibpe] = await Promise.all([
  read("src/routes/command/intelligence.tsx"),
  read("src/lib/readiness-authority.ts"),
  read("migrations/0102_vyndi_readiness_engine.sql"),
  read("src/lib/readiness-model.ts"),
  read("src/lib/vibpe-governance-queries.ts"),
]);

test("Product Intelligence shows readiness confidence and risk as separate measures", () => {
  assert.match(page, /Program readiness/);
  assert.match(page, /Evidence completeness/);
  assert.match(page, /Evidence confidence/);
  assert.match(page, /Active risks/);
  assert.match(page, /Configuration blockers/);
  assert.match(page, /Composite VPRI:.*WITHHELD/s);
});

test("readiness authority combines governed program and VEDM evidence without inferring confidence", () => {
  assert.match(authority, /vyndi_program_tasks/);
  assert.match(authority, /vyndi_readiness_evidence/);
  assert.match(authority, /createVedmR3aSeed/);
  assert.match(authority, /confidence: null/);
  assert.match(authority, /classifyVedmIssueDomain/);
});

test("readiness evidence registry preserves state confidence authority provenance and audit revision", () => {
  for (const token of ["evidence_state","confidence","authority","provenance_class","record_revision","source_reference"]) {
    assert.ok(migration.includes(token), `missing ${token}`);
  }
  assert.match(authority, /READINESS_EVIDENCE_CREATED/);
  assert.match(authority, /READINESS_EVIDENCE_UPDATED/);
});

test("composite VPRI remains disabled until governed weights exist", () => {
  assert.match(model, /overallReadinessPct: null/);
  assert.match(model, /governed weighting/);
});


test("VIBPE explains readiness while preserving the composite-index boundary", () => {
  assert.match(vibpe, /isReadinessIntelligenceQuestion/);
  assert.match(vibpe, /Evidence completeness:/);
  assert.match(vibpe, /Evidence confidence:/);
  assert.match(vibpe, /Composite VPRI: WITHHELD/);
});


test("readiness server state returns normalized serializable evidence rather than raw unknown DB rows", () => {
  assert.doesNotMatch(authority, /persistedEvidence:\s*\[\.\.\.evidenceRows\]/);
  assert.match(authority, /persistedEvidence,\s*\n\s*vedmEvidence:/);
});

test("VIBPE readiness query imports the VEDM domain classifier it executes", () => {
  assert.match(vibpe, /classifyVedmIssueDomain[\s\S]*from "@\/lib\/vyndi-risk-model"/);
});
