import assert from "node:assert/strict";
import test from "node:test";
import { compileVedmAuthorityGraph, createVedmR3aSeed } from "./vedm-authority-graph.ts";
import {
  evaluateEngineeringRelease,
  type ReleaseEvidenceReceipt,
} from "./engineering-release-readiness.ts";

function closedGraph() {
  const seed = createVedmR3aSeed();
  seed.nodes = seed.nodes.map((node) => {
    if (node.kind === "evidence") return { ...node, evidenceState: "sufficient" as const };
    if (node.kind === "release_gate") return { ...node, gateStatus: "closed" as const };
    return node;
  });
  return compileVedmAuthorityGraph(seed, "2026-09-28");
}

const evidence: ReleaseEvidenceReceipt[] = [
  { fingerprint: "ev-a", nodeId: "EVID-EK75-DOSSIER", sourceCommit: "b874cde910ce462724b63bac6b7e7f79e7d68785", status: "accepted" },
  { fingerprint: "ev-b", nodeId: "EVID-FK75-NATIVE-FEA", sourceCommit: "b874cde910ce462724b63bac6b7e7f79e7d68785", status: "accepted" },
];

test("R3-C refuses release while any authority graph gate remains open", () => {
  const graph = compileVedmAuthorityGraph(createVedmR3aSeed(), "2026-09-28");
  const result = evaluateEngineeringRelease({
    graph,
    workflowState: "approved",
    actorAuthority: "configuration_authority",
    evidence,
  });
  assert.equal(result.releasable, false);
  assert.ok(result.blockers.includes("AUTHORITY_GRAPH_NOT_RELEASE_READY"));
});

test("R3-C release requires approved workflow and configuration authority", () => {
  const graph = closedGraph();
  const wrongWorkflow = evaluateEngineeringRelease({
    graph,
    workflowState: "pending_approval",
    actorAuthority: "configuration_authority",
    evidence,
  });
  assert.equal(wrongWorkflow.releasable, false);
  assert.ok(wrongWorkflow.blockers.includes("WORKFLOW_NOT_APPROVED"));

  const wrongActor = evaluateEngineeringRelease({
    graph,
    workflowState: "approved",
    actorAuthority: "engineering_authority",
    evidence,
  });
  assert.equal(wrongActor.releasable, false);
  assert.ok(wrongActor.blockers.includes("CONFIGURATION_AUTHORITY_REQUIRED"));
});

test("R3-C rejects stale or non-accepted evidence and keeps evidence immutable by fingerprint", () => {
  const graph = closedGraph();
  const stale = evaluateEngineeringRelease({
    graph,
    workflowState: "approved",
    actorAuthority: "configuration_authority",
    evidence: [
      ...evidence,
      { fingerprint: "ev-stale", nodeId: "EVID-ISO4210", sourceCommit: "old-commit", status: "accepted" },
    ],
  });
  assert.equal(stale.releasable, false);
  assert.ok(stale.blockers.includes("STALE_EVIDENCE_SOURCE"));

  const duplicate = evaluateEngineeringRelease({
    graph,
    workflowState: "approved",
    actorAuthority: "configuration_authority",
    evidence: [...evidence, evidence[0]],
  });
  assert.equal(duplicate.releasable, false);
  assert.ok(duplicate.blockers.includes("DUPLICATE_EVIDENCE_FINGERPRINT"));
});

test("R3-C release fingerprint is deterministic and changes when evidence changes", () => {
  const graph = closedGraph();
  const a = evaluateEngineeringRelease({
    graph,
    workflowState: "approved",
    actorAuthority: "configuration_authority",
    evidence,
  });
  const b = evaluateEngineeringRelease({
    graph,
    workflowState: "approved",
    actorAuthority: "configuration_authority",
    evidence: [...evidence].reverse(),
  });
  assert.equal(a.releaseFingerprint, b.releaseFingerprint);

  const c = evaluateEngineeringRelease({
    graph,
    workflowState: "approved",
    actorAuthority: "configuration_authority",
    evidence: [...evidence, { fingerprint: "ev-c", nodeId: "EVID-ISO4210", sourceCommit: graph.sourceCommit, status: "accepted" }],
  });
  assert.notEqual(a.releaseFingerprint, c.releaseFingerprint);
});

test("R3-C can become releasable only when graph, workflow, actor and evidence provenance are all valid", () => {
  const graph = closedGraph();
  const result = evaluateEngineeringRelease({
    graph,
    workflowState: "approved",
    actorAuthority: "configuration_authority",
    evidence,
  });
  assert.equal(result.releasable, true);
  assert.deepEqual(result.blockers, []);
});
