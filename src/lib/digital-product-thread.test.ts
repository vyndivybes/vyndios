import assert from "node:assert/strict";
import test from "node:test";
import { compileVedmAuthorityGraph, createVedmR3aSeed } from "./vedm-authority-graph.ts";
import {
  compileDigitalProductThread,
  traceDigitalProductThread,
  assessDigitalThreadImpact,
  type RuntimeProductThreadInput,
} from "./digital-product-thread.ts";

const graph = compileVedmAuthorityGraph(createVedmR3aSeed(), "2026-09-28");
const runtime: RuntimeProductThreadInput = {
  engineeringBaselineId: "ENG-ALTITUDE-R539",
  bomRevisionId: "BOM-R12",
  jobCardIds: ["JC-001"],
  qualityReleaseIds: ["QR-001"],
  shipmentIds: ["SHIP-001"],
};

test("R3-E creates an end-to-end governed engineering/product thread", () => {
  const thread = compileDigitalProductThread(graph, runtime);
  for (const id of [
    "REQ-FRAME-GEOMETRY",
    "VEDM-301-R539-EK75",
    "OBJ-EK75-CAD-STEP",
    "EVID-EK75-DRAWING-SET",
    "VEL-PLY-541",
    "EVID-FK75-NATIVE-FEA",
    "EVID-ISO4210",
    "ENG-ALTITUDE-R539",
    "BOM-R12",
    "JC-001",
    "QR-001",
    "SHIP-001",
  ]) assert.ok(thread.nodeById.has(id), `Missing thread node ${id}`);
});

test("R3-E trace crosses authority, baseline, BOM, execution and quality lineage", () => {
  const thread = compileDigitalProductThread(graph, runtime);
  const trace = traceDigitalProductThread(thread, "REQ-FRAME-GEOMETRY", "QR-001");
  assert.equal(trace[0]?.id, "REQ-FRAME-GEOMETRY");
  assert.equal(trace.at(-1)?.id, "QR-001");
  assert.ok(trace.some((node) => node.id === "ENG-ALTITUDE-R539"));
  assert.ok(trace.some((node) => node.id === "BOM-R12"));
  assert.ok(trace.some((node) => node.id === "JC-001"));
});

test("R3-E does not invent missing downstream records", () => {
  const thread = compileDigitalProductThread(graph, { ...runtime, qualityReleaseIds: [] });
  assert.equal(thread.nodeById.has("QR-001"), false);
  assert.ok(thread.gaps.some((gap) => gap.code === "QUALITY_RELEASE_MISSING"));
});

test("R3-E retains superseded history but marks only current authority as active", () => {
  const thread = compileDigitalProductThread(graph, runtime);
  assert.equal(thread.nodeById.get("VEDM-301-R538")?.current, false);
  assert.equal(thread.nodeById.get("VEDM-301-R539-EK75")?.current, true);
});

test("R3-E impact analysis identifies downstream execution records affected by authority change", () => {
  const thread = compileDigitalProductThread(graph, runtime);
  const impact = assessDigitalThreadImpact(thread, "VEDM-301-R539-EK75");
  assert.ok(impact.affectedNodeIds.includes("ENG-ALTITUDE-R539"));
  assert.ok(impact.affectedNodeIds.includes("BOM-R12"));
  assert.ok(impact.affectedNodeIds.includes("JC-001"));
  assert.ok(impact.affectedNodeIds.includes("QR-001"));
});
