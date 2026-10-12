/** Vāyú Shastr management consolidation contracts.
 * The six divisions are NOT representations of separately incorporated companies.
 * Revenue/expense/cash amounts remain HOLD until governed journal attribution,
 * external-vs-internal classification and elimination reconciliation exist.
 */
export const GROUP_UNITS=Object.freeze([
 {id:'corporate',name:'Vāyú Shastr Corporate',type:'management_unit'},
 {id:'carbon',name:'Carbon Bicycle Division',type:'management_unit'},
 {id:'aluminium',name:'Aluminium Bicycle Division',type:'management_unit'},
 {id:'software',name:'VYNDI OS / VAOS Software',type:'management_unit'},
 {id:'vybes',name:'Vybes Community',type:'management_unit'},
 {id:'merchandise',name:'Merchandise & Terrain Medals',type:'management_unit'},
] as const);
export type GroupUnitId=typeof GROUP_UNITS[number]['id'];
export const GROUP_SOURCE_KINDS=Object.freeze([
 'sales_order','job_card','purchase_order','sales_invoice','supplier_invoice',
 'crm_customer','people_record',
] as const);
export type GroupSourceKind=typeof GROUP_SOURCE_KINDS[number];
export type GroupSourceBucket={
 sourceKind:GroupSourceKind;divisionId:GroupUnitId|null;count:number;units?:number;
};
export type GroupSourceCoverage=Partial<Record<GroupSourceKind,'PASS'|'HOLD'>>;

type UnitSummary={id:GroupUnitId;name:string;orders:number;units:number;jobCards:number;purchaseOrders:number;salesInvoices:number;supplierInvoices:number;crmCustomers:number;peopleRecords:number;sourceCounts:Record<GroupSourceKind,number>};
const metricKeys:Record<GroupSourceKind,keyof Pick<UnitSummary,'orders'|'jobCards'|'purchaseOrders'|'salesInvoices'|'supplierInvoices'|'crmCustomers'|'peopleRecords'>>={
 sales_order:'orders',job_card:'jobCards',purchase_order:'purchaseOrders',
 sales_invoice:'salesInvoices',supplier_invoice:'supplierInvoices',
 crm_customer:'crmCustomers',people_record:'peopleRecords',
};
const fresh=({id,name}:typeof GROUP_UNITS[number]):UnitSummary=>({
 id,name,orders:0,units:0,jobCards:0,purchaseOrders:0,salesInvoices:0,supplierInvoices:0,
 crmCustomers:0,peopleRecords:0,sourceCounts:Object.fromEntries(GROUP_SOURCE_KINDS.map(kind=>[kind,0])) as UnitSummary['sourceCounts'],
});
const countOk=(v:number)=>Number.isSafeInteger(v)&&v>=0;
export function calculateGroupCoverage(coverage:GroupSourceCoverage,buckets:readonly GroupSourceBucket[]){
 const holds:string[]=[];
 for(const kind of GROUP_SOURCE_KINDS)if(coverage[kind]!=='PASS')holds.push(kind+': '+(coverage[kind]||'NOT CONNECTED'));
 for(const kind of GROUP_SOURCE_KINDS){
  const missing=buckets.filter(b=>b.sourceKind===kind&&b.divisionId===null).reduce((n,b)=>n+b.count,0);
  if(missing>0)holds.push(kind+': Unattributed '+missing+' source records');
 }
 return {complete:holds.length===0,holds};
}
export function aggregateDivisionSources(buckets:readonly GroupSourceBucket[],coverage:GroupSourceCoverage){
 const divisions=GROUP_UNITS.map(fresh),unattributed=fresh({id:'corporate',name:'Unattributed',type:'management_unit'});
 const seen=new Set<string>();
 for(const b of buckets){
  if(!GROUP_SOURCE_KINDS.includes(b.sourceKind))throw Error('GROUP_SOURCE_KIND_INVALID');
  if(b.divisionId!==null&&!GROUP_UNITS.some(x=>x.id===b.divisionId))throw Error('GROUP_DIVISION_INVALID');
  if(!countOk(b.count)||b.units!==undefined&&(!Number.isFinite(b.units)||b.units<0))throw Error('GROUP_BUCKET_INVALID');
  if(b.sourceKind!=='sales_order'&&b.units!==undefined)throw Error('GROUP_NONCOMPARABLE_UNITS');
  const key=b.sourceKind+':'+(b.divisionId??'UNATTRIBUTED');
  if(seen.has(key))throw Error('GROUP_DUPLICATE_SOURCE_BUCKET');
  seen.add(key);
  const summary=b.divisionId===null?unattributed:divisions.find(x=>x.id===b.divisionId)!;
  summary[metricKeys[b.sourceKind]]+=b.count;
  summary.sourceCounts[b.sourceKind]+=b.count;
  if(b.sourceKind==='sales_order')summary.units+=b.units??0;
 }
 const coverageResult=calculateGroupCoverage(coverage,buckets);
 const totalAttributed=divisions.reduce((r,v)=>({
  orders:r.orders+v.orders,units:r.units+v.units,jobCards:r.jobCards+v.jobCards,
  purchaseOrders:r.purchaseOrders+v.purchaseOrders,salesInvoices:r.salesInvoices+v.salesInvoices,
  supplierInvoices:r.supplierInvoices+v.supplierInvoices,crmCustomers:r.crmCustomers+v.crmCustomers,
  peopleRecords:r.peopleRecords+v.peopleRecords,
 }),{orders:0,units:0,jobCards:0,purchaseOrders:0,salesInvoices:0,supplierInvoices:0,crmCustomers:0,peopleRecords:0});
 const groupStatus=Object.values(coverage).includes('HOLD')?'HOLD':coverageResult.complete?'ATTRIBUTION_COVERED':'PARTIAL';
 return {divisions,unattributed,totalAttributed,groupStatus,groupFinancialTotal:null as null,coverage:coverageResult};
}

export type TransferPair={
 transferId:string;period:string;currency:'INR'|string;basis:'approved'|'draft'|string;
 debit:{divisionId:GroupUnitId;amount:number;sourceRef:string};
 credit:{divisionId:GroupUnitId;amount:number;sourceRef:string};
};
export function validateTransferPair(pair:TransferPair){
 const a=pair.debit,b=pair.credit;
 const eligible=Boolean(pair.transferId.trim()&&/^\d{4}-\d{2}$/.test(pair.period)&&pair.currency==='INR'
  &&pair.basis==='approved'&&a.divisionId!==b.divisionId&&a.sourceRef.trim()&&b.sourceRef.trim()
  &&a.sourceRef!==b.sourceRef&&Number.isFinite(a.amount)&&a.amount>0
  &&Number.isFinite(b.amount)&&Math.abs(a.amount-b.amount)<=0.005);
 return {eligible,reason:eligible?'MATCHED_APPROVED_INTERNAL_PAIR':'UNVERIFIED_INTERNAL_PAIR'};
}
export type ConsolidationEvent={id:string;amount:number;divisionId:GroupUnitId;class:'external'|'internal';transferId?:string};
export function consolidateGroupEvents(events:readonly ConsolidationEvent[],pairs:readonly TransferPair[]){
 const ids=new Set<string>();
 for(const x of events){
  if(ids.has(x.id)||!GROUP_UNITS.some(g=>g.id===x.divisionId)||!Number.isFinite(x.amount)||x.amount<0)
   return {groupAmount:null,eliminatedAmount:0,status:'HOLD_INVALID_EVENT'};
  ids.add(x.id);
 }
 const internals=events.filter(x=>x.class==='internal');
 const pairMap=new Map(pairs.map(x=>[x.transferId,x]));
 if(pairMap.size!==pairs.length||pairs.some(x=>!validateTransferPair(x).eligible)
   ||internals.some(x=>!x.transferId||!pairMap.has(x.transferId)
     ||(pairMap.get(x.transferId)?.credit.divisionId!==x.divisionId)
     ||Math.abs((pairMap.get(x.transferId)?.credit.amount||0)-x.amount)>0.005))
  return {groupAmount:null,eliminatedAmount:0,status:'HOLD_UNMATCHED_INTERNAL'};
 return {groupAmount:events.filter(x=>x.class==='external').reduce((n,x)=>n+x.amount,0),
  eliminatedAmount:internals.reduce((n,x)=>n+x.amount,0),status:'QUALIFIED_INTERNAL_PAIRS_ONLY'};
}
