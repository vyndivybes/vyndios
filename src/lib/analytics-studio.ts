/** Pure projections of existing, authorized VYNDI OS report/lineage reads.
 * No queries, writes, artificial metrics, automatic business actions or cross-company consolidation.
 */
export type AnalyticsDatum={
  id:string;dataset:string;category:string;variant:string;stage:string;
  status:string;month:number|null;source:string;metrics:Record<string,number>;
};
export type AnalyticsInput={
  lineage?:Array<Record<string,unknown>>;
  report?:Record<string,any>;
  actuals?:Record<string|number,Record<string,unknown>>;
};
const text=(x:unknown)=>typeof x==='string'?x.trim():x==null?'':String(x);
const num=(x:unknown)=>x!==null&&x!==undefined&&x!==''&&Number.isFinite(Number(x))?Number(x):null;
const month=(v:unknown)=>{const n=num(v);return n!==null&&Number.isInteger(n)&&n>=1&&n<=36?n:null};
const numeric=(src:Record<string,unknown>, allowed?:readonly string[])=>{
 const out:Record<string,number>={recordCount:1};
 for(const [k,v] of Object.entries(src)){
  if(allowed&&!allowed.includes(k))continue;
  if(!allowed&&/(^|_)(id|month|year|revision|date|code|at|timestamp)$/.test(k))continue;
  const n=num(v);if(n!==null)out[k]=n;
 }
 return out;
};
export const DATASETS=Object.freeze([
 {id:'flow',label:'Demand → cash',source:'Signed order/job-card lineage',defaultMetric:'units'},
 {id:'materials',label:'Material requirements',source:'Procurement net requirement view',defaultMetric:'recordCount'},
 {id:'inventory',label:'Inventory / MSL',source:'Minimum stock level health view',defaultMetric:'recordCount'},
 {id:'receiving',label:'Supply / receiving',source:'Receiving exceptions view',defaultMetric:'recordCount'},
 {id:'production',label:'Job cards / release',source:'Production release gate view',defaultMetric:'recordCount'},
 {id:'backlog',label:'Demand backlog',source:'Order backlog view',defaultMetric:'recordCount'},
 {id:'receivables',label:'Invoices / receivables',source:'Receivables ageing view',defaultMetric:'recordCount'},
 {id:'payables',label:'Payables / suppliers',source:'Payables ageing view',defaultMetric:'recordCount'},
 {id:'finance',label:'Budget actuals',source:'Central monthly actuals authority',defaultMetric:'revenue'},
] as const);
export const KANBAN_STAGES=Object.freeze(['Order confirmed','Job card','Material shortage','PO linked','Receiving','Build / quality','Invoice issued','Collected']);
function stage(r:Record<string,unknown>):string{
 if(num(r.collectionCount)!==null&&Number(r.collectionCount)>0)return 'Collected';
 if(num(r.invoiceCount)!==null&&Number(r.invoiceCount)>0)return 'Invoice issued';
 if(num(r.travellerCount)!==null&&Number(r.travellerCount)>0)return 'Build / quality';
 if(num(r.shortageLines)!==null&&Number(r.shortageLines)>0)return 'Material shortage';
 if(num(r.goodsReceiptCount)!==null&&Number(r.goodsReceiptCount)>0)return 'Receiving';
 if(num(r.purchaseOrderCount)!==null&&Number(r.purchaseOrderCount)>0)return 'PO linked';
 if(text(r.jobCardId))return 'Job card';
 return 'Order confirmed';
}
function reportRows(output:AnalyticsDatum[],dataset:string,input:unknown,source:string){
 if(!Array.isArray(input))return;
 for(let index=0;index<input.length;index++){
  const row=input[index];
  if(!row||typeof row!=='object'||Array.isArray(row))continue;
  const value=row as Record<string,unknown>;
  const m=numeric(value);
  const category=text(value.sku||value.item_name||value.ledger_id||value.purchase_order_id||value.job_card_id||value.sales_order_id||value.invoice_id||value.supplier_id||value.variant_name)||dataset;
  output.push({
   id:dataset+':'+index, dataset,category,variant:text(value.variant_name||value.variant||''),
   stage:text(value.gate_status||value.health||value.exception_class||value.aging_bucket||value.status||'Recorded'),
   status:text(value.health||value.gate_status||value.exception_class||value.status||value.aging_bucket||'Recorded'),
   month:month(value.plan_month||value.requirement_month),
   source,metrics:m,
  });
 }
}
export function buildAnalyticsRows({lineage=[],report={},actuals={}}:AnalyticsInput):AnalyticsDatum[]{
 const output:AnalyticsDatum[]=[];
 for(const raw of lineage){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))continue;
  const id=text(raw.salesOrderId);if(!id)continue;
  const metricKeys=['units','shortageLines','shortageUnits','purchaseOrderCount','goodsReceiptCount','acceptedReceiptUnits','travellerCount','qualityInspectionCount','qualityReleaseCount','openNcrCount','openCapaCount','shipmentCount','invoiceCount','collectionCount','collectionAmountLakh'];
  const fields=numeric(raw,metricKeys);
  // Friendly aliases are exactly the persisted aggregate fields.
  for(const [alias,key] of Object.entries({purchaseOrders:'purchaseOrderCount',jobCards:'jobCardId',invoices:'invoiceCount',collections:'collectionCount'})){
    const n=key==='jobCardId'?(text(raw.jobCardId)?1:0):num(raw[key]);
    if(n!==null)fields[alias]=n;
  }
  output.push({id,dataset:'flow',category:text(raw.variantName||raw.variantId)||'Unspecified variant',
    variant:text(raw.variantName||raw.variantId),stage:stage(raw),status:text(raw.orderStatus)||'Unknown',
    month:month(raw.planMonth),source:'VYNDI committed order → job-card lineage',metrics:fields});
 }
 reportRows(output,'materials',report?.inventory?.procurementNetRequirement,'vyndi_report_procurement_net_requirement');
 reportRows(output,'inventory',report?.inventory?.mslHealth,'vyndi_report_msl_health');
 reportRows(output,'receiving',report?.inventory?.receivingExceptions,'vyndi_report_receiving_exceptions');
 reportRows(output,'production',report?.engineeringProduction?.productionReleaseGate,'vyndi_report_production_release_gate');
 reportRows(output,'backlog',report?.commercial?.orderBacklog,'vyndi_report_order_backlog');
 reportRows(output,'receivables',report?.finance?.receivablesAging,'vyndi_report_receivables_aging');
 reportRows(output,'payables',report?.finance?.payablesAging,'vyndi_report_payables_aging');
 for(const [key,value] of Object.entries(actuals||{})){
  const m=month(key);if(m===null||!value||typeof value!=='object'||Array.isArray(value))continue;
  const fields=numeric(value,['revenue','units','cogs','opex','closingCash','inventory','receivables','payables']);
  output.push({id:'actual:M'+m,dataset:'finance',category:'M'+m,variant:'',stage:'Recorded actual',status:value.verified===true?'Verified / transaction-linked':'Management actual',month:m,
   source:value.transactionDerived===true?'Transaction-derived + management actuals':'Management actuals',metrics:fields});
 }
 return output;
}
export function filterAnalyticsRows(rows:AnalyticsDatum[],{dataset='',variant='',status='',from=1,to=36}:{dataset?:string;variant?:string;status?:string;from?:number;to?:number}={}){
 return rows.filter(r=>(!dataset||r.dataset===dataset)&&(!variant||r.variant===variant)&&(!status||r.stage===status||r.status===status)
   &&(r.month===null||(r.month>=from&&r.month<=to)));
}
export const DIMENSIONS=Object.freeze(['category','variant','stage','status','month','dataset','source']);
export function getNumericMetrics(rows:AnalyticsDatum[]):string[]{
 const set=new Set<string>();
 for(const row of rows)for(const key of Object.keys(row.metrics))set.add(key);
 return [...set].sort((a,b)=>a==='recordCount'?-1:b==='recordCount'?1:a.localeCompare(b));
}
function dimensionOf(row:AnalyticsDatum,key:string){
 const value=key==='month'?(row.month===null?'Month not assigned':'M'+row.month):String((row as unknown as Record<string,unknown>)[key]??'');
 return value||'Unassigned';
}
export function aggregateAnalyticsRows(rows:AnalyticsDatum[],dimension:string,metric:string){
 if(!DIMENSIONS.includes(dimension))throw new Error('ANALYTICS_DIMENSION_INVALID');
 const map=new Map<string,{name:string,value:number,records:number}>();
 for(const row of rows){
  if(!Object.hasOwn(row.metrics,metric))continue;
  const v=row.metrics[metric];if(!Number.isFinite(v))continue;
  const name=dimensionOf(row,dimension),current=map.get(name)||{name,value:0,records:0};
  current.value+=v;current.records++;map.set(name,current);
 }
 const out=[...map.values()];
 if(dimension==='month')out.sort((a,b)=>Number(a.name.slice(1))-Number(b.name.slice(1)));
 else out.sort((a,b)=>b.value-a.value||a.name.localeCompare(b.name));
 return out;
}
export function paretoAnalyticsRows(rows:AnalyticsDatum[],dimension:string,metric:string){
 const ranks=aggregateAnalyticsRows(rows,dimension,metric).filter(r=>r.value>=0)
   .sort((a,b)=>b.value-a.value||a.name.localeCompare(b.name));
 const total=ranks.reduce((n,r)=>n+r.value,0);let cumulative=0;
 return ranks.map(r=>{cumulative+=r.value;return {...r,cumulativePercent:total>0?Math.min(100,(cumulative/total)*100):0}});
}
export function buildKanbanLanes(rows:AnalyticsDatum[]){
 const flow=rows.filter(r=>r.dataset==='flow');
 return KANBAN_STAGES.map(name=>({name,items:flow.filter(row=>row.stage===name)}));
}
