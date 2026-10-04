import test from "node:test";
import assert from "node:assert/strict";
import { buildSupplierPerformanceScorecard, type SupplierPerformanceEvidence } from "./supplier-performance-model.ts";

const supplier=(overrides:Partial<SupplierPerformanceEvidence>={}):SupplierPerformanceEvidence=>({
  supplierId:"SUP-1",
  supplierName:"Supplier One",
  completedOrders:[
    {onTime:true,inFull:true},
    {onTime:true,inFull:false},
    {onTime:false,inFull:true},
    {onTime:true,inFull:true},
  ],
  receivedQty:1000,
  acceptedQty:990,
  rejectedQty:10,
  ncrCount:2,
  openNcrCount:1,
  majorCriticalNcrCount:1,
  capaCount:2,
  openCapaCount:1,
  overdueCapaCount:1,
  effectivenessVerifiedCount:1,
  expectedInvoiceCostInr:100000,
  actualInvoiceCostInr:103000,
  receiptCount:4,
  traceableReceiptCount:3,
  responseHours:[8,24,16],
  ...overrides,
});

test("supplier scorecard derives OTIF quality CAPA cost traceability and responsiveness without a hidden composite score",()=>{
  const result=buildSupplierPerformanceScorecard({asOf:"2026-10-04T00:00:00Z",suppliers:[supplier()]});
  const row=result.suppliers[0]!;
  assert.equal(row.completedOrderCount,4);
  assert.equal(row.otifPct,50);
  assert.equal(row.onTimePct,75);
  assert.equal(row.inFullPct,75);
  assert.equal(row.rejectPpm,10000);
  assert.equal(row.acceptanceYieldPct,99);
  assert.equal(row.costVariancePct,3);
  assert.equal(row.traceabilityCompletenessPct,75);
  assert.equal(row.meanResponseHours,16);
  assert.equal(row.medianResponseHours,16);
  assert.equal(row.capaEffectivenessEvidencePct,50);
  assert.equal("score" in row,false);
  assert.equal("weightedScore" in row,false);
});

test("descriptive metrics are withheld rather than invented when their evidence denominator is absent",()=>{
  const result=buildSupplierPerformanceScorecard({asOf:"2026-10-04T00:00:00Z",suppliers:[supplier({
    completedOrders:[],receivedQty:0,acceptedQty:0,rejectedQty:0,
    expectedInvoiceCostInr:0,actualInvoiceCostInr:0,receiptCount:0,traceableReceiptCount:0,responseHours:[],
  })]});
  const row=result.suppliers[0]!;
  assert.equal(row.otifPct,null);
  assert.equal(row.rejectPpm,null);
  assert.equal(row.acceptanceYieldPct,null);
  assert.equal(row.costVariancePct,null);
  assert.equal(row.traceabilityCompletenessPct,null);
  assert.equal(row.meanResponseHours,null);
  assert.ok(row.evidenceCoveragePct<100);
});

test("positive cost variance means invoices exceed the PO price basis and negative means favourable variance",()=>{
  const high=buildSupplierPerformanceScorecard({asOf:"2026-10-04T00:00:00Z",suppliers:[supplier({expectedInvoiceCostInr:200,actualInvoiceCostInr:220})]}).suppliers[0]!;
  const low=buildSupplierPerformanceScorecard({asOf:"2026-10-04T00:00:00Z",suppliers:[supplier({expectedInvoiceCostInr:200,actualInvoiceCostInr:180})]}).suppliers[0]!;
  assert.equal(high.costVariancePct,10);
  assert.equal(low.costVariancePct,-10);
});

test("supplier-level scorecard summary reports evidence coverage and open corrective-action burden",()=>{
  const result=buildSupplierPerformanceScorecard({
    asOf:"2026-10-04T00:00:00Z",
    suppliers:[
      supplier(),
      supplier({supplierId:"SUP-2",supplierName:"Supplier Two",openNcrCount:0,openCapaCount:0,overdueCapaCount:0,responseHours:[]}),
    ],
  });
  assert.equal(result.summary.supplierCount,2);
  assert.equal(result.summary.suppliersWithOtifEvidence,2);
  assert.equal(result.summary.suppliersWithResponseEvidence,1);
  assert.equal(result.summary.openNcrCount,1);
  assert.equal(result.summary.openCapaCount,1);
  assert.equal(result.summary.overdueCapaCount,1);
});
