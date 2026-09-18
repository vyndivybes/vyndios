import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  approveVindyRecoveryRequest,
  executeVindySelectiveRecovery,
  getVindyRecoveryCentre,
  previewVindySelectiveRecovery,
  recordVindyFullRestoreCutover,
  registerVindyRecoveryCheckpoint,
  rejectVindyRecoveryRequest,
  requestVindyFullRestore,
  requestVindySelectiveRecovery,
  validateVindyFullRestore,
  type RecoveryCentreWorkspace,
  type RecoveryRequestRow,
} from "@/lib/recovery-control";

export const Route = createFileRoute("/command/recovery")({ component: RecoveryCentre });

const card="rounded-2xl border border-slate-300 bg-white p-5 shadow-sm";
const field="mt-1.5 w-full rounded-xl border border-slate-400 bg-white px-3 py-2.5 text-sm";

function id(prefix:string){return `${prefix}-${Date.now().toString(36).toUpperCase()}`;}
function text(value:unknown){return value==null?"":String(value);}
function when(value:string|null|undefined){return value?new Date(value).toLocaleString():"—";}

function RecoveryCentre() {
  const [data,setData]=useState<RecoveryCentreWorkspace|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [message,setMessage]=useState("");
  const [preview,setPreview]=useState("");
  const [checkpoint,setCheckpoint]=useState({
    id:id("BKP"),
    checkpointType:"pg_dump" as "neon_history"|"neon_branch"|"pg_dump"|"managed_snapshot",
    capturedAt:new Date().toISOString().slice(0,16),
    sourceSha:"",
    sourceReference:"",
    storageReference:"",
    checksum:"",
    sizeBytes:"",
    notes:"",
  });
  const [selective,setSelective]=useState({
    id:id("REC"),
    entityType:"sales_order" as "sales_order"|"monthly_actual",
    entityId:"",
    sourceKind:"revision_history" as "revision_history"|"external_backup",
    sourceRevision:"1",
    checkpointId:"",
    recoveryJson:"{}",
    reason:"",
    evidenceReference:"",
  });
  const [full,setFull]=useState({
    id:id("DR"),
    checkpointId:"",
    reason:"",
    evidenceReference:"",
  });

  async function refresh(){
    try{
      setError("");
      setData(await getVindyRecoveryCentre());
    }catch(err){
      setError(err instanceof Error?err.message:"Unable to load Recovery Centre.");
    }
  }
  useEffect(()=>{void refresh();},[]);

  async function run(task:()=>Promise<unknown>,success:string){
    try{
      setBusy(true);setError("");setMessage("");
      await task();
      setMessage(success);
      await refresh();
    }catch(err){
      setError(err instanceof Error?err.message:"Recovery action could not be completed.");
    }finally{setBusy(false);}
  }

  async function previewSelective(){
    try{
      setBusy(true);setError("");setPreview("");
      const result=await previewVindySelectiveRecovery({data:{
        entityType:selective.entityType,
        entityId:selective.entityId,
        sourceKind:selective.sourceKind,
        sourceRevision:selective.sourceKind==="revision_history"?Number(selective.sourceRevision):null,
        recoverySnapshotJson:selective.sourceKind==="external_backup"?selective.recoveryJson:null,
      }});
      setPreview(JSON.stringify(result,null,2));
    }catch(err){
      setError(err instanceof Error?err.message:"Unable to preview selective recovery.");
    }finally{setBusy(false);}
  }

  async function submitSelective(){
    await run(
      ()=>requestVindySelectiveRecovery({data:{
        id:selective.id,
        entityType:selective.entityType,
        entityId:selective.entityId,
        sourceKind:selective.sourceKind,
        sourceRevision:selective.sourceKind==="revision_history"?Number(selective.sourceRevision):null,
        recoverySnapshotJson:selective.sourceKind==="external_backup"?selective.recoveryJson:null,
        checkpointId:selective.sourceKind==="external_backup"?selective.checkpointId||null:null,
        reason:selective.reason,
        evidenceReference:selective.evidenceReference,
      }}),
      "Selective recovery request created. A different Admin must approve it before execution.",
    );
    setSelective(current=>({...current,id:id("REC"),reason:"",evidenceReference:""}));
    setPreview("");
  }

  async function registerCheckpoint(){
    const capturedAt=new Date(checkpoint.capturedAt).toISOString();
    await run(
      ()=>registerVindyRecoveryCheckpoint({data:{
        id:checkpoint.id,
        checkpointType:checkpoint.checkpointType,
        capturedAt,
        sourceSha:checkpoint.sourceSha,
        sourceReference:checkpoint.sourceReference,
        storageReference:checkpoint.storageReference,
        checksum:checkpoint.checksum,
        sizeBytes:checkpoint.sizeBytes?Number(checkpoint.sizeBytes):null,
        notes:checkpoint.notes,
      }}),
      "Recovery checkpoint registered as evidence. No credentials or backup bytes were stored in VYNDI.",
    );
    setCheckpoint(current=>({...current,id:id("BKP"),sourceReference:"",storageReference:"",checksum:"",sizeBytes:"",notes:""}));
  }

  async function submitFull(){
    await run(
      ()=>requestVindyFullRestore({data:full}),
      "Full-restore request created. Restore must occur into a new branch/database and needs independent approval and validation before cutover.",
    );
    setFull(current=>({...current,id:id("DR"),reason:"",evidenceReference:""}));
  }

  async function approve(row:RecoveryRequestRow){
    const note=window.prompt("Checker approval note (optional)")?.trim()??"";
    await run(()=>approveVindyRecoveryRequest({data:{requestId:row.id,note}}),"Recovery request approved by independent checker.");
  }
  async function reject(row:RecoveryRequestRow){
    const note=window.prompt("Rejection reason")?.trim();if(!note)return;
    await run(()=>rejectVindyRecoveryRequest({data:{requestId:row.id,note}}),"Recovery request rejected and retained in history.");
  }
  async function executeSelective(row:RecoveryRequestRow){
    const executionReference=window.prompt("Execution evidence / ticket reference")?.trim();if(!executionReference)return;
    if(!window.confirm("Execute governed selective recovery now? This creates a NEW canonical revision; it does not overwrite history."))return;
    await run(
      ()=>executeVindySelectiveRecovery({data:{requestId:row.id,executionReference}}),
      "Selective recovery executed through the canonical writer. A new revision and recovery audit event were created.",
    );
  }
  async function validateFull(row:RecoveryRequestRow){
    const restoredSourceSha=window.prompt("Exact source SHA running against the restored database")?.trim();if(!restoredSourceSha)return;
    const restoredTargetReference=window.prompt("Restored branch/database reference (no credential)")?.trim();if(!restoredTargetReference)return;
    const evidenceReference=window.prompt("Validation evidence / incident reference")?.trim();if(!evidenceReference)return;
    const hashMatch=window.confirm("Confirm critical source/restored hashes match?");
    const databaseHealth=window.confirm("Confirm restored runtime database health is GREEN?");
    const goldenOrder=window.confirm("Confirm Golden Order test PASSED on the restored environment?");
    const authenticatedSmoke=window.confirm("Confirm authenticated protected-route smoke PASSED on the restored environment?");
    await run(
      ()=>validateVindyFullRestore({data:{
        requestId:row.id,evidenceReference,hashMatch,databaseHealth,goldenOrder,authenticatedSmoke,
        restoredSourceSha,restoredTargetReference,
      }}),
      "Full restore validated and marked CUTOVER READY. Production connectivity has not been changed by this action.",
    );
  }
  async function cutover(row:RecoveryRequestRow){
    const cutoverReference=window.prompt("Authorized infrastructure cutover evidence / change reference")?.trim();if(!cutoverReference)return;
    if(!window.confirm("Record that the independently validated restored database has been cut over by the infrastructure operator?"))return;
    await run(
      ()=>recordVindyFullRestoreCutover({data:{requestId:row.id,cutoverReference}}),
      "Validated full-restore cutover recorded in the immutable recovery evidence stream.",
    );
  }

  const pending=data?.requests.filter(row=>row.status==="pending")??[];
  const latest=data?.checkpoints[0];
  const checkpointOptions=useMemo(()=>data?.checkpoints??[],[data]);

  return (
    <main className="space-y-6 p-8 text-slate-950">
      <header>
        <p className="text-xs font-bold uppercase tracking-[0.25em] text-orange-600">VYNDI OS · Administration · Recovery</p>
        <h1 className="mt-2 text-3xl font-semibold">Backup & Recovery Centre</h1>
        <p className="mt-2 max-w-5xl text-sm font-medium leading-6 text-slate-700">
          Governed backup evidence, disaster-restore control and selective recovery. Production rows are never blindly overwritten:
          supported selective recovery replays the approved snapshot through the owning canonical writer and creates a new revision.
        </p>
      </header>

      {message&&<p role="status" className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-sm font-semibold text-emerald-900">{message}</p>}
      {error&&<p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm font-semibold text-red-800">{error}</p>}

      <section className="grid gap-4 md:grid-cols-5">
        <div className={card}><p className="text-xs font-bold uppercase text-slate-500">Recovery RPO</p><p className="mt-2 text-2xl font-semibold">≤ {data?.policy.rpoHours??24}h</p></div>
        <div className={card}><p className="text-xs font-bold uppercase text-slate-500">Recovery RTO</p><p className="mt-2 text-2xl font-semibold">≤ {data?.policy.rtoMinutes??60}m</p></div>
        <div className={card}><p className="text-xs font-bold uppercase text-slate-500">Checkpoints</p><p className="mt-2 text-2xl font-semibold">{data?.summary.checkpoint_count??0}</p></div>
        <div className={card}><p className="text-xs font-bold uppercase text-slate-500">Pending approvals</p><p className="mt-2 text-2xl font-semibold">{data?.summary.pending_requests??0}</p></div>
        <div className={card}><p className="text-xs font-bold uppercase text-slate-500">Latest checkpoint</p><p className="mt-2 text-sm font-semibold">{latest?when(latest.captured_at):"None registered"}</p></div>
      </section>

      <section className="rounded-2xl border border-amber-300 bg-amber-50 p-5">
        <h2 className="font-semibold text-amber-950">Recovery safety boundary</h2>
        <p className="mt-2 text-sm leading-6 text-amber-900">
          Full database restore is performed outside the application into a new database/branch. This Admin page governs the request,
          checker approval, validation evidence and cutover record; it never rewrites the live database in place. Selective execution is
          currently enabled only for Sales Orders and Monthly Actuals because those domains have revisioned canonical writers.
        </p>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <div className={card}>
          <p className="text-xs font-bold uppercase tracking-wide text-orange-600">Backup evidence</p>
          <h2 className="mt-1 text-xl font-semibold">Register recovery checkpoint</h2>
          <p className="mt-1 text-xs leading-5 text-slate-600">Register the evidence/reference after a Neon branch/history point, pg_dump or managed snapshot is created. Never paste passwords or connection strings here.</p>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <label className="text-sm font-semibold">Checkpoint ID<input className={field} value={checkpoint.id} onChange={e=>setCheckpoint({...checkpoint,id:e.target.value})}/></label>
            <label className="text-sm font-semibold">Type<select className={field} value={checkpoint.checkpointType} onChange={e=>setCheckpoint({...checkpoint,checkpointType:e.target.value as typeof checkpoint.checkpointType})}><option value="pg_dump">PostgreSQL pg_dump</option><option value="neon_branch">Neon recovery branch</option><option value="neon_history">Neon history / PITR point</option><option value="managed_snapshot">Managed snapshot</option></select></label>
            <label className="text-sm font-semibold">Captured at<input type="datetime-local" className={field} value={checkpoint.capturedAt} onChange={e=>setCheckpoint({...checkpoint,capturedAt:e.target.value})}/></label>
            <label className="text-sm font-semibold">Source SHA<input className={field} value={checkpoint.sourceSha} onChange={e=>setCheckpoint({...checkpoint,sourceSha:e.target.value})} placeholder="optional exact release SHA"/></label>
            <label className="text-sm font-semibold md:col-span-2">Evidence reference<input className={field} value={checkpoint.sourceReference} onChange={e=>setCheckpoint({...checkpoint,sourceReference:e.target.value})} placeholder="backup log / recovery branch / ticket"/></label>
            <label className="text-sm font-semibold">Storage reference<input className={field} value={checkpoint.storageReference} onChange={e=>setCheckpoint({...checkpoint,storageReference:e.target.value})} placeholder="file/path/reference only"/></label>
            <label className="text-sm font-semibold">Checksum<input className={field} value={checkpoint.checksum} onChange={e=>setCheckpoint({...checkpoint,checksum:e.target.value})} placeholder="SHA-256 if available"/></label>
            <label className="text-sm font-semibold">Size bytes<input type="number" min="0" className={field} value={checkpoint.sizeBytes} onChange={e=>setCheckpoint({...checkpoint,sizeBytes:e.target.value})}/></label>
            <label className="text-sm font-semibold">Notes<input className={field} value={checkpoint.notes} onChange={e=>setCheckpoint({...checkpoint,notes:e.target.value})}/></label>
          </div>
          <button type="button" disabled={busy||!checkpoint.sourceReference.trim()} onClick={()=>void registerCheckpoint()} className="mt-4 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40">Register checkpoint</button>
        </div>

        <div className={card}>
          <p className="text-xs font-bold uppercase tracking-wide text-orange-600">Disaster recovery</p>
          <h2 className="mt-1 text-xl font-semibold">Request full restore</h2>
          <p className="mt-1 text-xs leading-5 text-slate-600">Creates the maker/checker recovery authority. Actual restore must target a new branch/database and then pass H2 validation before cutover can be recorded.</p>
          <div className="mt-4 grid gap-3">
            <label className="text-sm font-semibold">Request ID<input className={field} value={full.id} onChange={e=>setFull({...full,id:e.target.value})}/></label>
            <label className="text-sm font-semibold">Checkpoint<select className={field} value={full.checkpointId} onChange={e=>setFull({...full,checkpointId:e.target.value})}><option value="">Select checkpoint</option>{checkpointOptions.map(row=><option key={row.id} value={row.id}>{row.id} · {row.checkpoint_type} · {when(row.captured_at)}</option>)}</select></label>
            <label className="text-sm font-semibold">Reason<textarea className={field} rows={3} value={full.reason} onChange={e=>setFull({...full,reason:e.target.value})}/></label>
            <label className="text-sm font-semibold">Incident / evidence reference<input className={field} value={full.evidenceReference} onChange={e=>setFull({...full,evidenceReference:e.target.value})}/></label>
          </div>
          <button type="button" disabled={busy||!full.checkpointId||full.reason.trim().length<8||!full.evidenceReference.trim()} onClick={()=>void submitFull()} className="mt-4 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40">Request full restore</button>
        </div>
      </section>

      <section className={card}>
        <p className="text-xs font-bold uppercase tracking-wide text-orange-600">Selective recovery</p>
        <h2 className="mt-1 text-xl font-semibold">Restore a controlled historical state</h2>
        <p className="mt-1 text-xs leading-5 text-slate-600">Revision-history recovery requires no external dump. External-backup recovery requires a registered checkpoint plus the recovered entity snapshot exported from the isolated restored database.</p>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <label className="text-sm font-semibold">Request ID<input className={field} value={selective.id} onChange={e=>setSelective({...selective,id:e.target.value})}/></label>
          <label className="text-sm font-semibold">Entity<select className={field} value={selective.entityType} onChange={e=>setSelective({...selective,entityType:e.target.value as typeof selective.entityType})}><option value="sales_order">Sales Order</option><option value="monthly_actual">Monthly Actual</option></select></label>
          <label className="text-sm font-semibold">Entity ID<input className={field} value={selective.entityId} onChange={e=>setSelective({...selective,entityId:e.target.value})} placeholder={selective.entityType==="sales_order"?"SO-...":"M1..M36"}/></label>
          <label className="text-sm font-semibold">Recovery source<select className={field} value={selective.sourceKind} onChange={e=>setSelective({...selective,sourceKind:e.target.value as typeof selective.sourceKind})}><option value="revision_history">VYNDI revision history</option><option value="external_backup">External backup / restored DB</option></select></label>
          {selective.sourceKind==="revision_history"?<label className="text-sm font-semibold">Source revision<input type="number" min="1" className={field} value={selective.sourceRevision} onChange={e=>setSelective({...selective,sourceRevision:e.target.value})}/></label>:<label className="text-sm font-semibold">Checkpoint<select className={field} value={selective.checkpointId} onChange={e=>setSelective({...selective,checkpointId:e.target.value})}><option value="">Select checkpoint</option>{checkpointOptions.map(row=><option key={row.id} value={row.id}>{row.id}</option>)}</select></label>}
          <label className="text-sm font-semibold">Evidence reference<input className={field} value={selective.evidenceReference} onChange={e=>setSelective({...selective,evidenceReference:e.target.value})}/></label>
          <label className="text-sm font-semibold md:col-span-3">Reason<textarea className={field} rows={2} value={selective.reason} onChange={e=>setSelective({...selective,reason:e.target.value})}/></label>
          {selective.sourceKind==="external_backup"&&<label className="text-sm font-semibold md:col-span-3">Recovered snapshot JSON<textarea className={`${field} font-mono text-xs`} rows={8} value={selective.recoveryJson} onChange={e=>setSelective({...selective,recoveryJson:e.target.value})}/></label>}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" disabled={busy||!selective.entityId.trim()} onClick={()=>void previewSelective()} className="rounded-xl border border-slate-400 bg-white px-4 py-2.5 text-sm font-semibold disabled:opacity-40">Preview impact</button>
          <button type="button" disabled={busy||!preview||selective.reason.trim().length<8||!selective.evidenceReference.trim()} onClick={()=>void submitSelective()} className="rounded-xl bg-orange-500 px-4 py-2.5 text-sm font-semibold text-slate-950 disabled:opacity-40">Raise selective recovery</button>
        </div>
        {preview&&<pre className="mt-4 max-h-[420px] overflow-auto rounded-xl bg-slate-950 p-4 text-xs leading-5 text-slate-100">{preview}</pre>}
      </section>

      <section className={card}>
        <p className="text-xs font-bold uppercase tracking-wide text-orange-600">Maker / checker</p>
        <h2 className="mt-1 text-xl font-semibold">Pending recovery approvals</h2>
        <div className="mt-4 grid gap-3">
          {!pending.length&&<p className="text-sm text-slate-600">No recovery request is waiting for approval.</p>}
          {pending.map(row=><article key={row.id} className="rounded-xl border border-slate-200 p-4 text-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div><p className="font-mono text-xs text-orange-700">{row.id}</p><p className="mt-1 font-semibold">{row.mode==="selective"?`${row.entity_type} · ${row.entity_id}`:"Full database restore"}</p><p className="mt-1 text-slate-600">{row.reason}</p><p className="mt-1 text-xs text-slate-500">Maker: {row.requested_by} · source {row.source_kind}{row.source_revision?` R${row.source_revision}`:""}</p></div>
              <div className="flex gap-2"><button disabled={busy||row.requested_by===data?.me.id} onClick={()=>void approve(row)} className="rounded-lg bg-slate-950 px-3 py-2 text-xs font-bold text-white disabled:opacity-40">Approve</button><button disabled={busy} onClick={()=>void reject(row)} className="rounded-lg border border-red-300 px-3 py-2 text-xs font-bold text-red-700 disabled:opacity-40">Reject</button></div>
            </div>
          </article>)}
        </div>
      </section>

      <section className="overflow-x-auto rounded-2xl border border-slate-300 bg-white shadow-sm">
        <div className="min-w-[1180px]">
          <div className="grid grid-cols-[1.1fr_.8fr_.8fr_1.2fr_1fr_1.2fr_1.2fr] gap-4 border-b bg-slate-100 px-5 py-3 text-xs font-bold uppercase text-slate-600"><span>Request</span><span>Mode</span><span>Status</span><span>Target / checkpoint</span><span>Maker</span><span>When</span><span>Controlled action</span></div>
          {(data?.requests??[]).map(row=><div key={row.id} className="grid grid-cols-[1.1fr_.8fr_.8fr_1.2fr_1fr_1.2fr_1.2fr] items-center gap-4 border-b border-slate-100 px-5 py-4 text-sm">
            <span className="font-mono text-xs">{row.id}</span><span>{row.mode}</span><span className="font-semibold">{row.status}</span>
            <span className="text-xs">{row.mode==="selective"?`${row.entity_type} · ${row.entity_id}`:row.checkpoint_id??"—"}</span>
            <span className="font-mono text-xs">{row.requested_by}</span><span className="text-xs">{when(row.requested_at)}</span>
            <span className="flex flex-wrap gap-2">
              {row.mode==="selective"&&row.status==="approved"&&<button disabled={busy||row.requested_by===data?.me.id} onClick={()=>void executeSelective(row)} className="rounded-lg bg-orange-500 px-3 py-2 text-xs font-bold disabled:opacity-40">Execute selective</button>}
              {row.mode==="full_restore"&&row.status==="approved"&&<button disabled={busy||row.requested_by===data?.me.id} onClick={()=>void validateFull(row)} className="rounded-lg border border-slate-400 px-3 py-2 text-xs font-bold disabled:opacity-40">Record validation</button>}
              {row.mode==="full_restore"&&row.status==="cutover_ready"&&<button disabled={busy||row.requested_by===data?.me.id} onClick={()=>void cutover(row)} className="rounded-lg bg-slate-950 px-3 py-2 text-xs font-bold text-white disabled:opacity-40">Record cutover</button>}
              {row.status==="executed"&&<span className="text-xs font-semibold text-emerald-700">{row.result_revision?`New R${row.result_revision}`:"Executed"}</span>}
            </span>
          </div>)}
          {!(data?.requests.length)&&<div className="px-5 py-10 text-center text-sm text-slate-600">No recovery requests recorded.</div>}
        </div>
      </section>

      <section className={card}>
        <p className="text-xs font-bold uppercase tracking-wide text-orange-600">Immutable evidence</p>
        <h2 className="mt-1 text-xl font-semibold">Recent recovery events</h2>
        <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[900px] text-sm"><thead><tr className="border-b text-left text-xs uppercase text-slate-500"><th className="py-2">When</th><th>Event</th><th>Request</th><th>Checkpoint</th><th>Actor</th><th>Evidence</th></tr></thead><tbody>{(data?.events??[]).map(row=><tr key={row.id} className="border-b border-slate-100"><td className="py-2 pr-3 text-xs">{when(row.created_at)}</td><td className="pr-3 font-semibold">{row.event_type}</td><td className="pr-3 font-mono text-xs">{row.request_id??"—"}</td><td className="pr-3 font-mono text-xs">{row.checkpoint_id??"—"}</td><td className="pr-3 font-mono text-xs">{row.actor_user_id}</td><td className="text-xs text-slate-600">{text(row.evidence_reference)||"—"}</td></tr>)}</tbody></table></div>
      </section>
    </main>
  );
}
