import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  FOUR_ORDER_DEMO_IDS,
  acceptFourOrderSimulation,
  buildFourOrderSimulationInput,
  runFourOrderSimulation,
} from "../src/lib/ibpe-simulation-acceptance.ts";

const data = [
  ["SO-02ca96da-5206-4b94-9fef-062a2a992919","carbon",2,2,"released",1,1],
  ["SO-69e011a9-2c99-4ffa-82f7-39eef01bf05e","premiumCarbon",3,3,"released",1,3],
  ["SO-800d46b7-d354-4e80-a3a9-d6c2207be5bf","aluminium",3,2,"hold",1,1],
  ["SO-991bfe7e-85f6-4849-a5d0-04c2792606e3","aluminium",2,2,"released",1,1],
].map(([id,product_id,revision,card_revision,card_status,units,plan_month],i)=>({
  id,product_id,revision,card_revision,card_status,units,plan_month,
  status:"confirmed",card_id:`DEMO-CARD-${i}`,
  approved_by:i===2?"historic-actor":null,approved_at:i===2?"2026-09-10T04:59:19.762Z":null,
  bom_revision:i===2?"BOM-CORE-105-ELITE-R1":"PLANNING-BOM-001",
}));

const mapping = [
  {model_id:"core",bom_revision:"SIM-BOM-CORE",sku:"TEST-HANDLEBAR",quantity:2,bom_line_key:"A1"},
  {model_id:"pro",bom_revision:"SIM-BOM-PRO",sku:"TEST-FRAME-PRO",quantity:1,bom_line_key:"P1"},
  {model_id:"apex",bom_revision:"SIM-BOM-APEX",sku:"TEST-FRAME-APEX",quantity:1,bom_line_key:"X1"},
];
const capacity = [{work_centre_id:"ASSEMBLY",available_hours_per_month:80,efficiency:1,standard_hours_per_unit:2,planning_status:"approved",source_ref:"SIM-CAPACITY-TEST"}];

test("exactly four known confirmed orders are accepted as simulated, never production-approved",()=>{
  const a=acceptFourOrderSimulation(data);
  assert.deepEqual(a.orders.map(x=>x.orderId).sort(),[...FOUR_ORDER_DEMO_IDS].sort());
  assert.equal(a.mode,"SIMULATION_ONLY");
  assert.match(a.sourceHash,/^[a-f0-9]{64}$/);
  assert.equal(a.orders.filter(x=>x.virtualSuccessor).length,1);
  const stale=a.orders.find(x=>x.virtualSuccessor);
  assert.equal(stale.sourceCardRevision,2);
  assert.equal(stale.simulationCardRevision,3);
  assert.notEqual(stale.simulationCardId,stale.sourceCardId);
  assert.equal(stale.physicalApproval,false);
  assert.equal(a.orders.every(x=>x.simulationAcceptance==="accepted-for-simulation-only"),true);
  assert.equal(a.productionAuthorized,false);
});

test("unknown, removed, unconfirmed and novel stale records fail closed",()=>{
  assert.throws(()=>acceptFourOrderSimulation(data.slice(0,3)),/four|missing|exact/i);
  assert.throws(()=>acceptFourOrderSimulation([...data,{...data[0],id:"NEW-ORDER"}]),/exact|unexpected|four/i);
  assert.throws(()=>acceptFourOrderSimulation(data.map((x,i)=>i===0?{...x,status:"cancelled"}:x)),/confirmed/i);
  assert.throws(()=>acceptFourOrderSimulation(data.map((x,i)=>i===1?{...x,card_revision:1}:x)),/unexpected|revision/i);
  assert.throws(()=>acceptFourOrderSimulation(data.map((x,i)=>i===2?{...x,card_status:"in_progress"}:x)),/hold|status/i);
  assert.throws(()=>acceptFourOrderSimulation(data.map((x,i)=>i===3?{...x,card_id:null}:x)),/card/i);
});

test("acceptance fingerprint is independent of SQL sort order, detects changed revisions",()=>{
  const a=acceptFourOrderSimulation(data);
  assert.equal(acceptFourOrderSimulation([...data].reverse()).sourceHash,a.sourceHash);
  const changed=data.map((x,i)=>i===1?{...x,units:2}:x);
  assert.notEqual(acceptFourOrderSimulation(changed).sourceHash,a.sourceHash);
});

test("input is distinct simulation data, never canonical stock, cash, supplier or approvals",()=>{
  const accepted=acceptFourOrderSimulation(data);
  const input=buildFourOrderSimulationInput(accepted,mapping,capacity);
  assert.equal(input.demand.length,4);
  assert.equal(input.demand.reduce((n,x)=>n+x.committedQty,0),4);
  assert.ok(input.demand.every(x=>x.actualQty===0&&x.sourceRef.includes("SIMULATION_ONLY")));
  assert.deepEqual(input.reservations,[]);
  assert.deepEqual(input.receipts,[]);
  assert.deepEqual(input.cashFlows,[]);
  assert.equal(input.funding.openingBankCashLakh,0);
  assert.equal(input.inventory.every(x=>x.onHandQty===0&&x.reservedQty===0&&x.unitCostLakh===undefined),true);
  assert.ok(input.committedMaterialRequirements.some(x=>x.sku==="TEST-HANDLEBAR"&&x.quantity===4));
  assert.equal(input.capacity.length,36);
});

test("simulation executes deterministic IBPE without granting physical release or finance authority",()=>{
  const accepted=acceptFourOrderSimulation(data);
  const a=runFourOrderSimulation(accepted,mapping,capacity);
  const b=runFourOrderSimulation(accepted,mapping,capacity);
  assert.deepEqual(a,b);
  assert.equal(a.mode,"SIMULATION_ONLY");
  assert.equal(a.productionAuthorized,false);
  assert.equal(a.financiallyAuthoritative,false);
  assert.equal(a.acceptedOrderCount,4);
  assert.equal(a.virtualSuccessorCount,1);
  assert.equal(a.revisionMismatches,0);
  assert.ok(a.inputHash.match(/^[a-f0-9]{64}$/));
  assert.equal(a.engineVersion,"VYNDI-IBPE-1.3.0");
  assert.ok(a.summary);
});

test("server is view-only, freshness checked and cannot use real production optimizer persistence",async()=>{
  const s=await readFile(new URL("../src/lib/ibpe-simulation-authority.ts",import.meta.url),"utf8");
  assert.match(s,/requireBusinessActor\("view"/);
  assert.match(s,/expectedSourceHash/);
  assert.match(s,/SIMULATION_ONLY/);
  assert.match(s,/runFourOrderSimulation/);
  assert.doesNotMatch(s,/\b(insert into|update\s+vyndi_|delete from|approve_vyndi_production_batch|runGovernedIbpe\(|runAdvancedOptimizerFromPacket\()/i);
});
