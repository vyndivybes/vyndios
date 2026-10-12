import {createServerFn} from '@tanstack/react-start';
import {z} from 'zod';
import {getSql} from '@/lib/db';
import {requireBusinessActor} from '@/lib/business-actor';
import {getCommandRole} from '@/lib/command-access';
import {canPerform} from '@/lib/page-access';
import {getRouteMeta} from '@/lib/page-metadata';
import {
 GROUP_UNITS,GROUP_SOURCE_KINDS,aggregateDivisionSources,
 type GroupSourceKind,type GroupSourceBucket,type GroupSourceCoverage,
} from './group-consolidation';

// Static whitelist: source records cannot be invented or mapped through arbitrary SQL.
const SOURCE_TABLES={
 sales_order:'vyndi_sales_orders',
 job_card:'epr_production_job_cards',
 purchase_order:'vyndi_purchase_order_status',
 sales_invoice:'vyndi_invoices',
 supplier_invoice:'vyndi_supplier_invoices',
 crm_customer:'vyndi_crm_customers',
 people_record:'vyndi_people_records',
} as const;

async function requireManagement(permission:'view'|'edit'|'approve'){
 const role=await getCommandRole();
 if(!role||!canPerform(role,permission,getRouteMeta('/command/analytics-studio'))
   ||!['admin','management','board'].includes(role))throw Error('Group attribution permission denied');
 const actor=await requireBusinessActor(permission);
 // Role policy is checked independently; the authenticated business identity
 // must not be bypassed by a Command-only impersonation or fallback account.
 return actor;
}

const rowToCount=(input:unknown)=>{
 const n=Number(input);
 if(!Number.isSafeInteger(n)||n<0)throw Error('GROUP_SOURCE_COUNT_INVALID');
 return n;
};
function safeBucket(row:Record<string,unknown>,sourceKind:GroupSourceKind):GroupSourceBucket{
 const id=row.division_id;
 const valid=typeof id==='string'&&GROUP_UNITS.some(x=>x.id===id);
 if(id!==null&&id!==undefined&&!valid)throw Error('GROUP_DIVISION_UNKNOWN');
 const count=rowToCount(row.count);
 const unitValue=row.units===null||row.units===undefined?undefined:Number(row.units);
 if(unitValue!==undefined&&(!Number.isFinite(unitValue)||unitValue<0))throw Error('GROUP_UNITS_INVALID');
 return {sourceKind,divisionId:valid?id as GroupSourceBucket['divisionId']:null,count,
  ...(sourceKind==='sales_order'?{units:unitValue??0}:{})};
}

/** All seven source counts are computed inside Postgres; no raw HR names,
 * employee IDs, customer emails or personal records are transmitted.
 */
export const getGroupPortfolio=createServerFn({method:'GET'}).handler(async()=>{
 await requireManagement('view');
 const sql=await getSql();
 const batches=await Promise.all(GROUP_SOURCE_KINDS.map(async(kind)=>{
  try{
   const table=SOURCE_TABLES[kind];
   const value=kind==='sales_order'?", coalesce(sum(s.units),0)::numeric as units":"";
   const query='select a.division_id,count(*)::int as count'+value
     +' from '+table+' s left join vyndi_group_approved_attributions a'
     +' on a.source_kind=$1 and a.source_id=s.id group by a.division_id';
   const data=await sql.query<Record<string,unknown>>(query,[kind]);
   return {kind,status:'PASS' as const,buckets:data.map(row=>safeBucket(row,kind))};
  }catch{
   return {kind,status:'HOLD' as const,buckets:[] as GroupSourceBucket[]};
  }
 }));
 const coverage=Object.fromEntries(batches.map(x=>[x.kind,x.status])) as GroupSourceCoverage;
 const buckets=batches.flatMap(x=>x.buckets);
 const result=aggregateDivisionSources(buckets,coverage);
 // No cash, revenue or group-wide cost numbers are inferred from source counts.
 return {asOf:new Date().toISOString(),units:GROUP_UNITS,coverage,...result,
  accountingConsolidationQualified:false,forecastByDivisionQualified:false,
  divisionAttributionComplete:result.coverage.complete,
  legalConsolidationQualified:false};
});

const proposal=z.object({
 sourceKind:z.enum(GROUP_SOURCE_KINDS),
 sourceId:z.string().trim().min(1).max(120),
 divisionId:z.enum(GROUP_UNITS.map(x=>x.id) as [typeof GROUP_UNITS[number]['id'],...typeof GROUP_UNITS[number]['id'][]]),
 costCenter:z.string().trim().regex(/^[A-Z0-9_-]{2,60}$/),
 evidenceRef:z.string().trim().min(5).max(500),
}).strict();

/** Proposals carry only management metadata. No source transaction is edited. */
export const proposeGroupAttribution=createServerFn({method:'POST'})
 .validator(proposal)
 .handler(async({data})=>{
  const actor=await requireManagement('edit');
  if(!['admin','management'].includes(actor.role))throw Error('Group assignment maker role required');
  const sql=await getSql();
  const table=SOURCE_TABLES[data.sourceKind];
  const source=await sql.query<{id:string}>('select id from '+table+' where id=$1 limit 1',[data.sourceId]);
  if(!source[0])throw Error('Group attribution source record not found');
  const id='GROUP-ATTR-'+crypto.randomUUID();
  const auditId=crypto.randomUUID();
  const rows=await sql.query<{id:string;status:string}>(
   "with saved as (insert into vyndi_group_attribution_requests"+
   " (id,source_kind,source_id,division_id,cost_center,evidence_ref,submitted_by,submitted_role)"+
   " values ($1,$2,$3,$4,$5,$6,$7,$8) returning id,status,division_id),"+
   " logged as (insert into vyndi_audit_events"+
   " (id,entity_type,entity_id,action,actor_user_id,actor_role,source_reference,payload_json)"+
   " select $9,'group_attribution',id,'proposed',$7,$8,$6,"+
   " jsonb_build_object('source_kind',$2,'division',$4,'cost_center',$5) from saved returning id)"+
   " select saved.id,saved.status from saved join logged on true",
   [id,data.sourceKind,data.sourceId,data.divisionId,data.costCenter,
    data.evidenceRef,actor.userId,actor.role,auditId]);
  if(!rows[0])throw Error('Group attribution proposal not recorded');
  return {id:rows[0].id,status:'proposed' as const,decisionQualified:false};
 });
const decision=z.object({
 id:z.string().regex(/^GROUP-ATTR-[0-9a-f-]{36}$/i),
 decision:z.enum(['approved','rejected']),
 evidenceRef:z.string().trim().min(5).max(500),
}).strict();

export const decideGroupAttribution=createServerFn({method:'POST'})
 .validator(decision)
 .handler(async({data})=>{
  const actor=await requireManagement('approve');
  if(!['admin','board'].includes(actor.role))throw Error('Group assignment checker role required');
  const sql=await getSql();
  const auditId=crypto.randomUUID();
  const rows=await sql.query<{id:string;status:string}>(
   "with decided as (update vyndi_group_attribution_requests"+
   " set status=$2,decided_by=$3,decided_role=$4,decision_evidence_ref=$5,decided_at=now()"+
   " where id=$1 and status='proposed' and submitted_by<>$3 returning id,status),"+
   " logged as (insert into vyndi_audit_events"+
   " (id,entity_type,entity_id,action,actor_user_id,actor_role,source_reference,payload_json)"+
   " select $6,'group_attribution',id,status,$3,$4,$5,jsonb_build_object('decision',status)"+
   " from decided returning id)"+
   " select decided.id,decided.status from decided join logged on true",
   [data.id,data.decision,actor.userId,actor.role,data.evidenceRef,auditId]);
  if(!rows[0])throw Error('Group attribution decision not admitted: missing proposal or maker/checker conflict');
  return {id:rows[0].id,status:rows[0].status,decidedBySeparateReviewer:true};
 });

/** Pending proposals are shown only to authenticated management operators. */
export const listPendingGroupAttributions=createServerFn({method:'GET'}).handler(async()=>{
 const actor=await requireManagement('view');
 if(!['admin','management','board'].includes(actor.role))throw Error('Group classification review denied');
 const sql=await getSql();
 return sql.query<{
  id:string;source_kind:GroupSourceKind;source_id:string;
  division_id:string;cost_center:string;evidence_ref:string;
  submitted_by:string;submitted_at:string;
 }>("select id,source_kind,source_id,division_id,cost_center,evidence_ref,submitted_by,submitted_at::text"+
   " from vyndi_group_attribution_requests where status='proposed' order by submitted_at desc limit 100");
});
