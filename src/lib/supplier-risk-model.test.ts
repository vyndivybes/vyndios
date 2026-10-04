import assert from "node:assert/strict";
import { test } from "node:test";
import { analyzeSupplierRiskEvidence } from "./supplier-risk-model.ts";

test("single-source exposure is explicit and not converted into a probability",()=>{
  const result=analyzeSupplierRiskEvidence({
    approvedLaneCount:1,
    governedLeadTimeDays:30,
    governedReliability:0.92,
    qualityRating:95,
    deliveryRating:90,
    deliveryDelaysDays:[0,2,0,5,0,0],
    actualLeadTimeDays:[29,32,30,35,28,31],
    receivedQuantity:100,
    rejectedQuantity:3,
  });
  assert.equal(result.singleSource,true);
  assert.equal(result.singleSourceProbability,null);
  assert.equal(result.governedReliabilityPct,92);
});

test("empirical late-delivery forecast is withheld with too few receipt events",()=>{
  const result=analyzeSupplierRiskEvidence({
    approvedLaneCount:2,
    governedLeadTimeDays:30,
    governedReliability:null,
    qualityRating:null,
    deliveryRating:null,
    deliveryDelaysDays:[0,2,0],
    actualLeadTimeDays:[30,32,28],
    receivedQuantity:10,
    rejectedQuantity:0,
  });
  assert.equal(result.deliveryForecast.available,false);
  assert.equal(result.deliveryForecast.expectedLatePct,null);
});

test("supplier delivery forecast uses actual PO/GRN outcomes when sufficient",()=>{
  const result=analyzeSupplierRiskEvidence({
    approvedLaneCount:2,
    governedLeadTimeDays:30,
    governedReliability:0.9,
    qualityRating:94,
    deliveryRating:88,
    deliveryDelaysDays:[0,0,2,0,5,0,1,0,0,3],
    actualLeadTimeDays:[28,30,32,29,35,30,31,28,30,33],
    receivedQuantity:100,
    rejectedQuantity:2,
  });
  assert.equal(result.deliveryForecast.available,true);
  assert.ok((result.deliveryForecast.expectedLatePct??0)>0);
  assert.ok((result.actualLeadTime.p80Days??0)>=30);
  assert.equal(result.incomingQuality.available,true);
});

test("incoming quality forecast is withheld until received quantity is sufficient",()=>{
  const result=analyzeSupplierRiskEvidence({
    approvedLaneCount:2,
    governedLeadTimeDays:20,
    governedReliability:null,
    qualityRating:null,
    deliveryRating:null,
    deliveryDelaysDays:[],
    actualLeadTimeDays:[],
    receivedQuantity:8,
    rejectedQuantity:1,
  });
  assert.equal(result.incomingQuality.available,false);
});

test("actual lead-time evidence reports drift separately from supplier ratings",()=>{
  const result=analyzeSupplierRiskEvidence({
    approvedLaneCount:2,
    governedLeadTimeDays:30,
    governedReliability:0.95,
    qualityRating:98,
    deliveryRating:97,
    deliveryDelaysDays:[2,3,4,0,1,2],
    actualLeadTimeDays:[32,33,34,30,31,32],
    receivedQuantity:50,
    rejectedQuantity:0,
  });
  assert.equal(result.actualLeadTime.available,true);
  assert.ok((result.actualLeadTime.meanDays??0)>30);
  assert.ok((result.actualLeadTime.meanDriftDays??0)>0);
  assert.equal(result.qualityRating,98);
});
