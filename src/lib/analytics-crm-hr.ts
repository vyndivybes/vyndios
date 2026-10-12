/** CRM and HR leadership-grade aggregate reads.
 * These are the ONLY fields allowed to cross into the group analytics surface.
 * Customer contact records, worker identity, salary and payroll amounts stay
 * behind their source-module access controls.
 */
export const GROUP_AGGREGATE_QUERIES={
 crmCustomers:{
  query:"select segment as category, lifecycle as status, count(*)::int as record_count from vyndi_crm_customers group by segment,lifecycle order by segment,lifecycle",
  keys:['category','status','record_count'],
 },
 crmFollowups:{
  query:"select kind as category, case when kind='followup' and completed_at is null and due_on<current_date then 'overdue' when kind='followup' and completed_at is null then 'open' when kind='followup' then 'completed' else 'logged' end as status, count(*)::int as record_count from vyndi_crm_activities group by kind, case when kind='followup' and completed_at is null and due_on<current_date then 'overdue' when kind='followup' and completed_at is null then 'open' when kind='followup' then 'completed' else 'logged' end order by kind,status",
  keys:['category','status','record_count'],
 },
 hrWorkforce:{
  query:"select engagement_type as category, lifecycle_status as status, count(*)::int as record_count from vyndi_people_records group by engagement_type,lifecycle_status order by engagement_type,lifecycle_status",
  keys:['category','status','record_count'],
 },
 hrAttendance:{
  query:"select attendance_status as category, attendance_status as status, count(*)::int as record_count from vyndi_people_attendance_current group by attendance_status order by attendance_status",
  keys:['category','status','record_count'],
 },
 hrPayrollReadiness:{
  query:"select period_key as category, readiness_status as status, count(*)::int as record_count from vyndi_people_payroll_readiness_current group by period_key,readiness_status order by period_key,readiness_status",
  keys:['category','status','record_count'],
 },
} as const;

type AggregateRecord={category:string;status:string;record_count:number};
const allow=new Set(['category','status','record_count']);
/** Fail the whole dataset closed when the projection is malformed or unapproved. */
export function validateAggregateRows(rows:unknown):AggregateRecord[]{
 if(!Array.isArray(rows)||rows.length>1000)throw Error('GROUP_AGGREGATE_INVALID');
 return rows.map((value:unknown)=>{
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('GROUP_AGGREGATE_INVALID');
  const r=value as Record<string,unknown>;
  if(Object.keys(r).some(k=>!allow.has(k))
   ||typeof r.category!=='string'||r.category.length>120||!r.category.trim()
   ||typeof r.status!=='string'||r.status.length>120||!r.status.trim()
   ||typeof r.record_count!=='number'||!Number.isSafeInteger(r.record_count)||r.record_count<0)throw Error('GROUP_AGGREGATE_INVALID');
  return {category:r.category,status:r.status,record_count:r.record_count};
 });
}
