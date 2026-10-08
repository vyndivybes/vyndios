import { useEffect, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { listScheduleRevisions, proposeScheduleRevision, submitScheduleRevision, rejectScheduleRevision } from "@/lib/schedule-revision-authority";
import { canPerform, type CommandRole } from "@/lib/page-access";

type Revision = {id:string;state:string;proposed_by?:string;scenario?:string;rationale?:string};
type ChangeField = "title"|"domain"|"workPackage"|"owner"|"plannedStart"|"plannedFinish"|"durationDays"|"predecessors"|"budgetLakh"|"milestoneMonth"|"scenario"|"scope"|"status"|"deferUntil";
export function ScheduleRevisionEditor({role}:{role:CommandRole|null}) {
  const router=useRouter();
  const [form,setForm]=useState({id:"",baseRevision:"REV9-FINANCE-REFERENCE",scenario:"base",reason:"",sourceReference:"",taskId:"",field:"durationDays" as ChangeField,before:"",after:""});
  const [reviewReference,setReviewReference]=useState("");
  const [revisions,setRevisions]=useState<Revision[]>([]);
  async function refresh(){ try { const response=await listScheduleRevisions(); setRevisions(response.revisions as Revision[]); } catch { setMessage("Revision history unavailable; database migration may still be pending."); }}
  useEffect(()=>{void refresh();},[]);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const editable=Boolean(role && canPerform(role,"edit"));
  const approver=Boolean(role && canPerform(role,"approve"));
  const set=(key:keyof typeof form,value:string)=>setForm(current=>({...current,[key]:value}));
  async function create(){
    setBusy(true);setMessage("");
    try {
      await proposeScheduleRevision({data:{
        id:form.id,baseRevision:form.baseRevision,scenario:form.scenario,
        reason:form.reason,sourceReference:form.sourceReference,
        changes:[{taskId:form.taskId,field:form.field,before:form.before,after:form.after}]
      }});
      setMessage("Draft proposal saved. Existing program tasks and approved plans were not changed.");
      await refresh();
      await router.invalidate();
    } catch(e){setMessage(e instanceof Error?e.message:"Proposal failed");}
    finally{setBusy(false);}
  }
  async function transition(id:string,decision:"submit"|"reject"){
    setBusy(true);setMessage("");
    try{
      if(decision==="submit") await submitScheduleRevision({data:{id}});
      else await rejectScheduleRevision({data:{id,reviewReference}});
      setMessage(decision==="submit"?"Submitted for independent review.":"Rejected with reviewer evidence.");
      await router.invalidate();
    }catch(e){setMessage(e instanceof Error?e.message:"Review failed");}
    finally{setBusy(false);}
  }
  return <section className="rounded-xl border border-border p-4 space-y-3">
    <div><h3 className="font-semibold">Controlled schedule changes</h3>
      <p className="text-xs text-muted">Propose and review changes without overwriting approved Rev 9 or publishing to VAOS. Approval and baseline publication remain unavailable pending qualification.</p></div>
    {message?<p role="status" className="text-xs">{message}</p>:null}
    {editable?<div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      {(["id","baseRevision","scenario","reason","sourceReference","taskId","before","after"] as const).map(k=><label key={k} className="text-xs">{k}<input className="control block w-full" value={form[k]} onChange={e=>set(k,e.target.value)}/></label>)}
      <label className="text-xs">Field<select className="control block w-full" value={form.field} onChange={e=>set("field",e.target.value)}>{(["title","owner","plannedStart","plannedFinish","durationDays","predecessors","budgetLakh","milestoneMonth","scope","scenario","status","deferUntil"] as const).map(f=><option key={f}>{f}</option>)}</select></label>
      <div className="flex items-end"><button type="button" disabled={busy || !form.id || !form.taskId || !form.reason || !form.sourceReference} onClick={()=>void create()} className="rounded border border-accent px-3 py-2 disabled:opacity-40">Save proposal</button></div>
    </div>:null}
    <div className="space-y-2">{revisions.map(rev=><div key={rev.id} className="flex flex-wrap items-center gap-3 rounded border border-border p-2 text-xs">
      <strong>{rev.id}</strong><span>{rev.state}</span><span>{rev.scenario}</span>
      {rev.state==="draft" && editable?<button type="button" disabled={busy} onClick={()=>void transition(rev.id,"submit")} className="underline">Submit</button>:null}
      {rev.state==="submitted" && approver?<><input aria-label="Independent review evidence" className="control" placeholder="Review evidence reference" value={reviewReference} onChange={e=>setReviewReference(e.target.value)}/><button type="button" disabled={busy||!reviewReference} onClick={()=>void transition(rev.id,"reject")} className="underline">Reject</button></>:null}
    </div>)}</div>
  </section>;
}
