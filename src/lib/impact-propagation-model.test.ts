import assert from "node:assert/strict";
import { test } from "node:test";
import { compileVedmAuthorityGraph, type VedmAuthoritySeed } from "./vedm-authority-graph.ts";
import { analyzeEngineeringImpact } from "./impact-propagation-model.ts";

const seed: VedmAuthoritySeed = {
  schema: "VYNDI_VEDM_AUTHORITY_GRAPH_V1",
  sourceRepository: "test/repo",
  sourceCommit: "abc",
  nodes: [
    { id:"AUTH", kind:"document_revision", domain:"geometry", title:"Authority", lifecycle:"controlling", sourceRef:"AUTH", releaseEffect:"none", effectiveFrom:"2026-01-01" },
    { id:"OBJ", kind:"engineering_object", domain:"geometry", title:"Geometry object", lifecycle:"controlling", sourceRef:"OBJ", releaseEffect:"none" },
    { id:"EVID", kind:"evidence", domain:"geometry", title:"Evidence", lifecycle:"evidence", sourceRef:"EVID", releaseEffect:"supports_release", evidenceState:"sufficient" },
    { id:"GATE", kind:"release_gate", domain:"release", title:"Gate", lifecycle:"gate", sourceRef:"GATE", releaseEffect:"release_authority", gateStatus:"closed", requiredEvidenceIds:["EVID"] },
    { id:"DERIVED", kind:"document_revision", domain:"geometry", title:"Derived study", lifecycle:"development", sourceRef:"DERIVED", releaseEffect:"none" },
  ],
  edges: [
    { from:"AUTH", to:"OBJ", relation:"CONTROLS" },
    { from:"OBJ", to:"EVID", relation:"EVIDENCED_BY" },
    { from:"EVID", to:"GATE", relation:"VALIDATED_BY" },
    { from:"DERIVED", to:"AUTH", relation:"DERIVES_FROM" },
  ],
};

test("impact propagation reaches objects evidence release gates and reverse-derived studies", () => {
  const graph = compileVedmAuthorityGraph(seed, "2026-10-04");
  const result = analyzeEngineeringImpact(graph, "AUTH");
  assert.equal(result.valid, true);
  assert.deepEqual(result.engineeringObjectIds, ["OBJ"]);
  assert.deepEqual(result.evidenceIds, ["EVID"]);
  assert.deepEqual(result.releaseGateIds, ["GATE"]);
  assert.ok(result.documentRevisionIds.includes("DERIVED"));
  assert.equal(result.evidenceSuspectCount, 1);
  assert.equal(result.releaseGateReviewCount, 1);
});

test("unknown source nodes fail closed", () => {
  const graph = compileVedmAuthorityGraph(seed, "2026-10-04");
  const result = analyzeEngineeringImpact(graph, "MISSING");
  assert.equal(result.valid, false);
  assert.match(result.issues[0] ?? "", /not present/i);
});

test("SUPERSEDES does not make historical records active downstream impact", () => {
  const graph = compileVedmAuthorityGraph({
    ...seed,
    nodes: [
      ...seed.nodes,
      { id:"OLD", kind:"document_revision", domain:"geometry", title:"Old", lifecycle:"superseded", sourceRef:"OLD", releaseEffect:"none" },
    ],
    edges: [...seed.edges, { from:"AUTH", to:"OLD", relation:"SUPERSEDES" }],
  }, "2026-10-04");
  const result = analyzeEngineeringImpact(graph, "AUTH");
  assert.equal(result.affectedNodes.some((node) => node.id === "OLD"), false);
});

test("REQUIRES is treated as dependency-coupled for change impact", () => {
  const graph = compileVedmAuthorityGraph({
    ...seed,
    nodes: [
      ...seed.nodes,
      { id:"INPUT", kind:"engineering_object", domain:"material", title:"Input", lifecycle:"controlling", sourceRef:"INPUT", releaseEffect:"none" },
    ],
    edges: [...seed.edges, { from:"OBJ", to:"INPUT", relation:"REQUIRES" }],
  }, "2026-10-04");
  const fromInput = analyzeEngineeringImpact(graph, "INPUT");
  assert.ok(fromInput.affectedNodes.some((node) => node.id === "OBJ"));
});
