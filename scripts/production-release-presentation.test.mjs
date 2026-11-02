import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
test("known demo release fields never count as real physical approval",async()=>{
 const {jobCardReleasePresentation}=await import("../src/lib/production-release-presentation.ts");
 const cases=[
  {sales_order_id:"SO-02ca96da-5206-4b94-9fef-062a2a992919",status:"released",approved_by:null,approved_at:null,sales_order_revision:2},
  {sales_order_id:"SO-800d46b7-d354-4e80-a3a9-d6c2207be5bf",status:"hold",approved_by:"command:admin",approved_at:"2026-09-10",sales_order_revision:2},
 ];
 for(const c of cases){
  const result=jobCardReleasePresentation(c,3);
  assert.equal(result.isDemo,true);
  assert.equal(result.approvalRecorded,false);
  assert.equal(result.physicalReleaseQualified,false);
  assert.equal(result.label,"DEMO / NOT A PHYSICAL RELEASE");
  assert.equal(result.storedStatus,c.status);
 }
 const held=jobCardReleasePresentation({sales_order_id:"REAL-NEW",status:"hold",approved_by:"person",approved_at:"2026-11-02",sales_order_revision:2},3);
 assert.equal(held.approvalRecorded,false);
 const real=jobCardReleasePresentation({sales_order_id:"REAL-NEW",status:"released",approved_by:"person",approved_at:"2026-11-02",sales_order_revision:3},3);
 assert.equal(real.approvalRecorded,true);
 assert.equal(real.physicalReleaseQualified,false,"presentation cannot confer engineering/physical authority");
});
test("simulation and Production explain the pre-production state without rewriting history",async()=>{
 const page=await readFile(new URL("../src/routes/command/production.tsx",import.meta.url),"utf8");
 assert.match(page,/jobCardReleasePresentation/);
 assert.match(page,/NOT RELEASED/);
 assert.match(page,/Design confirmation/);
 assert.doesNotMatch(page,/const approvedCards = cards.filter\(\(card: any\) => Boolean\(card.approved_at\)\)/);
 const sim=await readFile(new URL("../src/routes/command/ibpe-operating-workspace_.simulation.tsx",import.meta.url),"utf8");
 assert.match(sim,/legacy\/demo/);
 assert.match(sim,/design confirmation/i);
});
