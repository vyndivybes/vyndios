import assert from "node:assert/strict";
import { test } from "node:test";
import { buildReadinessAssessment } from "./readiness-model.ts";

test("readiness is task completion, evidence confidence is separate", () => {
  const result = buildReadinessAssessment({
    tasks: [
      { id:"A", domain:"engineering", status:"complete", readinessRequired:true },
      { id:"B", domain:"engineering", status:"in_progress", readinessRequired:true },
      { id:"C", domain:"validation", status:"planned", readinessRequired:true },
    ],
    evidence: [
      { id:"E1", domain:"engineering", state:"sufficient", confidence:0.9, required:true },
      { id:"E2", domain:"engineering", state:"insufficient", confidence:0.4, required:true },
      { id:"E3", domain:"validation", state:"unrated", confidence:null, required:true },
    ],
    activeRisks: [
      { id:"R1", exposureScore:9, status:"open" },
      { id:"R2", exposureScore:3, status:"mitigating" },
    ],
    configurationBlockers: 1,
  });

  assert.equal(result.taskReadinessPct, 33.3);
  assert.equal(result.evidenceCompletenessPct, 33.3);
  assert.equal(result.evidenceConfidencePct, 65);
  assert.equal(result.evidenceConfidenceCoveragePct, 66.7);
  assert.equal(result.highestRiskExposureScore, 9);
  assert.equal(result.configurationBlockers, 1);
  assert.equal(result.overallReadinessPct, null);
});

test("waived governed task counts as dispositioned but is reported separately", () => {
  const result = buildReadinessAssessment({
    tasks: [
      { id:"A", domain:"program", status:"complete", readinessRequired:true },
      { id:"B", domain:"program", status:"waived", readinessRequired:true },
    ],
    evidence: [],
    activeRisks: [],
    configurationBlockers: 0,
  });
  assert.equal(result.taskReadinessPct, 100);
  assert.equal(result.waivedTaskCount, 1);
});

test("no evidence produces null evidence scores instead of false confidence", () => {
  const result = buildReadinessAssessment({
    tasks: [{ id:"A", domain:"program", status:"planned", readinessRequired:true }],
    evidence: [],
    activeRisks: [],
    configurationBlockers: 0,
  });
  assert.equal(result.evidenceCompletenessPct, null);
  assert.equal(result.evidenceConfidencePct, null);
  assert.equal(result.evidenceConfidenceCoveragePct, null);
});

test("domain readiness is calculated independently", () => {
  const result = buildReadinessAssessment({
    tasks: [
      { id:"A", domain:"geometry", status:"complete", readinessRequired:true },
      { id:"B", domain:"geometry", status:"planned", readinessRequired:true },
      { id:"C", domain:"material", status:"complete", readinessRequired:true },
    ],
    evidence: [],
    activeRisks: [],
    configurationBlockers: 0,
  });
  assert.equal(result.domainReadiness.geometry?.readinessPct, 50);
  assert.equal(result.domainReadiness.material?.readinessPct, 100);
});

test("a composite overall index is deliberately withheld until governed weights exist", () => {
  const result = buildReadinessAssessment({
    tasks: [{ id:"A", domain:"program", status:"complete", readinessRequired:true }],
    evidence: [{ id:"E", domain:"program", state:"sufficient", confidence:1, required:true }],
    activeRisks: [],
    configurationBlockers: 0,
  });
  assert.equal(result.overallReadinessPct, null);
  assert.match(result.overallReadinessReason, /governed weighting/i);
});
