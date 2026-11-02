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

test("exact demo IDs cannot enter physical approval or inventory side effects",async()=>{
 const {FOUR_ORDER_DEMO_IDS,assertPhysicalProductionOrder}=await import("../src/lib/four-order-demo-scope.ts");
 const {assertPhysicalJobCard,assertPhysicalReservation}=await import("../src/lib/production-demo-guard.ts");
 for(const id of FOUR_ORDER_DEMO_IDS){
  assert.throws(()=>assertPhysicalProductionOrder(id),/Demo|physical|Design/);
  const sql={query:async()=>[{sales_order_id:id}]};
  await assert.rejects(()=>assertPhysicalJobCard(sql,"card"),/Demo|physical/);
  await assert.rejects(()=>assertPhysicalReservation(sql,"reservation"),/Demo|physical/);
 }
 assert.doesNotThrow(()=>assertPhysicalProductionOrder("REAL-NEW-ORDER"));
 await assert.rejects(()=>assertPhysicalJobCard({query:async()=>[]},"missing"),/not found/);
 const approval=await readFile(new URL("../src/lib/production-release-authority.ts",import.meta.url),"utf8");
 assert.ok(approval.indexOf("await assertPhysicalJobCard")<approval.indexOf("select * from approve_vyndi_production_batch"));
 const card=await readFile(new URL("../src/lib/production-job-card.ts",import.meta.url),"utf8");
 assert.ok(card.indexOf("await assertPhysicalReservation")<card.indexOf("select * from consume_epr_inventory_reservation"));
});
