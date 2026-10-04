import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const [metadata, workflow, riskPage, governanceQueries, migration, smoke] = await Promise.all([
  read("src/lib/page-metadata.ts"),
  read("src/lib/operating-workflow.ts"),
  read("src/routes/command/risk.tsx"),
  read("src/lib/vibpe-governance-queries.ts"),
  read("migrations/0100_vyndi_risk_engine.sql"),
  read("scripts/vyndi-production-playwright-smoke.mjs"),
]);

test("Product Intelligence is registered and visible from canonical Command navigation", () => {
  assert.match(metadata, /"\/command\/intelligence": meta\(/);
  assert.match(workflow, /to: "\/command\/intelligence", label: "07 · Product Intelligence"/);
});

test("canonical Risk surface exposes heatmap, FMEA, evidence confidence and VEDM-derived signals", () => {
  assert.match(riskPage, /Risk Heatmap/);
  assert.match(riskPage, /FMEA/);
  assert.match(riskPage, /Evidence confidence/);
  assert.match(riskPage, /VEDM Evidence & Configuration Risk/);
  assert.match(riskPage, /Add governed risk/);
});

test("risk migration preserves explicit provenance and only computes FMEA when S O D exist", () => {
  assert.match(migration, /provenance_class/);
  assert.match(migration, /evidence_confidence/);
  assert.match(migration, /severity is not null and r\.occurrence is not null and r\.detection is not null/);
  assert.match(migration, /no probability is inferred/i);
});

test("VIBPE has a read-only governed risk answer and does not invent probability", () => {
  assert.match(governanceQueries, /isRiskIntelligenceQuestion/);
  assert.match(governanceQueries, /vyndi_risk_intelligence/);
  assert.match(governanceQueries, /probability not inferred/);
  assert.match(governanceQueries, /acceptance\/closure stays with authorised humans/);
});

test("production Playwright smoke covers both Product Intelligence and Risk", () => {
  assert.match(smoke, /"\/command\/intelligence"/);
  assert.match(smoke, /"\/command\/risk"/);
  assert.match(smoke, /Product Intelligence/);
  assert.match(smoke, /Risk Register|VYNDI Risk Engine/);
});
