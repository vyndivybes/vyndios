import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { assessAdvancedOptimizerLineage } from "../src/lib/advanced-optimizer-lineage.ts";

const packet = { id:"packet-1",parent_ibpe_run_id:"ibpe-1",source_sha:"source-abc" };
const ibpe = { id:"ibpe-1",source_sha:"source-abc" };

test("matching deployed source, latest IBPE and packet permit the preparation indicator",()=>{
 const result=assessAdvancedOptimizerLineage(packet,ibpe,"source-abc");
 assert.equal(result.ready,true);
 assert.deepEqual(result.issues,[]);
});

test("stale deployed packet is blocked before Run (October packet, November deployment)",()=>{
 const result=assessAdvancedOptimizerLineage(packet,ibpe,"source-new");
 assert.equal(result.ready,false);
 assert.equal(result.issues[0].code,"STALE_OPTIMIZER_PACKET_SOURCE");
 assert.match(result.issues[0].message,/Run governed IBPE|current deployment/i);
});

test("mismatched latest IBPE and packet parent cannot show READY",()=>{
 assert.deepEqual(assessAdvancedOptimizerLineage(packet,{id:"ibpe-2",source_sha:"source-abc"},"source-abc").issues.map(x=>x.code),["STALE_OPTIMIZER_IBPE_PARENT"]);
 assert.deepEqual(assessAdvancedOptimizerLineage(packet,{id:"ibpe-1",source_sha:"source-other"},"source-abc").issues.map(x=>x.code),["STALE_OPTIMIZER_IBPE_SOURCE"]);
});

test("missing latest governed IBPE or source SHA fails closed",()=>{
 assert.equal(assessAdvancedOptimizerLineage(packet,null,"source-abc").ready,false);
 assert.equal(assessAdvancedOptimizerLineage(packet,ibpe,"").issues[0].code,"MISSING_DEPLOYED_SOURCE_SHA");
 assert.equal(assessAdvancedOptimizerLineage({...packet,source_sha:""},ibpe,"source-abc").ready,false);
});

test("control page preserves computed packet provenance while retiring the demo simulation link",async()=>{
 const control=await readFile(new URL("../src/lib/advanced-optimizer-control.ts",import.meta.url),"utf8");
 const page=await readFile(new URL("../src/routes/command/ibpe-operating-workspace_.optimizer.tsx",import.meta.url),"utf8");
 assert.match(control,/assessAdvancedOptimizerLineage\(/);
 assert.match(control,/source_sha/);
 assert.doesNotMatch(control,/readyForGovernedOptimization:\s*true/);
 assert.doesNotMatch(page,/\/command\/ibpe-operating-workspace\/simulation/);
 assert.match(page,/Demo orders with an R2\/R3 card mismatch remain on HOLD/);
});
