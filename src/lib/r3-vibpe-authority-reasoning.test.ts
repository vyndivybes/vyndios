import assert from "node:assert/strict";
import test from "node:test";
import { compileVedmAuthorityGraph, createVedmR3aSeed } from "./vedm-authority-graph.ts";
import { reasonWithVedmAuthority, assessAuthorityImpact } from "./r3-vibpe-authority-reasoning.ts";

test("R3-D identifies controlling, superseded and development records without ranking them", () => {
  const graph=compileVedmAuthorityGraph(createVedmR3aSeed(),"2026-09-28");
  assert.equal(reasonWithVedmAuthority(graph,"VEDM-301-R539-EK75").classification,"CURRENT_AUTHORITY");
  assert.equal(reasonWithVedmAuthority(graph,"VEDM-301-R538").classification,"SUPERSEDED");
  assert.equal(reasonWithVedmAuthority(graph,"VEDM-301-R54-FK75").classification,"DEVELOPMENT_NOT_RELEASED");
});

test("R3-D reports insufficient evidence instead of inventing closure", () => {
  const graph=compileVedmAuthorityGraph(createVedmR3aSeed(),"2026-09-28");
  const result=reasonWithVedmAuthority(graph,"EVID-FK75-NATIVE-FEA");
  assert.equal(result.classification,"INSUFFICIENT_EVIDENCE");
  assert.equal(result.mayApproveOrRelease,false);
  assert.ok(result.sources.length>0);
});

test("R3-D deterministic impact assessment follows authority edges and never mutates authority", () => {
  const graph=compileVedmAuthorityGraph(createVedmR3aSeed(),"2026-09-28");
  const impact=assessAuthorityImpact(graph,"OBJ-EK75-FRAME-GEOMETRY");
  assert.ok(impact.affectedNodeIds.includes("EVID-EK75-DOSSIER"));
  assert.ok(impact.affectedNodeIds.includes("G10-FORMAL-RELEASE"));
  assert.equal(impact.mutationPerformed,false);
});
