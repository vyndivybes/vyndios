export type SupplierPerformanceOrder = {
  onTime:boolean;
  inFull:boolean;
};

export type SupplierPerformanceEvidence = {
  supplierId:string;
  supplierName:string;
  completedOrders:SupplierPerformanceOrder[];
  receivedQty:number;
  acceptedQty:number;
  rejectedQty:number;
  ncrCount:number;
  openNcrCount:number;
  majorCriticalNcrCount:number;
  capaCount:number;
  openCapaCount:number;
  overdueCapaCount:number;
  effectivenessVerifiedCount:number;
  expectedInvoiceCostInr:number;
  actualInvoiceCostInr:number;
  receiptCount:number;
  traceableReceiptCount:number;
  responseHours:number[];
};

export type SupplierPerformanceInput = {
  asOf:string;
  suppliers:SupplierPerformanceEvidence[];
};

const round2=(value:number)=>Math.round(value*100)/100;
const round4=(value:number)=>Math.round(value*10000)/10000;

function pct(numerator:number,denominator:number){
  return denominator>0?round2((numerator/denominator)*100):null;
}
function median(values:number[]){
  if(!values.length) return null;
  const sorted=[...values].sort((a,b)=>a-b);
  const middle=Math.floor(sorted.length/2);
  return sorted.length%2===0?round2((sorted[middle-1]!+sorted[middle]!)/2):round2(sorted[middle]!);
}
function mean(values:number[]){
  return values.length?round2(values.reduce((sum,value)=>sum+value,0)/values.length):null;
}

export function buildSupplierPerformanceScorecard(input:SupplierPerformanceInput){
  const suppliers=input.suppliers.map((supplier)=>{
    const completedOrders=supplier.completedOrders.filter((row)=>typeof row.onTime==="boolean"&&typeof row.inFull==="boolean");
    const onTimeCount=completedOrders.filter((row)=>row.onTime).length;
    const inFullCount=completedOrders.filter((row)=>row.inFull).length;
    const otifCount=completedOrders.filter((row)=>row.onTime&&row.inFull).length;
    const responseHours=supplier.responseHours.filter((value)=>Number.isFinite(value)&&value>=0);

    const receivedQty=Math.max(0,Number(supplier.receivedQty)||0);
    const acceptedQty=Math.max(0,Number(supplier.acceptedQty)||0);
    const rejectedQty=Math.max(0,Number(supplier.rejectedQty)||0);
    const expectedInvoiceCostInr=Math.max(0,Number(supplier.expectedInvoiceCostInr)||0);
    const actualInvoiceCostInr=Math.max(0,Number(supplier.actualInvoiceCostInr)||0);
    const receiptCount=Math.max(0,Math.trunc(Number(supplier.receiptCount)||0));
    const traceableReceiptCount=Math.max(0,Math.min(receiptCount,Math.trunc(Number(supplier.traceableReceiptCount)||0)));

    const otifPct=pct(otifCount,completedOrders.length);
    const onTimePct=pct(onTimeCount,completedOrders.length);
    const inFullPct=pct(inFullCount,completedOrders.length);
    const rejectPpm=receivedQty>0?round2((rejectedQty/receivedQty)*1_000_000):null;
    const acceptanceYieldPct=pct(acceptedQty,receivedQty);
    const costVariancePct=expectedInvoiceCostInr>0
      ? round2(((actualInvoiceCostInr-expectedInvoiceCostInr)/expectedInvoiceCostInr)*100)
      : null;
    const traceabilityCompletenessPct=pct(traceableReceiptCount,receiptCount);
    const meanResponseHours=mean(responseHours);
    const medianResponseHours=median(responseHours);
    const capaEffectivenessEvidencePct=pct(
      Math.max(0,Math.trunc(Number(supplier.effectivenessVerifiedCount)||0)),
      Math.max(0,Math.trunc(Number(supplier.capaCount)||0)),
    );

    const availableDimensions=[
      otifPct!=null,
      rejectPpm!=null,
      capaEffectivenessEvidencePct!=null || Math.max(0,Math.trunc(Number(supplier.ncrCount)||0))===0,
      costVariancePct!=null,
      traceabilityCompletenessPct!=null,
      meanResponseHours!=null,
    ];
    const evidenceCoveragePct=round2((availableDimensions.filter(Boolean).length/availableDimensions.length)*100);

    const attention:string[]=[];
    const lateOrIncomplete=completedOrders.length-otifCount;
    if(lateOrIncomplete>0) attention.push(`${lateOrIncomplete} completed order(s) missed OTIF`);
    if(rejectedQty>0) attention.push(`${round4(rejectedQty)} received unit(s) rejected`);
    if(Number(supplier.openNcrCount)>0) attention.push(`${Math.trunc(Number(supplier.openNcrCount))} open supplier-linked NCR(s)`);
    if(Number(supplier.overdueCapaCount)>0) attention.push(`${Math.trunc(Number(supplier.overdueCapaCount))} overdue supplier-linked CAPA(s)`);
    if(costVariancePct!=null&&costVariancePct>0) attention.push(`invoice cost is ${costVariancePct}% above PO price basis`);
    if(traceabilityCompletenessPct!=null&&traceabilityCompletenessPct<100) attention.push(`${round2(100-traceabilityCompletenessPct)}% receipt traceability evidence incomplete`);
    if(meanResponseHours==null) attention.push("responsiveness evidence not yet captured");

    return {
      supplierId:supplier.supplierId,
      supplierName:supplier.supplierName,
      completedOrderCount:completedOrders.length,
      onTimeCount,
      inFullCount,
      otifCount,
      otifPct,
      onTimePct,
      inFullPct,
      receivedQty:round4(receivedQty),
      acceptedQty:round4(acceptedQty),
      rejectedQty:round4(rejectedQty),
      rejectPpm,
      acceptanceYieldPct,
      ncrCount:Math.max(0,Math.trunc(Number(supplier.ncrCount)||0)),
      openNcrCount:Math.max(0,Math.trunc(Number(supplier.openNcrCount)||0)),
      majorCriticalNcrCount:Math.max(0,Math.trunc(Number(supplier.majorCriticalNcrCount)||0)),
      capaCount:Math.max(0,Math.trunc(Number(supplier.capaCount)||0)),
      openCapaCount:Math.max(0,Math.trunc(Number(supplier.openCapaCount)||0)),
      overdueCapaCount:Math.max(0,Math.trunc(Number(supplier.overdueCapaCount)||0)),
      effectivenessVerifiedCount:Math.max(0,Math.trunc(Number(supplier.effectivenessVerifiedCount)||0)),
      capaEffectivenessEvidencePct,
      expectedInvoiceCostInr:round2(expectedInvoiceCostInr),
      actualInvoiceCostInr:round2(actualInvoiceCostInr),
      costVariancePct,
      receiptCount,
      traceableReceiptCount,
      traceabilityCompletenessPct,
      responseEventCount:responseHours.length,
      meanResponseHours,
      medianResponseHours,
      evidenceCoveragePct,
      attention,
    };
  }).sort((a,b)=>b.attention.length-a.attention.length||a.supplierName.localeCompare(b.supplierName)||a.supplierId.localeCompare(b.supplierId));

  return {
    method:"VYNDI_SUPPLIER_PERFORMANCE_1" as const,
    asOf:input.asOf,
    suppliers,
    summary:{
      supplierCount:suppliers.length,
      suppliersWithOtifEvidence:suppliers.filter((row)=>row.otifPct!=null).length,
      suppliersWithQualityEvidence:suppliers.filter((row)=>row.rejectPpm!=null).length,
      suppliersWithCostEvidence:suppliers.filter((row)=>row.costVariancePct!=null).length,
      suppliersWithTraceabilityEvidence:suppliers.filter((row)=>row.traceabilityCompletenessPct!=null).length,
      suppliersWithResponseEvidence:suppliers.filter((row)=>row.meanResponseHours!=null).length,
      openNcrCount:suppliers.reduce((sum,row)=>sum+row.openNcrCount,0),
      openCapaCount:suppliers.reduce((sum,row)=>sum+row.openCapaCount,0),
      overdueCapaCount:suppliers.reduce((sum,row)=>sum+row.overdueCapaCount,0),
    },
    boundaries:[
      "No composite or weighted supplier score is invented. Each performance dimension is reported separately with its own evidence denominator.",
      "OTIF is descriptive actual performance from completed purchase-order receipt history; it is not a probability forecast.",
      "PPM and acceptance yield use received/rejected/accepted goods-receipt quantities; supplier-risk probability remains a separate model.",
      "Supplier-linked NCR/CAPA evidence is attributed only through incoming inspection → goods receipt → purchase order → supplier lineage.",
      "Cost variance compares supplier invoice amount excluding GST with the PO unit-price basis for the invoiced quantity.",
      "Core traceability completeness requires supplier-lot evidence and, when an accepted receipt creates inventory, a bound VYNDI identity.",
      "Responsiveness is reported only from explicit governed request/response timestamps.",
    ],
  };
}
