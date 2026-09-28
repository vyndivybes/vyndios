import assert from "node:assert/strict";
import test from "node:test";
import { compileVedmAuthorityGraph, createVedmR3aSeed } from "./vedm-authority-graph.ts";
import { compileDigitalProductThread } from "./r3-digital-product-thread.ts";

test("R3-E joins product, engineering authority, evidence, ECR and quality lineage", () => {
  const graph=compileVedmAuthorityGraph(createVedmR3aSeed(),"2026-09-28");
  const thread=compileDigitalProductThread({
    graph,
    product:{familyCode:"altitude",variantId:"apex-ultegra-di2"},
    engineeringBaselineId:"ENG-ALTITUDE-C2",
    engineeringChangeIds:["ECR-FK75"],
    evidenceReceiptIds:["ENG-EVID-1"],
    bomRevision:"BOM-R1",
    jobCardIds:["JC-1"],
    travellerIds:["TR-1"],
    qualityReleaseIds:["QR-1"],
  });
  assert.equal(thread.authorityNodeId,"VEDM-301-R539-EK75");
  assert.deepEqual(thread.lineage.product.variantId,"apex-ultegra-di2");
  assert.ok(thread.links.some((l)=>l.type==="ENGINEERING_CHANGE"));
  assert.ok(thread.links.some((l)=>l.type==="QUALITY_RELEASE"));
});

test("R3-E surfaces missing lineage instead of fabricating links", () => {
  const graph=compileVedmAuthorityGraph(createVedmR3aSeed(),"2026-09-28");
  const thread=compileDigitalProductThread({graph,product:{familyCode:"altitude",variantId:"apex-red-axs"},engineeringChangeIds:[],evidenceReceiptIds:[],jobCardIds:[],travellerIds:[],qualityReleaseIds:[]});
  assert.equal(thread.complete,false);
  assert.ok(thread.gaps.includes("ENGINEERING_BASELINE"));
  assert.ok(thread.gaps.includes("EVIDENCE_RECEIPT"));
  assert.ok(thread.gaps.includes("QUALITY_RELEASE"));
});
