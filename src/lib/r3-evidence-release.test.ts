import assert from "node:assert/strict";
import test from "node:test";
import { compileVedmAuthorityGraph, createVedmR3aSeed } from "./vedm-authority-graph.ts";
import { compileEngineeringReleasePacket } from "./r3-evidence-release.ts";

test("R3-C blocks release when VEDM gates or evidence remain open", () => {
  const graph=compileVedmAuthorityGraph(createVedmR3aSeed(),"2026-09-28");
  const packet=compileEngineeringReleasePacket({graph,evidenceReceipts:[],workflowStatus:"approved"});
  assert.equal(packet.verdict,"BLOCKED");
  assert.equal(packet.releaseAuthority,"HUMAN_CONFIGURATION_AUTHORITY");
  assert.ok(packet.blockers.some((b)=>b.code==="OPEN_RELEASE_GATE"));
});

test("R3-C refuses stale or mismatched authority provenance", () => {
  const graph=compileVedmAuthorityGraph(createVedmR3aSeed(),"2026-09-28");
  const packet=compileEngineeringReleasePacket({graph,evidenceReceipts:[{id:"R1",sourceCommit:"wrong",gateId:"G10-FORMAL-RELEASE",state:"sufficient",fingerprint:"f1"}],workflowStatus:"approved"});
  assert.equal(packet.verdict,"BLOCKED");
  assert.ok(packet.blockers.some((b)=>b.code==="PROVENANCE_MISMATCH"));
});

test("R3-C never auto-releases even when a synthetic fully closed graph is supplied", () => {
  const seed=createVedmR3aSeed();
  for(const node of seed.nodes){
    if(node.kind==="release_gate") node.gateStatus="closed";
    if(node.kind==="evidence") node.evidenceState="sufficient";
  }
  const graph=compileVedmAuthorityGraph(seed,"2026-09-28");
  const packet=compileEngineeringReleasePacket({graph,evidenceReceipts:[],workflowStatus:"approved"});
  assert.equal(packet.verdict,"READY_FOR_HUMAN_RELEASE");
  assert.equal(packet.autoReleased,false);
});
