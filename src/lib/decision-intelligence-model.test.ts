import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDecisionIntelligence } from "./decision-intelligence-model.ts";

test("configuration/evidence blockers outrank optimization-style options", () => {
  const result = buildDecisionIntelligence({
    readiness: {
      taskReadinessPct: 72,
      evidenceCompletenessPct: 68,
      evidenceConfidencePct: 74,
      configurationBlockers: 2,
      activeRiskCount: 4,
      highestRiskExposureScore: 9,
    },
    risks: [
      { id:"RISK-MAT", domain:"material", exposureScore:9, title:"Material authority open", sourceReference:"VEDM:MATERIAL-01" },
    ],
    monteCarlo: { available:true, p50Days:100, p80Days:112, p95Days:126, sourceReference:"MC-1" },
    supplier: { singleSourceSkuCount:1, singleSourceSkus:["PREPREG-T700"], sourceReference:"SUP-RISK-1" },
    quality: { openCriticalNcr:0, openMajorNcr:1, capabilityGapCount:2, sourceReference:"QUALITY-1" },
  });

  assert.equal(result.options[0]?.decisionClass, "evidence_closure");
  assert.equal(result.primaryAdvisoryOptionId, result.options[0]?.id);
  assert.equal(result.rankingMethod, "GOVERNANCE_PRIORITY_NOT_UTILITY_OPTIMIZATION");
  assert.equal(result.options.some((o)=>o.decisionClass==="supply_resilience"), true);
  assert.equal(result.options.some((o)=>o.decisionClass==="schedule_protection"), true);
});

test("engine never invents unsupported financial or technical benefits", () => {
  const result = buildDecisionIntelligence({
    readiness: {
      taskReadinessPct:null,
      evidenceCompletenessPct:null,
      evidenceConfidencePct:null,
      configurationBlockers:0,
      activeRiskCount:0,
      highestRiskExposureScore:null,
    },
    risks: [],
    monteCarlo: { available:false, p50Days:null, p80Days:null, p95Days:null, sourceReference:null },
    supplier: { singleSourceSkuCount:0, singleSourceSkus:[], sourceReference:null },
    quality: { openCriticalNcr:0, openMajorNcr:0, capabilityGapCount:0, sourceReference:null },
  });

  assert.equal(result.options.length, 1);
  assert.equal(result.options[0]?.decisionClass, "maintain_baseline");
  assert.equal(result.options[0]?.quantifiedBenefit, null);
  assert.match(result.options[0]?.authorityRequired ?? "", /human/i);
});

test("schedule tail option cites captured Monte Carlo evidence", () => {
  const result = buildDecisionIntelligence({
    readiness: {
      taskReadinessPct:100,
      evidenceCompletenessPct:100,
      evidenceConfidencePct:90,
      configurationBlockers:0,
      activeRiskCount:0,
      highestRiskExposureScore:null,
    },
    risks: [],
    monteCarlo: { available:true, p50Days:80, p80Days:93, p95Days:110, sourceReference:"MC-RUN-42" },
    supplier: { singleSourceSkuCount:0, singleSourceSkus:[], sourceReference:null },
    quality: { openCriticalNcr:0, openMajorNcr:0, capabilityGapCount:0, sourceReference:null },
  });
  const schedule = result.options.find((o)=>o.decisionClass==="schedule_protection");
  assert.ok(schedule);
  assert.deepEqual(schedule?.evidenceReferences, ["MC-RUN-42"]);
  assert.match(schedule?.consequences[0] ?? "", /P50 80.*P95 110/);
});
