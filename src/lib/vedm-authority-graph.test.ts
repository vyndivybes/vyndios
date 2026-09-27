import assert from "node:assert/strict";
import test from "node:test";
import {
  compileVedmAuthorityGraph,
  createVedmR3aSeed,
  evaluateAuthorityMutation,
  traceAuthorityPath,
} from "./vedm-authority-graph.ts";

test("R3-A resolves E-K75 as the single controlling frame-geometry authority", () => {
  const graph = compileVedmAuthorityGraph(createVedmR3aSeed(), "2026-09-28");

  assert.equal(graph.valid, true);
  assert.equal(graph.authorityByDomain.frame_geometry?.id, "VEDM-301-R539-EK75");
  assert.equal(graph.authorityByDomain.frame_geometry?.lifecycle, "controlling");
  assert.equal(graph.releaseReady, false);
});

test("R3-A keeps FK75 development-only and Rev 5.3.8 superseded", () => {
  const graph = compileVedmAuthorityGraph(createVedmR3aSeed(), "2026-09-28");

  const fk75 = graph.nodeById.get("VEDM-301-R54-FK75");
  const r538 = graph.nodeById.get("VEDM-301-R538");

  assert.equal(fk75?.lifecycle, "development");
  assert.equal(fk75?.releaseEffect, "none");
  assert.equal(r538?.lifecycle, "superseded");
  assert.equal(r538?.releaseEffect, "none");
  assert.equal(graph.authorityByDomain.frame_geometry?.id, "VEDM-301-R539-EK75");
});

test("R3-A refuses silent fallback when current evidence is missing", () => {
  const seed = createVedmR3aSeed();
  seed.nodes = seed.nodes.filter((node) => node.id !== "EVID-EK75-DRAWING-SET");

  const graph = compileVedmAuthorityGraph(seed, "2026-09-28");

  assert.equal(graph.releaseReady, false);
  assert.equal(graph.authorityByDomain.frame_geometry?.id, "VEDM-301-R539-EK75");
  assert.ok(graph.issues.some((issue) => issue.code === "INSUFFICIENT_EVIDENCE"));
  assert.ok(graph.issues.every((issue) => !/fallback/i.test(issue.message)));
});

test("R3-A rejects multiple effective controlling authorities for one domain", () => {
  const seed = createVedmR3aSeed();
  seed.nodes.push({
    id: "BAD-CONTROLLING-GEOMETRY",
    kind: "document_revision",
    domain: "frame_geometry",
    title: "Conflicting geometry",
    revision: "BAD",
    lifecycle: "controlling",
    effectiveFrom: "2026-09-28",
    sourceRef: "TEST",
    releaseEffect: "none",
  });

  const graph = compileVedmAuthorityGraph(seed, "2026-09-28");

  assert.equal(graph.valid, false);
  assert.ok(graph.issues.some((issue) => issue.code === "MULTIPLE_CONTROLLING_AUTHORITIES"));
});

test("R3-A blocks release when any required release gate is open or evidence is insufficient", () => {
  const graph = compileVedmAuthorityGraph(createVedmR3aSeed(), "2026-09-28");

  assert.equal(graph.releaseReady, false);
  assert.ok(graph.blockingGateIds.includes("G5-FEA"));
  assert.ok(graph.blockingGateIds.includes("G10-FORMAL-RELEASE"));
});

test("R3-A traces requirement to design object, evidence and release gate deterministically", () => {
  const graph = compileVedmAuthorityGraph(createVedmR3aSeed(), "2026-09-28");
  const trace = traceAuthorityPath(graph, "REQ-FRAME-GEOMETRY", "G10-FORMAL-RELEASE");

  assert.deepEqual(trace.map((node) => node.id), [
    "REQ-FRAME-GEOMETRY",
    "OBJ-EK75-FRAME-GEOMETRY",
    "EVID-EK75-DOSSIER",
    "G10-FORMAL-RELEASE",
  ]);
});

test("R3-A denies VIBPE authority mutation while allowing human change preparation", () => {
  const vibpe = evaluateAuthorityMutation({
    actorType: "vibpe",
    action: "make_effective",
    targetNodeId: "VEDM-301-R54-FK75",
  });
  const human = evaluateAuthorityMutation({
    actorType: "human_engineering_authority",
    action: "prepare_change",
    targetNodeId: "VEDM-301-R54-FK75",
  });

  assert.equal(vibpe.allowed, false);
  assert.equal(vibpe.reason, "HUMAN_APPROVAL_REQUIRED");
  assert.equal(human.allowed, true);
});

test("R3-A rejects broken graph relationships instead of inferring authority", () => {
  const seed = createVedmR3aSeed();
  seed.edges.push({
    from: "VEDM-301-R539-EK75",
    to: "MISSING-EVIDENCE",
    relation: "EVIDENCED_BY",
  });

  const graph = compileVedmAuthorityGraph(seed, "2026-09-28");

  assert.equal(graph.valid, false);
  assert.ok(graph.issues.some((issue) => issue.code === "BROKEN_AUTHORITY_EDGE"));
});

test("R3-A seed covers the controlled engineering thread with pinned VEDM provenance", () => {
  const seed = createVedmR3aSeed();
  const domains = new Set(seed.nodes.map((node) => node.domain));

  assert.equal(seed.sourceRepository, "vayu-shastr/veloxis-engineering-design-manual");
  assert.equal(seed.sourceCommit, "49fdac757534c6e42a0c5c29c43a2a6e35d637d2");
  for (const domain of [
    "frame_geometry",
    "cad_step",
    "drawing_evidence",
    "material_laminate",
    "fea_evidence",
    "cfd_evidence",
    "validation_test",
    "bom_interface",
  ]) {
    assert.ok(domains.has(domain), `Missing R3-A authority domain ${domain}`);
  }
});
