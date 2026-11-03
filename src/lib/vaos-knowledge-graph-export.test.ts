import test from "node:test";
import assert from "node:assert/strict";
import { projectVedmAuthorityGraphForVaos } from "./vaos-knowledge-graph-export.ts";

test("signed VAOS view projects real VEDM seed with pinned provenance but never grants engineering release", () => {
 const view=projectVedmAuthorityGraphForVaos("2026-09-28");
 assert.equal(view.schemaVersion,"VYNDI_VEDM_AUTHORITY_READ_V1");
 assert.equal(view.sourceRepository,"vayu-shastr/veloxis-engineering-design-manual");
 assert.match(view.sourceCommit,/^[a-f0-9]{40}$/);
 assert.equal(view.readOnly,true);
 assert.equal(view.actionAuthorized,false);
 assert.equal(view.currentRuntimeAuthorityVerified,false);
 assert.equal(view.releaseReady,false);
 assert.ok(view.nodes.length>0);
 assert.ok(view.edges.length>0);
 assert.ok(view.nodes.some(x=>x.id==="VEDM-301-R539-EK75"));
 assert.ok(view.edges.every(e=>view.nodes.some(n=>n.id===e.from)&&view.nodes.some(n=>n.id===e.to)));
 assert.ok(view.blockingGateIds.length>0);
 assert.ok(view.nodes.every(n=>typeof n.id==="string"&&typeof n.sourceRef==="string"));
});
test("rejects invalid date and refuses invented current authority",()=>{
 assert.throws(()=>projectVedmAuthorityGraphForVaos("2030-03-40"),/VAOS_VEDM_SNAPSHOT_INVALID_DATE/);
 assert.throws(()=>projectVedmAuthorityGraphForVaos("bad-date"),/VAOS_VEDM_SNAPSHOT_INVALID_DATE/);
});
