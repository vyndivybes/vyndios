import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getSql } from "@/lib/db";
import { requireBusinessActor } from "@/lib/business-actor";
import { validateScheduleRevision } from "@/lib/schedule-revision-policy.mjs";

const PROGRAM_ID = "VYNDI-MASTER-PROGRAM";
const field = z.enum(["title","domain","workPackage","owner","plannedStart","plannedFinish","durationDays","predecessors","budgetLakh","milestoneMonth","scenario","scope","status","deferUntil"]);
const change = z.object({
  taskId:z.string().trim().min(2).max(120),
  field,
  before:z.unknown(),
  after:z.unknown(),
});
const proposal = z.object({
  id:z.string().trim().min(3).max(120),
  baseRevision:z.string().trim().min(2).max(120),
  scenario:z.string().trim().min(2).max(120).default("base"),
  reason:z.string().trim().min(5).max(2000),
  sourceReference:z.string().trim().min(2).max(500),
  changes:z.array(change).min(1).max(200),
});
const revisionId = z.object({id:z.string().trim().min(3).max(120)});

export const listScheduleRevisions = createServerFn({method:"GET"}).handler(async()=>{
  await requireBusinessActor("view");
  const sql=await getSql();
  const rows=await sql`select id,parent_revision_id,state,scenario,rationale,source_reference,
    proposed_by,proposed_at,reviewed_by,reviewed_at,approval_reference,approved_at,
    approved_timezone,baseline_hash,document_json
    from vyndi_schedule_revisions where program_id=${PROGRAM_ID} order by proposed_at desc limit 100`;
  return {revisions:[...rows]};
});

export const proposeScheduleRevision = createServerFn({method:"POST"})
  .validator(proposal)
  .handler(async({data})=>{
    const actor=await requireBusinessActor("edit");
    const check=validateScheduleRevision({
      id:data.id,baseRevision:data.baseRevision,status:"draft",author:actor.userId,
      reason:data.reason,sourceReference:data.sourceReference,changes:data.changes
    });
    if(!check.ok) throw new Error(check.errors.join("; "));
    const sql=await getSql();
    const taskIds=[...new Set(data.changes.map((item)=>item.taskId))];
    const programTasks=await sql`select id from vyndi_program_tasks where program_id=${PROGRAM_ID} and id=any(${taskIds})`;
    if(programTasks.length !== taskIds.length) throw new Error("Proposal contains unknown program task IDs.");
    const availableTasks=await sql`select id,title,domain,work_package,owner,duration_days,planned_start::text as planned_start,planned_finish::text as planned_finish,status
      from vyndi_program_tasks where program_id=${PROGRAM_ID} and id=any(${taskIds})`;
    const fieldMap:Record<string,string>={title:"title",domain:"domain",workPackage:"work_package",
      owner:"owner",durationDays:"duration_days",plannedStart:"planned_start",plannedFinish:"planned_finish",status:"status"};
    for(const item of data.changes){
      if(!Object.hasOwn(fieldMap,item.field)) continue;
      const row=availableTasks.find((candidate)=>candidate.id===item.taskId);
      if(!row) throw new Error("Unknown source task.");
      const sourceValue=row[fieldMap[item.field]];
      const expected=item.before == null || item.before === "" ? null : item.before;
      const actual=sourceValue==null ? null : String(sourceValue);
      if(String(expected ?? "") !== String(actual ?? "")){
        throw new Error(`Stale proposal: ${item.taskId} ${item.field} changed in production.`);
      }
    }
    // Proposals do not modify canonical program tasks or the Rev 9 financial plan.
    const results=await sql`
      insert into vyndi_schedule_revisions
        (id,program_id,parent_revision_id,state,scenario,rationale,source_reference,proposed_by,document_json)
      values (${data.id},${PROGRAM_ID},null,'draft',${data.scenario},${data.reason},
        ${data.sourceReference},${actor.userId},
        ${JSON.stringify({baseRevision:data.baseRevision,changes:data.changes})}::jsonb)
      on conflict(id) do nothing
      returning id,state,proposed_by`;
    if(results.length!==1) throw new Error("Revision identifier already exists.");
    return {ok:true,id:data.id,state:"draft"};
  });

export const submitScheduleRevision = createServerFn({method:"POST"})
  .validator(revisionId)
  .handler(async({data})=>{
    const actor=await requireBusinessActor("edit");
    const sql=await getSql();
    const result=await sql`update vyndi_schedule_revisions set state='submitted'
      where id=${data.id} and program_id=${PROGRAM_ID}
      and state='draft' and proposed_by=${actor.userId}
      returning id,state`;
    if(result.length!==1) throw new Error("Only the author may submit an existing draft.");
    return {ok:true,id:data.id,state:"submitted"};
  });

export const rejectScheduleRevision = createServerFn({method:"POST"})
  .validator(revisionId.extend({reviewReference:z.string().trim().min(3).max(500)}))
  .handler(async({data})=>{
    const actor=await requireBusinessActor("approve");
    const sql=await getSql();
    const result=await sql`update vyndi_schedule_revisions
      set state='rejected',reviewed_by=${actor.userId},reviewed_at=now(),
        approval_reference=${data.reviewReference}
      where id=${data.id} and program_id=${PROGRAM_ID}
        and state='submitted' and proposed_by<>${actor.userId}
      returning id,state`;
    if(result.length!==1) throw new Error("Independent reviewer and submitted state required.");
    return {ok:true,id:data.id,state:"rejected"};
  });


/**
 * Approval is intentionally restricted to a date-complete snapshot of the canonical
 * task set. The digest is generated on the server, never supplied by the browser.
 * An approval creates an immutable named schedule baseline; it does not mutate
 * tasks or change the financial Master Plan.
 */
export const approveScheduleRevision = createServerFn({method:"POST"})
 .validator(revisionId.extend({approvalReference:z.string().trim().min(5).max(500),timezone:z.literal("Asia/Kolkata")}))
 .handler(async({data})=>{
  const actor=await requireBusinessActor("approve");
  const sql=await getSql();
  const revision=await sql`select id,state,proposed_by,document_json from vyndi_schedule_revisions
    where id=${data.id} and program_id=${PROGRAM_ID} limit 1`;
  if(revision.length!==1 || revision[0].state!=="submitted") throw new Error("Submitted revision required.");
  if(revision[0].proposed_by===actor.userId) throw new Error("Self-approval prohibited.");
  const tasks=await sql`select id,planned_start::text as planned_start,planned_finish::text as planned_finish,
    duration_days,record_revision from vyndi_program_tasks where program_id=${PROGRAM_ID} order by id`;
  if(tasks.length===0 || tasks.some(t=>!t.planned_start || !t.planned_finish))
    throw new Error("Every program task must have approved planned dates before baseline approval.");
  const parsedDocument=z.object({changes:z.array(change).min(1)}).safeParse(revision[0].document_json);
  if(!parsedDocument.success) throw new Error("Revision document contains invalid changes.");
  const changes=parsedDocument.data.changes;
  if(!Array.isArray(changes) || changes.length===0) throw new Error("Revision requires documented changes.");
  // Approval can certify only an already-applied, independently inspected schedule.
  // Proposed values that do not match current canonical records must never be published.
  const taskById=new Map(tasks.map(t=>[String(t.id),t]));
  for(const change of changes){
    const row=taskById.get(String(change.taskId));
    if(!row) throw new Error("Revision references a missing canonical task.");
    const scheduleFields:Record<string,"planned_start"|"planned_finish"|"duration_days">={plannedStart:"planned_start",plannedFinish:"planned_finish",durationDays:"duration_days"};
    const canonicalField=scheduleFields[change.field];
    if(!canonicalField) throw new Error("Change needs a qualified application/reconciliation step before approval.");
    const actual=row[canonicalField];
    if(String(actual ?? "")!==String(change.after ?? "")) throw new Error("Revision changes are not reconciled with canonical schedule.");
  }
  const deps=await sql`select predecessor_id,successor_id,lag_days from vyndi_program_dependencies
    where program_id=${PROGRAM_ID} order by predecessor_id,successor_id`;
  const payload=JSON.stringify({programId:PROGRAM_ID,revisionId:data.id,timezone:data.timezone,tasks:[...tasks],dependencies:[...deps]});
  const bytes=new TextEncoder().encode(payload);
  const digest=await crypto.subtle.digest("SHA-256",bytes);
  const hash="sha256:"+Array.from(new Uint8Array(digest)).map(x=>x.toString(16).padStart(2,"0")).join("");
  const result=await sql`update vyndi_schedule_revisions
    set state='approved',reviewed_by=${actor.userId},reviewed_at=now(),
    approval_reference=${data.approvalReference},approved_at=now(),
    approved_timezone=${data.timezone},baseline_hash=${hash},
    document_json=jsonb_set(document_json,'{approvedSnapshot}',${payload}::jsonb,true)
    where id=${data.id} and state='submitted' and program_id=${PROGRAM_ID}
      and proposed_by<>${actor.userId} and not exists(
      select 1 from vyndi_schedule_revisions where program_id=${PROGRAM_ID} and state='approved')
    returning id,state,baseline_hash`;
  if(result.length!==1) throw new Error("Approval conflict or existing approved baseline.");
  return {ok:true,id:data.id,state:"approved",baselineHash:hash};
 });


export const getApprovedScheduleBaseline = createServerFn({method:"GET"}).handler(async()=>{
  await requireBusinessActor("view");
  const sql=await getSql();
  const rows=await sql`select id,baseline_hash,approved_timezone,reviewed_by,proposed_by,
    approval_reference,document_json from vyndi_schedule_revisions
    where program_id=${PROGRAM_ID} and state='approved' limit 2`;
  if(rows.length!==1) return {status:"not_commissioned" as const};
  const row=rows[0];
  if(!row.reviewed_by || row.reviewed_by===row.proposed_by ||
    typeof row.baseline_hash!=="string" || !/^sha256:[0-9a-f]{64}$/.test(row.baseline_hash))
    return {status:"not_commissioned" as const};
  const snapshot=row.document_json && typeof row.document_json==="object" &&
    !Array.isArray(row.document_json) ? row.document_json.approvedSnapshot : null;
  if(!snapshot || typeof snapshot!=="object" || Array.isArray(snapshot))
    return {status:"not_commissioned" as const};
  const canonical=JSON.stringify(snapshot);
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(canonical));
  const computed="sha256:"+Array.from(new Uint8Array(digest)).map(v=>v.toString(16).padStart(2,"0")).join("");
  if(computed!==row.baseline_hash) return {status:"not_commissioned" as const};
  if(!Array.isArray(snapshot.tasks) || snapshot.tasks.length===0 ||
     snapshot.tasks.some((task: unknown) => {
       if (!task || typeof task !== "object" || Array.isArray(task)) return true;
       const record = task as Record<string, unknown>;
       return typeof record.planned_start !== "string" || !record.planned_start.trim() ||
         typeof record.planned_finish !== "string" || !record.planned_finish.trim();
     }))
    return {status:"not_commissioned" as const};
  return {status:"approved" as const,revisionId:String(row.id),
    baselineHash:computed,timezone:String(row.approved_timezone),snapshot};
});
