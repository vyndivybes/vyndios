import { useMemo, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { Kpi, Panel } from "@/components/kpi";
import {
  addEngineeringEffectivityRule,
  createEngineeringChangeOrder,
  releaseEngineeringChangeOrder,
  transitionEngineeringChangeOrder,
  type EngineeringChangeControlState,
} from "@/lib/engineering-change-control-authority";

export function EngineeringChangeControlPanel({state}:{state:EngineeringChangeControlState}){
  const router=useRouter();
  const [busy,setBusy]=useState("");
  const [message,setMessage]=useState("");
  const [ecoForm,setEcoForm]=useState({
    ecrId:"",targetBaselineId:"",changeClass:"mixed" as "form_fit_function"|"material"|"bom"|"process"|"tooling"|"documentation"|"mixed",
    targetBomVenture:"" as ""|"carbon"|"aluminium",targetBomModelId:"",targetBomRevision:"",
    implementationPlan:"",verificationPlan:"",sourceReference:"UI:ENGINEERING:ECO",
  });
  const [effectForm,setEffectForm]=useState<Record<string,{type:"variant"|"date"|"serial"|"sales_order"|"job_card";valueFrom:string;valueTo:string;effectiveFrom:string;effectiveTo:string;sourceReference:string}>>({});

  const selectedEcr=useMemo(()=>state.approvedEcrs.find((row)=>row.id===ecoForm.ecrId)??null,[state.approvedEcrs,ecoForm.ecrId]);
  const baselineOptions=useMemo(()=>state.releasedBaselines.filter((row)=>!selectedEcr||(row.familyCode===selectedEcr.familyCode&&row.variantId===selectedEcr.variantId&&row.revisionCode===selectedEcr.targetRevisionCode)),[state.releasedBaselines,selectedEcr]);

  async function act(key:string,action:()=>Promise<unknown>,success:string){
    setBusy(key);setMessage("");
    try{await action();setMessage(success);await router.invalidate();}catch(error){setMessage(error instanceof Error?error.message:"PLM change action failed.");}finally{setBusy("");}
  }

  function effectValue(ecoId:string){
    return effectForm[ecoId]??{type:"variant" as const,valueFrom:"",valueTo:"",effectiveFrom:"",effectiveTo:"",sourceReference:"UI:ENGINEERING:EFFECTIVITY"};
  }

  return <div className="space-y-4">
    <Panel title="PLM Change & Effectivity" kicker="ECR → ECO → ECN · governed implementation authority">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Kpi label="ECOs" value={String(state.summary.ecoCount)} hint="Controlled implementation orders"/>
        <Kpi label="Open ECO" value={String(state.summary.openEcoCount)} hint="Draft / approval work" tone={state.summary.openEcoCount?"warn":"ok"}/>
        <Kpi label="Released ECN" value={String(state.summary.releasedEcnCount)} hint="Immutable notices"/>
        <Kpi label="Effectivity rules" value={String(state.summary.effectivityRuleCount)} hint="Explicit applicability"/>
        <Kpi label="Impacted Job Cards" value={String(state.summary.impactedJobCardCount)} hint="Where-used evidence"/>
      </div>
      <p className="mt-3 text-[10px] leading-4 text-subtle">This extends the existing Engineering baseline/ECR authority. ECO/ECN never releases a baseline or BOM by itself: those authorities must already be released before ECN issue.</p>
      {message?<div role="status" className="mt-3 rounded border border-border bg-surface px-3 py-2 text-xs text-muted">{message}</div>:null}
    </Panel>

    <Panel title="Create Engineering Change Order" kicker="Approved ECR → controlled implementation plan">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <label className="text-xs text-muted">Approved ECR<select className="control mt-1.5 w-full" value={ecoForm.ecrId} onChange={(e)=>{const ecr=state.approvedEcrs.find((row)=>row.id===e.target.value);setEcoForm({...ecoForm,ecrId:e.target.value,targetBaselineId:"",targetBomRevision:ecr?.targetBomRevision??""});}}><option value="">Select ECR</option>{state.approvedEcrs.map((row)=><option key={row.id} value={row.id}>{row.id} · {row.title}</option>)}</select></label>
        <label className="text-xs text-muted">Target released baseline<select className="control mt-1.5 w-full" value={ecoForm.targetBaselineId} onChange={(e)=>setEcoForm({...ecoForm,targetBaselineId:e.target.value})}><option value="">Select baseline</option>{baselineOptions.map((row)=><option key={row.id} value={row.id}>{row.id} · {row.revisionCode}</option>)}</select></label>
        <label className="text-xs text-muted">Change class<select className="control mt-1.5 w-full" value={ecoForm.changeClass} onChange={(e)=>setEcoForm({...ecoForm,changeClass:e.target.value as typeof ecoForm.changeClass})}><option value="mixed">Mixed</option><option value="form_fit_function">Form / fit / function</option><option value="material">Material</option><option value="bom">BOM</option><option value="process">Process</option><option value="tooling">Tooling</option><option value="documentation">Documentation</option></select></label>
        <label className="text-xs text-muted">Source reference<input className="control mt-1.5 w-full" value={ecoForm.sourceReference} onChange={(e)=>setEcoForm({...ecoForm,sourceReference:e.target.value})}/></label>
        <label className="text-xs text-muted md:col-span-2">Released target BOM
          <select className="control mt-1.5 w-full" value={ecoForm.targetBomRevision ? [ecoForm.targetBomVenture,ecoForm.targetBomModelId,ecoForm.targetBomRevision].join("|") : ""} onChange={(e)=>{
            const selected=state.releasedBomScopes.find((row)=>[row.venture,row.modelId,row.bomRevision].join("|")===e.target.value);
            setEcoForm({...ecoForm,targetBomVenture:(selected?.venture??"") as typeof ecoForm.targetBomVenture,targetBomModelId:selected?.modelId??"",targetBomRevision:selected?.bomRevision??""});
          }}>
            <option value="">No BOM change</option>
            {state.releasedBomScopes.map((row)=><option key={[row.venture,row.modelId,row.bomRevision].join("|")} value={[row.venture,row.modelId,row.bomRevision].join("|")}>{row.venture} · {row.modelId} · {row.bomRevision}</option>)}
          </select>
        </label>
        <div className="rounded border border-border/70 p-3 text-[10px] text-muted md:col-span-2">
          {ecoForm.targetBomRevision ? <>Selected governed BOM: <strong className="text-fg">{ecoForm.targetBomVenture} / {ecoForm.targetBomModelId} / {ecoForm.targetBomRevision}</strong></> : "No BOM revision is included in this ECO."}
        </div>
        <label className="text-xs text-muted md:col-span-2">Implementation plan<textarea className="control mt-1.5 min-h-24 w-full" value={ecoForm.implementationPlan} onChange={(e)=>setEcoForm({...ecoForm,implementationPlan:e.target.value})}/></label>
        <label className="text-xs text-muted md:col-span-2">Verification plan<textarea className="control mt-1.5 min-h-24 w-full" value={ecoForm.verificationPlan} onChange={(e)=>setEcoForm({...ecoForm,verificationPlan:e.target.value})}/></label>
      </div>
      <button type="button" disabled={busy==="create"||!ecoForm.ecrId||!ecoForm.targetBaselineId||ecoForm.implementationPlan.trim().length<3||ecoForm.verificationPlan.trim().length<3||!ecoForm.sourceReference.trim()} onClick={()=>void act("create",()=>createEngineeringChangeOrder({data:{
        ecrId:ecoForm.ecrId,targetBaselineId:ecoForm.targetBaselineId,changeClass:ecoForm.changeClass,
        targetBomVenture:ecoForm.targetBomVenture||null,targetBomModelId:ecoForm.targetBomModelId.trim()||null,targetBomRevision:ecoForm.targetBomRevision.trim()||null,
        implementationPlan:ecoForm.implementationPlan.trim(),verificationPlan:ecoForm.verificationPlan.trim(),sourceReference:ecoForm.sourceReference.trim(),
      }}),"Engineering Change Order created.")} className="mt-4 rounded bg-accent px-4 py-2.5 text-xs font-semibold text-bg disabled:opacity-40">Create ECO</button>
    </Panel>

    <Panel title="ECO / ECN Register" kicker="Effectivity · Baseline comparison · Where-used impact">
      <div className="space-y-4">
        {state.changeOrders.length?state.changeOrders.map((eco)=>{
          const form=effectValue(eco.id);
          return <article key={eco.id} className="rounded-xl border border-border bg-bg/35 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><p className="font-mono text-xs font-semibold text-accent">{eco.id}</p><p className="mt-1 text-sm font-semibold text-fg">{eco.ecrId} · {eco.ecrTitle}</p><p className="mt-1 text-[10px] text-muted">{eco.familyCode}{eco.variantId?" · "+eco.variantId:""} · target {eco.targetRevisionCode}</p></div>
              <div className="text-right"><p className="text-[10px] font-bold uppercase tracking-wider text-green">{eco.status}</p>{eco.notice?<p className="mt-1 font-mono text-[10px] text-accent">{eco.notice.noticeNumber}</p>:null}</div>
            </div>

            <div className="mt-4 grid gap-3 lg:grid-cols-3">
              <section className="rounded-lg border border-border/80 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-subtle">Effectivity</p>
                {eco.effectivity.length?<div className="mt-2 space-y-2">{eco.effectivity.map((rule)=><div key={rule.id} className="rounded bg-surface/55 p-2 text-[11px]"><strong>{rule.type}</strong> · {rule.type==="date"?(rule.effectiveFrom+" → "+(rule.effectiveTo??"open")):(String(rule.valueFrom??"")+" → "+String(rule.valueTo??"exact"))}</div>)}</div>:<p className="mt-2 text-xs text-warn">No governed effectivity yet.</p>}
                {eco.status==="draft"?<div className="mt-3 space-y-2">
                  <select className="control w-full" value={form.type} onChange={(e)=>setEffectForm({...effectForm,[eco.id]:{...form,type:e.target.value as typeof form.type}})}><option value="variant">Variant</option><option value="date">Date</option><option value="serial">Serial range</option><option value="sales_order">Sales Order</option><option value="job_card">Job Card</option></select>
                  {form.type==="date"?<div className="grid grid-cols-2 gap-2"><input type="date" className="control" value={form.effectiveFrom} onChange={(e)=>setEffectForm({...effectForm,[eco.id]:{...form,effectiveFrom:e.target.value}})}/><input type="date" className="control" value={form.effectiveTo} onChange={(e)=>setEffectForm({...effectForm,[eco.id]:{...form,effectiveTo:e.target.value}})}/></div>:<div className="grid grid-cols-2 gap-2"><input className="control" value={form.valueFrom} onChange={(e)=>setEffectForm({...effectForm,[eco.id]:{...form,valueFrom:e.target.value}})} placeholder={form.type==="serial"?"From serial":"Exact value"}/>{form.type==="serial"?<input className="control" value={form.valueTo} onChange={(e)=>setEffectForm({...effectForm,[eco.id]:{...form,valueTo:e.target.value}})} placeholder="To serial (optional)"/>:<div/>}</div>}
                  <input className="control w-full" value={form.sourceReference} onChange={(e)=>setEffectForm({...effectForm,[eco.id]:{...form,sourceReference:e.target.value}})} placeholder="Effectivity evidence reference"/>
                  <button type="button" disabled={busy==="effect-"+eco.id} onClick={()=>void act("effect-"+eco.id,()=>addEngineeringEffectivityRule({data:{ecoId:eco.id,type:form.type,valueFrom:form.type==="date"?null:form.valueFrom||null,valueTo:form.type==="serial"?form.valueTo||null:null,effectiveFrom:form.type==="date"?form.effectiveFrom||null:null,effectiveTo:form.type==="date"?form.effectiveTo||null:null,sourceReference:form.sourceReference}}),"Effectivity rule added.")} className="rounded border border-accent px-3 py-2 text-[11px] font-semibold text-accent">Add effectivity</button>
                </div>:null}
              </section>

              <section className="rounded-lg border border-border/80 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-subtle">Baseline comparison</p>
                {eco.comparison?<div className="mt-2 space-y-2 text-[11px]">
                  <p>Changed fields <strong>{eco.comparison.changedFields.length}</strong> · BOM added <strong>{eco.comparison.addedBomLines.length}</strong> · removed <strong>{eco.comparison.removedBomLines.length}</strong> · changed <strong>{eco.comparison.changedBomLines.length}</strong></p>
                  {eco.comparison.changedFields.map((row)=><div key={row.field} className="rounded bg-surface/55 p-2"><strong>{row.field}</strong><p className="mt-1 break-all text-muted">{String(row.from??"—")} → {String(row.to??"—")}</p></div>)}
                  <p className="text-[10px] text-subtle">Material {eco.comparison.materialChange?"changed":"same"} · Geometry {eco.comparison.geometryChange?"changed":"same"} · Tooling {eco.comparison.toolingChange?"changed":"same"} · BOM {eco.comparison.bomChange?"changed":"same"}</p>
                </div>:<p className="mt-2 text-xs text-muted">Comparison unavailable until both source and target baselines are represented.</p>}
              </section>

              <section className="rounded-lg border border-border/80 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-subtle">Where-used</p>
                <div className="mt-2 grid grid-cols-3 gap-2 text-center"><div className="rounded bg-surface/55 p-2"><strong>{eco.whereUsed.mappings.length}</strong><p className="text-[9px] text-muted">BOM refs</p></div><div className="rounded bg-surface/55 p-2"><strong>{eco.whereUsed.jobCards.length}</strong><p className="text-[9px] text-muted">Job Cards</p></div><div className="rounded bg-surface/55 p-2"><strong>{eco.whereUsed.purchaseOrders.length}</strong><p className="text-[9px] text-muted">PO refs</p></div></div>
                {eco.whereUsed.jobCards.length?<div className="mt-3 max-h-36 space-y-1 overflow-auto text-[10px]">{eco.whereUsed.jobCards.map((row)=><p key={row.job_card_id+"|"+row.mapping_id} className="break-all text-muted">{row.job_card_id} · {row.job_card_status} · {row.sku} · BOM {row.bom_revision??"—"}</p>)}</div>:<p className="mt-3 text-[10px] text-muted">No frozen Job Card currently consumes the ECR affected SKUs.</p>}
              </section>
            </div>

            <div className="mt-4 rounded-lg border border-border/80 p-3 text-xs"><p className="font-semibold text-fg">Implementation</p><p className="mt-1 text-muted">{eco.implementationPlan}</p><p className="mt-3 font-semibold text-fg">Verification</p><p className="mt-1 text-muted">{eco.verificationPlan}</p>{eco.targetBomRevision?<p className="mt-3 text-[10px] text-subtle">Target BOM {eco.targetBomVenture} / {eco.targetBomModelId} / {eco.targetBomRevision}</p>:null}</div>

            <div className="mt-4 flex flex-wrap gap-2">
              {eco.status==="draft"?<button type="button" disabled={busy==="submit-"+eco.id} onClick={()=>void act("submit-"+eco.id,()=>transitionEngineeringChangeOrder({data:{ecoId:eco.id,toStatus:"pending_approval",sourceReference:"UI:ENGINEERING:ECO-SUBMIT",note:"Submitted after effectivity definition."}}),"ECO submitted for approval.")} className="rounded border border-border px-3 py-2 text-[11px] font-semibold">Submit ECO</button>:null}
              {eco.status==="pending_approval"?<><button type="button" disabled={busy==="approve-"+eco.id} onClick={()=>void act("approve-"+eco.id,()=>transitionEngineeringChangeOrder({data:{ecoId:eco.id,toStatus:"approved",sourceReference:"UI:ENGINEERING:ECO-APPROVE",note:"Engineering change implementation approved."}}),"ECO approved.")} className="rounded border border-green px-3 py-2 text-[11px] font-semibold text-green">Approve ECO</button><button type="button" disabled={busy==="reject-"+eco.id} onClick={()=>void act("reject-"+eco.id,()=>transitionEngineeringChangeOrder({data:{ecoId:eco.id,toStatus:"rejected",sourceReference:"UI:ENGINEERING:ECO-REJECT",note:"Engineering change rejected."}}),"ECO rejected.")} className="rounded border border-warn px-3 py-2 text-[11px] font-semibold text-warn">Reject</button></>:null}
              {eco.status==="approved"?<button type="button" disabled={busy==="release-"+eco.id} onClick={()=>void act("release-"+eco.id,()=>releaseEngineeringChangeOrder({data:{ecoId:eco.id,sourceReference:"UI:ENGINEERING:ECN-RELEASE"}}),"ECN released and ECR implemented.")} className="rounded bg-accent px-3 py-2 text-[11px] font-semibold text-bg">Release ECN</button>:null}
            </div>
          </article>;
        }):<p className="text-sm text-muted">No Engineering Change Order has been created yet.</p>}
      </div>
    </Panel>
  </div>;
}
