import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildRiskHeatmap,
  classifyVedmIssueDomain,
  computeFmeaRpn,
  computeRiskExposure,
  deriveVedmRisk,
  evidenceConfidenceState,
} from "./vyndi-risk-model.ts";

test("FMEA RPN is calculated only from explicit S/O/D inputs", () => {
  assert.equal(computeFmeaRpn({ severity: 9, occurrence: 3, detection: 5 }), 135);
  assert.equal(computeFmeaRpn({ severity: 9, occurrence: null, detection: 5 }), null);
});

test("risk exposure uses governed ordinal likelihood and impact without inventing probability", () => {
  const exposure = computeRiskExposure({ likelihood: "High", impact: "High" });
  assert.deepEqual(exposure, { score: 9, band: "critical" });

  const medium = computeRiskExposure({ likelihood: "Med", impact: "High" });
  assert.deepEqual(medium, { score: 6, band: "high" });
});

test("evidence confidence remains separate from risk exposure", () => {
  assert.equal(evidenceConfidenceState(0.42), "low");
  assert.equal(evidenceConfidenceState(0.74), "medium");
  assert.equal(evidenceConfidenceState(0.9), "high");
  assert.equal(evidenceConfidenceState(null), "unrated");
});

test("VEDM issues become derived risks without fabricated probability", () => {
  assert.equal(classifyVedmIssueDomain("INSUFFICIENT_EVIDENCE"), "evidence");
  assert.equal(classifyVedmIssueDomain("MULTIPLE_CONTROLLING_AUTHORITIES"), "configuration");

  const risk = deriveVedmRisk({
    severity: "blocker",
    code: "INSUFFICIENT_EVIDENCE",
    nodeId: "G3-MATERIAL",
    domain: "material_laminate",
    message: "Material evidence is insufficient.",
  });

  assert.equal(risk.domain, "evidence");
  assert.equal(risk.provenanceClass, "derived");
  assert.equal(risk.probability, null);
  assert.equal(risk.status, "open");
  assert.deepEqual(risk.affectedObjects, ["G3-MATERIAL"]);
});

test("heatmap groups active risks by governed likelihood and impact", () => {
  const heatmap = buildRiskHeatmap([
    { likelihood: "High", impact: "High", status: "open" },
    { likelihood: "High", impact: "High", status: "mitigating" },
    { likelihood: "Low", impact: "Med", status: "closed" },
    { likelihood: "Med", impact: "High", status: "open" },
  ]);

  assert.equal(heatmap["High|High"], 2);
  assert.equal(heatmap["Med|High"], 1);
  assert.equal(heatmap["Low|Med"], 0);
});
