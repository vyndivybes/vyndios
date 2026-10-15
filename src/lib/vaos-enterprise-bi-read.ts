import {buildForecastLearningFromSql} from './forecast-learning-read.ts';
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
// Specialist ledgers remain owned by their existing workspaces. Counts across
// these heterogeneous sources must never be summed as departmental output.
export const VYNDI_BI_RELATED:Record<Employee,readonly string[]>={
 orchestrator:["vyndi_operating_actions"],
 project:["vyndi_program_dependencies","vyndi_program_forecast_runs"],
 vibpe:["vyndi_advanced_planning_packets","vyndi_program_forecast_runs"],
 risk:["vyndi_legal_register"],
 knowledge:["vyndi_engineering_document_revisions","vibpe_knowledge_claims"],
 release:["vyndi_quality_inspections"],
 qa:["vyndi_quality_capas","vyndi_quality_inspections"],
 commercial:["vyndi_shipments","vyndi_collections"],
 procurement:["vyndi_goods_receipts","vyndi_supplier_invoices"],
 inventory:["vyndi_inventory_balance","epr_inventory_stocktakes","epr_inventory_stocktake_lines"],
 production:["epr_production_job_card_lines"],
 maintenance:["vyndi_maintenance_plans","vyndi_maintenance_parts"],
 finance:["epr_finance_posting_exceptions","epr_finance_period_closures","vyndi_learning_period_closes"],
 people:["vyndi_people_employment_ledger","vyndi_people_attendance_ledger","vyndi_people_leave_ledger",
  "vyndi_people_qualification_ledger","vyndi_people_asset_custody_ledger","vyndi_people_access_ledger",
  "vyndi_people_payroll_readiness_ledger","vyndi_people_exit_cases","vyndi_people_exit_clearance_ledger"],
 "engineering-configuration":["vyndi_engineering_change_requests","vyndi_engineering_change_effectivity","vyndi_engineering_configuration_manifests"],
 security:["vyndi_access_role_change_requests"]
};
const SAFE_FIELDS=["id","status","state","outcome","stage","action","source_reference","record_origin","reference","sku",
"revision","bom_revision","release_disposition","priority","closed_at","completed_at","updated_at","created_at",
"recorded_at","posted_at","entry_date","due_date","due_at","occurred_at","event_at","effective_at",
"source_ref","evidence_ref","decision","result","disposition","operational_status","lifecycle_status","issue_status",
"event_type","entity_type","entity_id","sales_order_id","job_card_id","journal_id","ncr_id","revision_code",
"product_id","unit","units","quantity","quantity_delta","physical_quantity","reserved_quantity","available_to_promise",
"asp_lakh","amount_inr","debit_inr","credit_inr","plan_month","due_month","priority","severity","exposure_score","fmea_rpn",
"planned_start","planned_finish","actual_start","actual_finish","estimated_effort_hours","actual_effort_hours",
"source_type","source_id","inspection_stage","sample_size","defect_quantity","evidence_reference",
"plan_id","work_order_id","effective_on","work_date","scheduled_for","expected_receipt_on",
"inspection_status","attendance_status","qualification_status","readiness_status","engagement_type",
"unit_price_inr","quantity_received","quantity_accepted","quantity_quarantined","quantity_rejected",
"amount_ex_gst_inr","gst_inr","expected_quantity","counted_quantity","counted_at","stocktake_id","unit_cost_inr",
"paid_on","received_on","invoice_on","shipped_on","collected_on","method","minimum_closed_periods","eligible_closed_periods","available"];
const EVENT_FIELDS=["actual_finish","closed_at","completed_at","decided_at","released_at","approved_at","issued_at",
"occurred_at","event_at","posted_at","recorded_at","transaction_date","entry_date","order_date","opened_at",
"paid_on","received_on","invoice_on","shipped_on","collected_on","counted_at",
"effective_on","work_date","effective_at","requested_at","updated_at","created_at"];
const STATUS_FIELDS=["status","operational_status","lifecycle_status","issue_status","inspection_status","attendance_status","qualification_status","readiness_status","state","outcome","stage","decision","result","event_type","action"];
const scalar=(v:unknown)=>v==null||["string","number","boolean"].includes(typeof v);
const validDay=(v:string)=>/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
export function validateBiScope(input: Record<string,unknown>) {
 const from=String(input.from??""),to=String(input.to??"");
 const employeeId=String(input.employeeId??"all");
 const offset=Number(input.offset??0),limit=Number(input.limit??50);
 if(!validDay(from)||!validDay(to)
   ||from>to|| Date.parse(to)-Date.parse(from)>366*86400000
   ||to>new Date().toISOString().slice(0,10)
   ||!Number.isSafeInteger(offset)||offset<0||offset>5000
   ||!Number.isSafeInteger(limit)||limit<1||limit>100
   ||(employeeId!=="all"&&!Object.hasOwn(VYNDI_BI_DEPARTMENTS,employeeId))) {
  throw new Error("INVALID_BI_SCOPE");
 }
 return {employeeId:employeeId as Employee|"all",from,to,offset,limit};
}
function eventDate(record:Record<string,unknown>):string|null {
 for(const key of EVENT_FIELDS) {
  const v=record[key];
  if(typeof v==="string"&&/^\d{4}-\d\d-\d\d/.test(v)
    &&validDay(v.slice(0,10))) return v.slice(0,10);
 }
 return null;
}
export function classifyBiSample(value:Record<string,unknown>){
 const date=eventDate(value);
 const status=String(STATUS_FIELDS.map(k=>value[k]).find(v=>typeof v==='string'&&v.trim())??"Unclassified").slice(0,64);
 const fields=Object.fromEntries(SAFE_FIELDS
  .filter(k=>scalar(value[k])&&value[k]!==undefined&&value[k]!==null)
  .map(k=>[k,typeof value[k]==="string"?String(value[k]).slice(0,200):value[k]]));
 const dateField=EVENT_FIELDS.find(k=>typeof value[k]==='string'&&validDay(String(value[k]).slice(0,10)))??null;
 return {date,dateField,status,fields};
}
const dateSql=(r:string)=>{
 const fields=EVENT_FIELDS.map(k=>`nullif(${r}->>'${k}','')`).join(",");
 const value=`left(coalesce(${fields}),10)`;
 return `case when ${value} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
 and pg_input_is_valid(${value},'date') then ${value} else null end`;
};
export function biStateCounts(rows:{status:string;count:number}[],employeeId:string){
 const result={finished:0,pending:0,blocked:0,other:0};
 for(const r of rows){
  const status=r.status.toLowerCase().replaceAll(' ','_');
  const bucket=/^(blocked|hold|on_hold|failed|fail|rejected|quarantine|short|overdue)$/.test(status)?'blocked':
   /^(complete|completed|closed|delivered|posted|verified|implemented)$/.test(status)||
    (employeeId==='release'&&status==='released')?'finished':
   /^(open|draft|planned|pending|pending_approval|ready|in_progress|scheduled|confirmed|released|issued|contained|under_capa|mitigating|awaiting)$/.test(status)?'pending':'other';
  result[bucket]+=r.count;
 }
 return result;
}
async function readOne(sql:Sql,employeeId:Employee,from:string,to:string,offset:number,limit:number,table:string){
 const status=`left(coalesce(${STATUS_FIELDS.map(k=>`nullif(t.rec->>'${k}','')`).join(',')},'Unclassified'),64)`;
 const training=`(coalesce(t.rec->>'record_origin','') ~* '^(training|fixture|synthetic|qualification|test|canary)$'
 or coalesce(t.rec->>'id','') ~* '^(VAOS-QUAL-|VAOS-CANARY-|TEST[-_:]|UAT[-_:]|FIXTURE[-_:]|SYNTHETIC[-_:]|TRAINING[-_:])'
 or coalesce(t.rec->>'source_reference',t.rec->>'source_ref','') ~* '^(test:|fixture:|synthetic:|training:|qualification:|canary:)')`;
 // One statement gives internally consistent totals and detail, scanning a source
 // once. Only the statically governed table names above reach this query.
 const [result]=await sql.query<{summary:{status:string;quantity:number;current:number;undated:number;training:number;unknown:number}[];records:Record<string,unknown>[]}>(
  `with source as materialized (
    select t.rec,${dateSql('t.rec')} as date,${status} as status,${training} as training,
     coalesce(t.rec->>'record_origin','') !~* '^(business|production|actual)$' as unknown_origin
    from (select to_jsonb(r) as rec from ${table} r) t
   ), summary as (
    select status,count(*) filter(where not training and date between $1 and $2)::int as quantity,
     count(*) filter(where not training)::int as current,
     count(*) filter(where not training and date is null)::int as undated,
     count(*) filter(where training)::int as training,
     count(*) filter(where not training and unknown_origin)::int as unknown
    from source group by status
   ), page as (
    select (select jsonb_object_agg(k,v) from jsonb_each(rec) e(k,v) where k=any($5::text[])) as rec from source where not training and date between $1 and $2
    order by date desc,coalesce(rec->>'id','') desc,rec::text limit $3 offset $4
   ) select coalesce((select jsonb_agg(to_jsonb(s) order by s.status) from summary s),'[]'::jsonb) as summary,
     coalesce((select jsonb_agg(rec) from page),'[]'::jsonb) as records`,[from,to,limit,offset,[...new Set([...SAFE_FIELDS,...EVENT_FIELDS])]]);
 if(!result||!Array.isArray(result.summary)||!Array.isArray(result.records))throw Error('BI_SOURCE_SHAPE');
 const statusDistribution=result.summary.filter(r=>r.quantity>0).map(r=>({status:r.status,count:r.quantity}));
 const currentStatusDistribution=result.summary.filter(r=>r.current>0).map(r=>({status:r.status,count:r.current}));
 const total=statusDistribution.reduce((sum,r)=>sum+r.count,0);
 const currentStates=biStateCounts(currentStatusDistribution,employeeId);
 const sum=(key:'undated'|'training'|'unknown')=>result.summary.reduce((n,r)=>n+r[key],0);
 return {sourceTable:table,status:'OBSERVED' as const,
  periodEventCount:total,flaggedStatusCount:biStateCounts(statusDistribution,employeeId).blocked,statusDistribution,
  currentSourceCount:currentStatusDistribution.reduce((sum,r)=>sum+r.count,0),
  currentAttentionCount:currentStates.pending+currentStates.blocked,currentStatusDistribution,
  periodRecordedStates:biStateCounts(statusDistribution,employeeId),currentRecordedStates:currentStates,
  undatedCount:sum('undated'),excludedTrainingCount:sum('training'),unclassifiedOriginCount:sum('unknown'),
  records:result.records.map(classifyBiSample),
  isCompleteAggregate:true,detailPage:{offset,limit,hasMore:offset+result.records.length<total},
  timestampMeaning:'FIRST_AVAILABLE_SOURCE_DATE_CURRENT_ROW_NOT_EVENT_HISTORY',
  forecast:{status:'UNAVAILABLE',reason:'No independently qualified dated workforce forecast in this source.'}};
}
/** Fail a single missing or uncommissioned department independently, never invent zeros. */
export async function readEnterpriseBi(sql:Sql,input:Record<string,unknown>){
 const scope=validateBiScope(input);
 const selected=(scope.employeeId==="all"?Object.keys(VYNDI_BI_DEPARTMENTS):[scope.employeeId]) as Employee[];
 const results=[];
 // Bound database work on the existing free infrastructure. Each source fails
 // independently. No 16-way fanout into the request-scoped connection pool.
 for(const employeeId of selected){
  const meta=VYNDI_BI_DEPARTMENTS[employeeId];
  const sources=[];
  for(const table of [meta.table,...VYNDI_BI_RELATED[employeeId]]){
   try{sources.push(await readOne(sql,employeeId,scope.from,scope.to,scope.offset,scope.employeeId==='all'?Math.min(scope.limit,5):scope.limit,table));}
   catch{sources.push({status:'UNAVAILABLE' as const,sourceTable:table,reason:'Source query unavailable; counts unknown.'});}
  }
  const primary=sources[0];
  results.push({...primary,employeeId,department:meta.label,sources,
   coverage:{status:sources.every(s=>s.status==='OBSERVED')?'OBSERVED':'PARTIAL_OR_UNAVAILABLE',
    observed:sources.filter(s=>s.status==='OBSERVED').length,expected:sources.length},
   planVsActual:{status:'UNAVAILABLE',reason:'No approved comparable departmental business baseline joined to these records. Approved VAOS work baselines are reported separately.'},
   audit:{status:'NOT_INDEPENDENTLY_AUDITED',reason:'Source statuses and exception ledgers are evidence for review. Independent departmental reviews and CAPA retests are in the workforce assurance report.'}});
 }
 let businessPlanComparison;
 try{
  const learning=await buildForecastLearningFromSql(sql,{from:scope.from,to:scope.to});
  businessPlanComparison={status:learning.samples?'CLOSED_PERIOD_COMPARISON':'UNAVAILABLE',
   scope:'ENTERPRISE_PRODUCT_DEMAND_NOT_EMPLOYEE_OUTPUT',
   source:'IMMUTABLE_APPROVED_PLAN_VINTAGES_AND_GOVERNED_PERIOD_CLOSES',
   planUnits:learning.samples?learning.planUnits:null,actualUnits:learning.samples?learning.actualUnits:null,
   varianceUnits:learning.samples?learning.actualUnits-learning.planUnits:null,
   rows:learning.rows.slice(0,108),completeRows:learning.rows.length<=108,
   forecastAssessment:{status:learning.available?'BACKTEST_AVAILABLE':'UNAVAILABLE',
    reason:learning.reason,minimumClosedPeriods:learning.minimumClosedPeriods,closedPeriods:learning.closedPeriods,
    wapePct:learning.wapePct,biasPct:learning.biasPct,
    futureDeliveryForecast:'UNAVAILABLE_NOT_INDEPENDENTLY_QUALIFIED'},
   note:'Whole closed periods contained in selected dates; later close revisions are excluded. This measures product-demand plan vs actual, not employee productivity or manufacturing yield.'};
 }catch{businessPlanComparison={status:'UNAVAILABLE',reason:'Governed vintage or period-close evidence unavailable; plan, actual and forecast unknown.'};}
 return {schemaVersion:"VYNDI_ENTERPRISE_BI_V1",readOnly:true,
  period:{from:scope.from,to:scope.to},scope:scope.employeeId,
  observedAt:new Date().toISOString(),departments:results,businessPlanComparison,
  interpretation:[
   "Counts cover each OBSERVED source independently; related sources overlap and must not be added as departmental output. Explicit training/fixture records are excluded and counted separately; unknown origin is disclosed.",
   "The reporting date reflects the first available recorded source-date field, not necessarily a verified finish date.",
   "Flagged statuses are review leads, not confirmed duplicate errors or independent audits.",
   "Records are business source evidence, not proof an AI agent personally completed that work.",
   "Missing or undated business records cannot be interpreted as zero and are excluded from dated totals.",
   "Current backlog flags are all-time latest recorded statuses, separate from period activity; a flagged state is not an audited discrepancy or proof of lateness."
  ]};
}
