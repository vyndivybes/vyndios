import test from "node:test";
import assert from "node:assert/strict";
import { compileVedmAuthorityGraph, createVedmR3aSeed } from "./vedm-authority-graph.ts";
import {
  compileDigitalProductThread,
  extendEnterpriseDigitalThread,
  traceDigitalProductThread,
  assessDigitalThreadImpact,
  type RuntimeProductThreadInput,
} from "./digital-product-thread.ts";

const graph=compileVedmAuthorityGraph(createVedmR3aSeed(),"2026-10-04");
const runtime:RuntimeProductThreadInput={
  engineeringBaselineId:"ENG-R539",
  bomRevisionId:"BOM-R12",
  jobCardIds:["JC-1"],
  qualityReleaseIds:[],
  shipmentIds:[],
};

const base=compileDigitalProductThread(graph,runtime);

test("Package M extends the existing Digital Product Thread with enterprise nodes and canonical relations",()=>{
  const thread=extendEnterpriseDigitalThread(base,{
    nodes:[
      {id:"SUP-1",kind:"supplier",title:"Toray",sourceRef:"VYNDI:supplier:SUP-1"},
      {id:"PO-1",kind:"purchase_order",title:"Purchase Order PO-1",sourceRef:"VYNDI:purchase_order:PO-1"},
      {id:"GRN-1",kind:"goods_receipt",title:"Goods Receipt GRN-1",sourceRef:"VYNDI:grn:GRN-1"},
      {id:"FIFO-1",kind:"inventory_lot",title:"FIFO receipt layer",sourceRef:"VYNDI:fifo:FIFO-1"},
      {id:"MOV-1",kind:"inventory_movement",title:"Material issue",sourceRef:"VYNDI:inventory_movement:MOV-1"},
      {id:"TR-1",kind:"traveller",title:"Serial VYNDI-001",sourceRef:"VYNDI:traveller:TR-1"},
      {id:"EQ-1",kind:"equipment",title:"Cure Oven",sourceRef:"VYNDI:equipment:EQ-1"},
      {id:"OP-1",kind:"operator",title:"Operator A",sourceRef:"VYNDI:operator:OP-1"},
      {id:"QI-1",kind:"quality_inspection",title:"Final inspection",sourceRef:"VYNDI:quality_inspection:QI-1"},
      {id:"NCR-1",kind:"ncr",title:"NCR-1",sourceRef:"VYNDI:ncr:NCR-1"},
      {id:"CAPA-1",kind:"capa",title:"CAPA-1",sourceRef:"VYNDI:capa:CAPA-1"},
      {id:"QR-1",kind:"quality_release",title:"Release QR-1",sourceRef:"VYNDI:quality_release:QR-1"},
      {id:"SO-1",kind:"sales_order",title:"Sales Order SO-1",sourceRef:"VYNDI:sales_order:SO-1"},
      {id:"SHIP-1",kind:"shipment",title:"Shipment SHIP-1",sourceRef:"VYNDI:shipment:SHIP-1"},
      {id:"INV-1",kind:"invoice",title:"Invoice INV-1",sourceRef:"VYNDI:invoice:INV-1"},
      {id:"COST-1",kind:"job_cost",title:"Actual Job Cost",sourceRef:"VYNDI:job_cost:COST-1"},
      {id:"RISK-1",kind:"risk",title:"Material risk",sourceRef:"VYNDI:risk:RISK-1"},
    ],
    edges:[
      {from:"SUP-1",to:"PO-1",relation:"SUPPLIES"},
      {from:"PO-1",to:"GRN-1",relation:"RECEIVED_AS"},
      {from:"GRN-1",to:"FIFO-1",relation:"STOCKED_AS"},
      {from:"FIFO-1",to:"MOV-1",relation:"ALLOCATED_TO"},
      {from:"MOV-1",to:"TR-1",relation:"CONSUMED_BY"},
      {from:"JC-1",to:"TR-1",relation:"BUILT_AS"},
      {from:"TR-1",to:"EQ-1",relation:"OPERATED_WITH"},
      {from:"TR-1",to:"OP-1",relation:"PERFORMED_BY"},
      {from:"TR-1",to:"QI-1",relation:"INSPECTED_BY"},
      {from:"QI-1",to:"NCR-1",relation:"NONCONFORMITY"},
      {from:"NCR-1",to:"CAPA-1",relation:"CORRECTED_BY"},
      {from:"TR-1",to:"QR-1",relation:"RELEASED_BY"},
      {from:"SO-1",to:"JC-1",relation:"EXECUTED_BY"},
      {from:"JC-1",to:"COST-1",relation:"COSTED_BY"},
      {from:"JC-1",to:"SHIP-1",relation:"FULFILLED_BY"},
      {from:"SHIP-1",to:"INV-1",relation:"BILLED_BY"},
      {from:"GRN-1",to:"RISK-1",relation:"EXPOSES_RISK"},
    ],
  });
  for(const id of ["SUP-1","PO-1","GRN-1","TR-1","EQ-1","QI-1","CAPA-1","SHIP-1","INV-1","COST-1","RISK-1"]){
    assert.ok(thread.nodeById.has(id),id);
  }
  const trace=traceDigitalProductThread(thread,"SUP-1","QR-1");
  assert.deepEqual(trace.map((node)=>node.id),["SUP-1","PO-1","GRN-1","FIFO-1","MOV-1","TR-1","QR-1"]);
});

test("enterprise impact propagation follows material receipt into affected serial, quality and risk evidence",()=>{
  const thread=extendEnterpriseDigitalThread(base,{
    nodes:[
      {id:"GRN-1",kind:"goods_receipt",title:"GRN",sourceRef:"GRN"},
      {id:"FIFO-1",kind:"inventory_lot",title:"FIFO",sourceRef:"FIFO"},
      {id:"MOV-1",kind:"inventory_movement",title:"Issue",sourceRef:"MOV"},
      {id:"TR-1",kind:"traveller",title:"Serial",sourceRef:"TR"},
      {id:"QR-1",kind:"quality_release",title:"Release",sourceRef:"QR"},
      {id:"RISK-1",kind:"risk",title:"Risk",sourceRef:"RISK"},
    ],
    edges:[
      {from:"GRN-1",to:"FIFO-1",relation:"STOCKED_AS"},
      {from:"FIFO-1",to:"MOV-1",relation:"ALLOCATED_TO"},
      {from:"MOV-1",to:"TR-1",relation:"CONSUMED_BY"},
      {from:"TR-1",to:"QR-1",relation:"RELEASED_BY"},
      {from:"GRN-1",to:"RISK-1",relation:"EXPOSES_RISK"},
    ],
  });
  const impact=assessDigitalThreadImpact(thread,"GRN-1");
  assert.ok(impact.affectedNodeIds.includes("TR-1"));
  assert.ok(impact.affectedNodeIds.includes("QR-1"));
  assert.ok(impact.affectedNodeIds.includes("RISK-1"));
});

test("enterprise graph refuses dangling links instead of inventing missing authority",()=>{
  const thread=extendEnterpriseDigitalThread(base,{
    nodes:[{id:"PO-1",kind:"purchase_order",title:"PO",sourceRef:"PO"}],
    edges:[{from:"PO-1",to:"GRN-MISSING",relation:"RECEIVED_AS"}],
  });
  assert.equal(thread.edges.some((edge)=>edge.to==="GRN-MISSING"),false);
  assert.ok(thread.gaps.some((gap)=>gap.code==="ENTERPRISE_LINK_ENDPOINT_MISSING"));
});

test("enterprise extension de-duplicates canonical nodes and edges",()=>{
  const input={
    nodes:[
      {id:"PO-1",kind:"purchase_order" as const,title:"PO",sourceRef:"PO"},
      {id:"PO-1",kind:"purchase_order" as const,title:"PO",sourceRef:"PO"},
      {id:"GRN-1",kind:"goods_receipt" as const,title:"GRN",sourceRef:"GRN"},
    ],
    edges:[
      {from:"PO-1",to:"GRN-1",relation:"RECEIVED_AS" as const},
      {from:"PO-1",to:"GRN-1",relation:"RECEIVED_AS" as const},
    ],
  };
  const thread=extendEnterpriseDigitalThread(base,input);
  assert.equal([...thread.nodeById.values()].filter((node)=>node.id==="PO-1").length,1);
  assert.equal(thread.edges.filter((edge)=>edge.from==="PO-1"&&edge.to==="GRN-1"&&edge.relation==="RECEIVED_AS").length,1);
});


test("resource impact flows from equipment into the serial and downstream release evidence",()=>{
  const thread=extendEnterpriseDigitalThread(base,{
    nodes:[
      {id:"EQ-1",kind:"equipment",title:"Cure oven",sourceRef:"EQ"},
      {id:"TR-1",kind:"traveller",title:"Serial",sourceRef:"TR"},
      {id:"QR-1",kind:"quality_release",title:"Release",sourceRef:"QR"},
    ],
    edges:[
      {from:"EQ-1",to:"TR-1",relation:"USED_BY"},
      {from:"TR-1",to:"QR-1",relation:"RELEASED_BY"},
    ],
  });
  const impact=assessDigitalThreadImpact(thread,"EQ-1");
  assert.deepEqual(impact.affectedNodeIds,["TR-1","QR-1"]);
});
