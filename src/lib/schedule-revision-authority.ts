import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getSql } from "@/lib/db";
import { requireBusinessActor } from "@/lib/business-actor";
import { validateScheduleRevision } from "@/lib/schedule-revision-policy.mjs";

const PROGRAM_ID = "VYNDI-MASTER-PROGRAM";
const state = z.enum(["draft","submitted","rejected","approved","superseded"]);
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

// Intentionally no approve/publish endpoint here. Only an independently verified,
// date-complete, immutable hash-bound snapshot can become the published baseline.
// VAOS must not infer approval from state or user-supplied hashes.
