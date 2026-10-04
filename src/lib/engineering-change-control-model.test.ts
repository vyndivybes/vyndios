import test from "node:test";
import assert from "node:assert/strict";
import {
  compareEngineeringBaselines,
  evaluateEngineeringChangeEffectivity,
  type EngineeringBaselineSnapshot,
  type EngineeringBomLine,
  type EngineeringEffectivityRule,
} from "./engineering-change-control-model.ts";

const baseline=(overrides:Partial<EngineeringBaselineSnapshot>={}):EngineeringBaselineSnapshot=>({
  id:"ENG-OLD",familyCode:"altitude",variantId:"ALT-CF-PRO",revisionCode:"R1",
  geometryRef:"GEO-R1",materialSpec:"MAT-A",layupRef:"LAY-A",alloySpec:null,
  toolingRef:"TOOL-A",drawingRef:"DWG-R1",bomRevision:"BOM-R1",...overrides,
});
const bom=(overrides:Partial<EngineeringBomLine>={}):EngineeringBomLine=>({
  mappingId:"MAP-1",sku:"SKU-1",quantity:1,unit:"ea",bomLineKey:"frame",configurationOptionId:null,...overrides,
});

test("effectivity is fail-closed when no governed rules exist",()=>{
  assert.equal(evaluateEngineeringChangeEffectivity([],{
    date:"2026-10-04",variantId:"ALT-CF-PRO",serialNumber:"VYNDI-001",salesOrderId:"SO-1",jobCardId:"JC-1",
  }).effective,false);
});

test("effectivity ORs rules within a dimension and ANDs represented dimensions",()=>{
  const rules:EngineeringEffectivityRule[]=[
    {id:"R1",type:"variant",valueFrom:"ALT-CF-PRO",valueTo:null,effectiveFrom:null,effectiveTo:null},
    {id:"R2",type:"variant",valueFrom:"ALT-CF-APEX",valueTo:null,effectiveFrom:null,effectiveTo:null},
    {id:"R3",type:"date",valueFrom:null,valueTo:null,effectiveFrom:"2026-10-01",effectiveTo:"2026-10-31"},
  ];
  assert.equal(evaluateEngineeringChangeEffectivity(rules,{
    date:"2026-10-20",variantId:"ALT-CF-APEX",serialNumber:null,salesOrderId:null,jobCardId:null,
  }).effective,true);
  assert.equal(evaluateEngineeringChangeEffectivity(rules,{
    date:"2026-11-01",variantId:"ALT-CF-APEX",serialNumber:null,salesOrderId:null,jobCardId:null,
  }).effective,false);
  assert.equal(evaluateEngineeringChangeEffectivity(rules,{
    date:"2026-10-20",variantId:"LAT-CF-PRO",serialNumber:null,salesOrderId:null,jobCardId:null,
  }).effective,false);
});

test("serial range effectivity is inclusive for canonical sortable serials",()=>{
  const rules:EngineeringEffectivityRule[]=[
    {id:"R1",type:"serial",valueFrom:"VYNDI-ALT-000100",valueTo:"VYNDI-ALT-000199",effectiveFrom:null,effectiveTo:null},
  ];
  assert.equal(evaluateEngineeringChangeEffectivity(rules,{date:null,variantId:null,serialNumber:"VYNDI-ALT-000100",salesOrderId:null,jobCardId:null}).effective,true);
  assert.equal(evaluateEngineeringChangeEffectivity(rules,{date:null,variantId:null,serialNumber:"VYNDI-ALT-000199",salesOrderId:null,jobCardId:null}).effective,true);
  assert.equal(evaluateEngineeringChangeEffectivity(rules,{date:null,variantId:null,serialNumber:"VYNDI-ALT-000200",salesOrderId:null,jobCardId:null}).effective,false);
});

test("baseline comparison reports field changes and BOM added removed changed lines",()=>{
  const result=compareEngineeringBaselines({
    from:baseline(),
    to:baseline({id:"ENG-NEW",revisionCode:"R2",materialSpec:"MAT-B",drawingRef:"DWG-R2",bomRevision:"BOM-R2"}),
    fromBom:[bom(),bom({mappingId:"MAP-2",sku:"SKU-2",quantity:2,bomLineKey:"fork"})],
    toBom:[bom({quantity:1.5}),bom({mappingId:"MAP-3",sku:"SKU-3",quantity:1,bomLineKey:"seatpost"})],
  });
  assert.deepEqual(result.changedFields.map((row)=>row.field),["materialSpec","drawingRef","bomRevision"]);
  assert.deepEqual(result.changedBomLines.map((row)=>row.sku),["SKU-1"]);
  assert.deepEqual(result.removedBomLines.map((row)=>row.sku),["SKU-2"]);
  assert.deepEqual(result.addedBomLines.map((row)=>row.sku),["SKU-3"]);
  assert.equal(result.materialChange,true);
  assert.equal(result.bomChange,true);
});
