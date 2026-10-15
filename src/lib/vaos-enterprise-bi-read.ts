import type {getSql} from "./db";

/** Signed VAOS founder BI: canonical, read-only, date-scoped database aggregates.
 * The owner of record remains VYNDI OS; this route never attributes a source
 * transaction to an AI employee's execution without VAOS handoff evidence.
 */
type Sql = Awaited<ReturnType<typeof getSql>>;
export const VYNDI_BI_DEPARTMENTS = Object.freeze({
 orchestrator:{table:"vyndi_audit_events",label:"Enterprise governance events"},
 project:{table:"vyndi_program_tasks",label:"Programme and project tasks"},
 vibpe:{table:"vyndi_engineering_baselines",label:"Engineering baselines"},
 risk:{table:"vyndi_risk_intelligence",label:"Engineering and enterprise risk"},
 knowledge:{table:"vyndi_engineering_documents",label:"Controlled engineering documents"},
 release:{table:"vyndi_quality_releases",label:"Quality release evidence"},
 qa:{table:"vyndi_quality_ncrs",label:"Quality nonconformances"},
 commercial:{table:"vyndi_sales_orders",label:"Customer and sales orders"},
 procurement:{table:"vyndi_purchase_orders",label:"Purchase orders"},
 inventory:{table:"epr_inventory_ledger",label:"Inventory movements"},
 production:{table:"epr_production_job_cards",label:"Production job cards"},
 maintenance:{table:"vyndi_maintenance_work_orders",label:"Maintenance work orders"},
 finance:{table:"epr_finance_journals",label:"Finance journals"},
 people:{table:"vyndi_people_records",label:"People records"},
 "engineering-configuration":{table:"vyndi_engineering_change_orders",label:"Engineering change orders"},
 security:{table:"vyndi_access_events",label:"Access governance events"}
} as const);
type Employee = keyof typeof VYNDI_BI_DEPARTMENTS;
const SAFE_FIELDS=["id","status","state","outcome","stage","action","source_reference","record_origin","reference","sku",
"revision","bom_revision","release_disposition","priority","closed_at","completed_at","updated_at","created_at",
"recorded_at","posted_at","entry_date","due_date","due_at","occurred_at","event_at","effective_at"];
const EVENT_FIELDS=["closed_at","completed_at","decided_at","released_at","approved_at","issued_at",
"occurred_at","event_at","posted_at","recorded_at","transaction_date","entry_date","order_date","opened_at",
"effective_at","updated_at","created_at"];
const scalar=(v:unknown)=>v==null||["string","number","boolean"].includes(typeof v);
export function validateBiScope(input: Record<string,unknown>) {
 const from=String(input.from??""),to=String(input.to??"");
 const employeeId=String(input.employeeId??"all");
 const offset=Number(input.offset??0),limit=Number(input.limit??50);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to)
   || !Number.isFinite(Date.parse(from))||!Number.isFinite(Date.parse(to))
   ||from>to|| Date.parse(to)-Date.parse(from)>366*86400000
   ||to>new Date().toISOString().slice(0,10)
   ||!Number.isSafeInteger(offset)||offset<0||offset>5000
   ||!Number.isSafeInteger(limit)||limit<1||limit>100
   ||(employeeId!=="all"&&!(employeeId in VYNDI_BI_DEPARTMENTS))) {
  throw new Error("INVALID_BI_SCOPE");
 }
 return {employeeId:employeeId as Employee|"all",from,to,offset,limit};
}
function eventDate(record:Record<string,unknown>):string|null {
 for(const key of EVENT_FIELDS) {
  const v=record[key];
  if(typeof v==="string"&&/^\d{4}-\d\d-\d\d/.test(v)
    &&Number.isFinite(Date.parse(v.slice(0,10)))) return v.slice(0,10);
 }
 return null;
}
export function classifyBiSample(value:Record<string,unknown>){
 const date=eventDate(value);
 const status=String(value.status??value.state??value.outcome??value.stage??"Unclassified").slice(0,64);
 const fields=Object.fromEntries(SAFE_FIELDS
  .filter(k=>scalar(value[k])&&value[k]!==undefined&&value[k]!==null)
  .slice(0,22).map(k=>[k,typeof value[k]==="string"?String(value[k]).slice(0,200):value[k]]));
 return {date,status,fields};
}
const dateSql=(r:string)=>{
 const fields=EVENT_FIELDS.map(k=>`nullif(${r}->>'${k}','')`).join(",");
 return `case when left(coalesce(${fields}),10) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}
};
async function readOne(sql:Sql,employeeId:Employee,from:string,to:string,offset:number,limit:number){
 const meta=VYNDI_BI_DEPARTMENTS[employeeId];
 // Static table whitelist only. No user-supplied SQL identifiers or unapproved columns.
 const table=meta.table;
 const date=dateSql("t.rec");
 const base=`from (select to_jsonb(r) as rec from ${table} r) t`;
 const where=`where ${date} >= $1 and ${date} <= $2`;
 const summaries=await sql.query<{status:string;quantity:string}>(
  `select left(coalesce(nullif(t.rec->>'status',''),nullif(t.rec->>'state',''),
         nullif(t.rec->>'outcome',''),nullif(t.rec->>'stage',''),'Unclassified'),64) as status,
     count(*)::text as quantity ${base} ${where}
     group by 1 order by count(*) desc,status`,[from,to]);
 const current=await sql.query<{status:string;quantity:string}>(
  `select left(coalesce(nullif(t.rec->>'status',''),nullif(t.rec->>'state',''),
         nullif(t.rec->>'outcome',''),nullif(t.rec->>'stage',''),'Unclassified'),64) as status,
     count(*)::text as quantity ${base}
     group by 1 order by count(*) desc,status`,[]);
 const records=await sql.query<{rec:Record<string,unknown>}>(
  `select t.rec ${base} ${where}
     order by ${date} desc,coalesce(t.rec->>'id','') desc limit $3 offset $4`,
  [from,to,limit,offset]);
 const statusDistribution=summaries.map(r=>({status:r.status,count:Number(r.quantity)}));
 const currentStatusDistribution=current.map(r=>({status:r.status,count:Number(r.quantity)}));
 const currentSourceCount=currentStatusDistribution.reduce((sum,r)=>sum+r.count,0);
 const currentAttentionCount=currentStatusDistribution.filter(r=>
  /(?:^|[_ -])(open|draft|planned|pending|blocked|hold|failed|overdue|rejected|in.progress|awaiting)(?:$|[_ -])/i.test(r.status))
  .reduce((sum,r)=>sum+r.count,0);
 const total=statusDistribution.reduce((sum,r)=>sum+r.count,0);
 const issues=statusDistribution.filter(r=>/fail|block|hold|reject|mismatch|overdue|open|shortage|nonconform/i.test(r.status))
  .reduce((sum,r)=>sum+r.count,0);
 return {employeeId,department:meta.label,sourceTable:meta.table,
  periodEventCount:total,flaggedStatusCount:issues,statusDistribution,
  currentSourceCount,currentAttentionCount,currentStatusDistribution,
  records:records.map(r=>classifyBiSample(r.rec)),
  isCompleteAggregate:true,detailPage:{offset,limit,hasMore:offset+records.length<total},
  timestampMeaning:"FIRST_RECORDED_SOURCE_DATE_BY_AVAILABLE_FIELD",
  forecast:{status:"UNAVAILABLE",reason:"No independently qualified dated forecast in this source."}};
}
/** Fail a single missing or uncommissioned department independently, never invent zeros. */
export async function readEnterpriseBi(sql:Sql,input:Record<string,unknown>){
 const scope=validateBiScope(input);
 const selected=(scope.employeeId==="all"?Object.keys(VYNDI_BI_DEPARTMENTS):[scope.employeeId]) as Employee[];
 const results=await Promise.all(selected.map(async employeeId=>{
  try{return {status:"OBSERVED",...(await readOne(sql,employeeId,scope.from,scope.to,scope.offset,scope.limit))};}
  catch{return {status:"UNAVAILABLE",employeeId,department:VYNDI_BI_DEPARTMENTS[employeeId].label,
   reason:"Authoritative source is not queryable or not commissioned; counts and forecast unknown."};}
 }));
 return {schemaVersion:"VYNDI_ENTERPRISE_BI_V1",readOnly:true,
  period:{from:scope.from,to:scope.to},scope:scope.employeeId,
  observedAt:new Date().toISOString(),departments:results,
  interpretation:[
   "Period counts are complete within each OBSERVED source table, unlike sampled row previews.",
   "The reporting date reflects the first available recorded source-date field, not necessarily a verified finish date.",
   "Flagged statuses are review leads, not confirmed duplicate errors or independent audits.",
   "Records are business source evidence, not proof an AI agent personally completed that work.",
   "Missing or undated business records cannot be interpreted as zero and are excluded from dated totals.",
   "Current backlog flags are all-time latest recorded statuses, separate from period activity; a flagged state is not an audited discrepancy or proof of lateness."
  ]};
}

 then left(coalesce(${fields}),10) else null end`;
};
async function readOne(sql:Sql,employeeId:Employee,from:string,to:string,offset:number,limit:number){
 const meta=VYNDI_BI_DEPARTMENTS[employeeId];
 // Static table whitelist only. No user-supplied SQL identifiers or unapproved columns.
 const table=meta.table;
 const date=dateSql("t.rec");
 const base=`from (select to_jsonb(r) as rec from ${table} r) t`;
 const where=`where ${date} >= $1 and ${date} <= $2`;
 const summaries=await sql.query<{status:string;quantity:string}>(
  `select left(coalesce(nullif(t.rec->>'status',''),nullif(t.rec->>'state',''),
         nullif(t.rec->>'outcome',''),nullif(t.rec->>'stage',''),'Unclassified'),64) as status,
     count(*)::text as quantity ${base} ${where}
     group by 1 order by count(*) desc,status`,[from,to]);
 const records=await sql.query<{rec:Record<string,unknown>}>(
  `select t.rec ${base} ${where}
     order by ${date} desc,coalesce(t.rec->>'id','') desc limit $3 offset $4`,
  [from,to,limit,offset]);
 const statusDistribution=summaries.map(r=>({status:r.status,count:Number(r.quantity)}));
 const total=statusDistribution.reduce((sum,r)=>sum+r.count,0);
 const issues=statusDistribution.filter(r=>/fail|block|hold|reject|mismatch|overdue|open|shortage|nonconform/i.test(r.status))
  .reduce((sum,r)=>sum+r.count,0);
 return {employeeId,department:meta.label,sourceTable:meta.table,
  periodEventCount:total,flaggedStatusCount:issues,statusDistribution,
  records:records.map(r=>classifyBiSample(r.rec)),
  isCompleteAggregate:true,detailPage:{offset,limit,hasMore:offset+records.length<total},
  timestampMeaning:"FIRST_RECORDED_SOURCE_DATE_BY_AVAILABLE_FIELD",
  forecast:{status:"UNAVAILABLE",reason:"No independently qualified dated forecast in this source."}};
}
/** Fail a single missing or uncommissioned department independently, never invent zeros. */
export async function readEnterpriseBi(sql:Sql,input:Record<string,unknown>){
 const scope=validateBiScope(input);
 const selected=(scope.employeeId==="all"?Object.keys(VYNDI_BI_DEPARTMENTS):[scope.employeeId]) as Employee[];
 const results=await Promise.all(selected.map(async employeeId=>{
  try{return {status:"OBSERVED",...(await readOne(sql,employeeId,scope.from,scope.to,scope.offset,scope.limit))};}
  catch{return {status:"UNAVAILABLE",employeeId,department:VYNDI_BI_DEPARTMENTS[employeeId].label,
   reason:"Authoritative source is not queryable or not commissioned; counts and forecast unknown."};}
 }));
 return {schemaVersion:"VYNDI_ENTERPRISE_BI_V1",readOnly:true,
  period:{from:scope.from,to:scope.to},scope:scope.employeeId,
  observedAt:new Date().toISOString(),departments:results,
  interpretation:[
   "Period counts are complete within each OBSERVED source table, unlike sampled row previews.",
   "The reporting date reflects the first available recorded source-date field, not necessarily a verified finish date.",
   "Flagged statuses are review leads, not confirmed duplicate errors or independent audits.",
   "Records are business source evidence, not proof an AI agent personally completed that work.",
   "Missing or undated business records cannot be interpreted as zero and are excluded from dated totals."
  ]};
}
