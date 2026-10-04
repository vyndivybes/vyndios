import { useMemo, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { Kpi, Panel } from "@/components/kpi";
import {
  captureEngineeringConfigurationManifest,
  createEngineeringDocument,
  linkEngineeringDocumentRevision,
  registerEngineeringDocumentRevision,
  releaseEngineeringDocumentRevision,
  transitionEngineeringDocumentRevision,
  type EngineeringPdmState,
} from "@/lib/engineering-pdm-authority";

const shortHash=(value:string)=>value.length>16?value.slice(0,12)+"…"+value.slice(-4):value;

export function EngineeringPdmPanel({state}:{state:EngineeringPdmState}){
  const router=useRouter();
  const [busy,setBusy]=useState("");
  const [message,setMessage]=useState("");
  const [docForm,setDocForm]=useState({documentNumber:"",title:"",documentType:"drawing",domain:"frame_geometry",owner:"Engineering",sourceReference:"UI:ENGINEERING:PDM"});
  const [revForm,setRevForm]=useState({documentId:"",revisionCode:"",contentSha256:"",fileName:"",mediaType:"application/octet-stream",fileSizeBytes:1,sourceUri:"",sourceReference:"UI:ENGINEERING:PDM-REV"});
  const [linkForm,setLinkForm]=useState({revisionId:"",targetType:"engineering_baseline" as "engineering_baseline"|"eco"|"ecn"|"bom_revision"|"vedm_authority_node",targetId:"",relation:"CONTROLS" as "CONTROLS"|"EVIDENCES"|"VALIDATES"|"DERIVES_FROM"|"REQUIRES",sourceReference:"UI:ENGINEERING:PDM-LINK"});
  const [manifestForm,setManifestForm]=useState({baselineId:"",bomReleaseId:"",sourceReference:"UI:ENGINEERING:PDM-MANIFEST"});

  const draftRevisions=useMemo(()=>state.revisions.filter((row)=>row.status==="draft"),[state.revisions]);
  const targetOptions=useMemo(()=>{
    if(linkForm.targetType==="engineering_baseline") return state.targets.baselines.map((row)=>({id:row.id,label:row.id+" · "+row.familyCode+" "+row.revisionCode}));
    if(linkForm.targetType==="eco") return state.targets.ecos.map((row)=>({id:row.id,label:row.id+" · "+row.ecrId+" · "+row.status}));
    if(linkForm.targetType==="ecn") return state.targets.ecns.map((row)=>({id:row.id,label:row.noticeNumber+" · "+row.id}));
    if(linkForm.targetType==="bom_revision") return state.targets.bomReleases.map((row)=>({id:row.id,label:row.venture+" · "+row.modelId+" · "+row.bomRevision}));
    return state.targets.vedmNodes.map((row)=>({id:row.id,label:row.id+" · "+row.title}));
  },[linkForm.targetType,state.targets]);

  async function act(key:string,fn:()=>Promise<unknown>,success:string){
    setBusy(key);setMessage("");
    try{await fn();setMessage(success);await router.invalidate();}catch(error){setMessage(error instanceof Error?error.message:"Engineering PDM action failed.");}finally{setBusy("");}
  }

  return <div className="space-y-4">
    <Panel title="Engineering PDM & Document Control" kicker="Document ID · Revision · SHA-256 · Where-used · Release · Supersession">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Kpi label="Documents" value={String(state.summary.documentCount)} hint="Controlled masters"/>
        <Kpi label="Revisions" value={String(state.summary.revisionCount)} hint="All lifecycle states"/>
        <Kpi label="Released" value={String(state.summary.releasedRevisionCount)} hint="Current controlled revisions"/>
        <Kpi label="Superseded" value={String(state.summary.supersededRevisionCount)} hint="Historical controlled revisions"/>
        <Kpi label="Manifests" value={String(state.summary.manifestCount)} hint="Frozen released configurations"/>
      </div>
      <p className="mt-3 text-[10px] leading-4 text-subtle">Binary files remain in their canonical repository/Drive/controlled storage. VYNDI controls identity, revision, SHA-256, release state and where-used relationships; changing a released configuration requires a new baseline/change, not silent file replacement.</p>
      {message?<div role="status" className="mt-3 rounded border border-border bg-surface px-3 py-2 text-xs text-muted">{message}</div>:null}
    </Panel>

    <div className="grid gap-4 xl:grid-cols-2">
      <Panel title="Create controlled document" kicker="One master identity across revisions">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-muted">Document number<input className="control mt-1.5 w-full" value={docForm.documentNumber} onChange={(e)=>setDocForm({...docForm,documentNumber:e.target.value})} placeholder="VEDM-301"/></label>
          <label className="text-xs text-muted">Title<input className="control mt-1.5 w-full" value={docForm.title} onChange={(e)=>setDocForm({...docForm,title:e.target.value})}/></label>
          <label className="text-xs text-muted">Type<select className="control mt-1.5 w-full" value={docForm.documentType} onChange={(e)=>setDocForm({...docForm,documentType:e.target.value})}><option value="cad_step">CAD / STEP</option><option value="drawing">Drawing</option><option value="fea">FEA</option><option value="cfd">CFD</option><option value="material_spec">Material spec</option><option value="laminate">Laminate</option><option value="test_plan">Test plan</option><option value="test_report">Test report</option><option value="ndt">NDT</option><option value="tooling">Tooling</option><option value="manufacturing">Manufacturing</option><option value="specification">Specification</option><option value="other">Other</option></select></label>
          <label className="text-xs text-muted">Domain<input className="control mt-1.5 w-full" value={docForm.domain} onChange={(e)=>setDocForm({...docForm,domain:e.target.value})}/></label>
          <label className="text-xs text-muted">Owner<input className="control mt-1.5 w-full" value={docForm.owner} onChange={(e)=>setDocForm({...docForm,owner:e.target.value})}/></label>
          <label className="text-xs text-muted">Source reference<input className="control mt-1.5 w-full" value={docForm.sourceReference} onChange={(e)=>setDocForm({...docForm,sourceReference:e.target.value})}/></label>
        </div>
        <button type="button" disabled={busy==="doc"||docForm.documentNumber.trim().length<2||docForm.title.trim().length<2} onClick={()=>void act("doc",()=>createEngineeringDocument({data:{...docForm,documentNumber:docForm.documentNumber.trim(),title:docForm.title.trim(),documentType:docForm.documentType as any,domain:docForm.domain.trim(),owner:docForm.owner.trim(),sourceReference:docForm.sourceReference.trim()}}),"Controlled document created.")} className="mt-4 rounded bg-accent px-4 py-2.5 text-xs font-semibold text-bg disabled:opacity-40">Create document</button>
      </Panel>

      <Panel title="Register document revision" kicker="Exact file identity · no binary upload required">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-muted">Document<select className="control mt-1.5 w-full" value={revForm.documentId} onChange={(e)=>setRevForm({...revForm,documentId:e.target.value})}><option value="">Select document</option>{state.documents.filter((row)=>row.active).map((row)=><option key={row.id} value={row.id}>{row.documentNumber} · {row.title}</option>)}</select></label>
          <label className="text-xs text-muted">Revision<input className="control mt-1.5 w-full" value={revForm.revisionCode} onChange={(e)=>setRevForm({...revForm,revisionCode:e.target.value})} placeholder="A / 1.0 / 5.3.9"/></label>
          <label className="text-xs text-muted sm:col-span-2">SHA-256<input className="control mt-1.5 w-full font-mono" value={revForm.contentSha256} onChange={(e)=>setRevForm({...revForm,contentSha256:e.target.value.toLowerCase().trim()})} placeholder="64-character lowercase SHA-256"/></label>
          <label className="text-xs text-muted">File name<input className="control mt-1.5 w-full" value={revForm.fileName} onChange={(e)=>setRevForm({...revForm,fileName:e.target.value})}/></label>
          <label className="text-xs text-muted">Media type<input className="control mt-1.5 w-full" value={revForm.mediaType} onChange={(e)=>setRevForm({...revForm,mediaType:e.target.value})}/></label>
          <label className="text-xs text-muted">File size bytes<input type="number" min={1} className="control mt-1.5 w-full" value={revForm.fileSizeBytes} onChange={(e)=>setRevForm({...revForm,fileSizeBytes:Math.max(1,Number(e.target.value)||1)})}/></label>
          <label className="text-xs text-muted">Source URI<input className="control mt-1.5 w-full" value={revForm.sourceUri} onChange={(e)=>setRevForm({...revForm,sourceUri:e.target.value})} placeholder="github://… / drive://… / controlled path"/></label>
          <label className="text-xs text-muted sm:col-span-2">Source reference<input className="control mt-1.5 w-full" value={revForm.sourceReference} onChange={(e)=>setRevForm({...revForm,sourceReference:e.target.value})}/></label>
        </div>
        <button type="button" disabled={busy==="rev"||!revForm.documentId||!/^[0-9a-f]{64}$/.test(revForm.contentSha256)||!revForm.fileName.trim()||!revForm.sourceUri.trim()} onClick={()=>void act("rev",()=>registerEngineeringDocumentRevision({data:{...revForm,documentId:revForm.documentId,revisionCode:revForm.revisionCode.trim(),contentSha256:revForm.contentSha256,fileName:revForm.fileName.trim(),mediaType:revForm.mediaType.trim(),fileSizeBytes:revForm.fileSizeBytes,sourceUri:revForm.sourceUri.trim(),sourceReference:revForm.sourceReference.trim()}}),"Draft document revision registered.")} className="mt-4 rounded bg-accent px-4 py-2.5 text-xs font-semibold text-bg disabled:opacity-40">Register revision</button>
      </Panel>
    </div>

    <Panel title="Where-used link" kicker="Explicit relationship before approval">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <label className="text-xs text-muted">Draft revision<select className="control mt-1.5 w-full" value={linkForm.revisionId} onChange={(e)=>setLinkForm({...linkForm,revisionId:e.target.value})}><option value="">Select revision</option>{draftRevisions.map((row)=><option key={row.id} value={row.id}>{row.documentNumber} · {row.revisionCode}</option>)}</select></label>
        <label className="text-xs text-muted">Target type<select className="control mt-1.5 w-full" value={linkForm.targetType} onChange={(e)=>setLinkForm({...linkForm,targetType:e.target.value as typeof linkForm.targetType,targetId:""})}><option value="engineering_baseline">Engineering baseline</option><option value="eco">ECO</option><option value="ecn">ECN</option><option value="bom_revision">BOM release</option><option value="vedm_authority_node">VEDM authority node</option></select></label>
        <label className="text-xs text-muted">Target<select className="control mt-1.5 w-full" value={linkForm.targetId} onChange={(e)=>setLinkForm({...linkForm,targetId:e.target.value})}><option value="">Select canonical target</option>{targetOptions.map((row)=><option key={row.id} value={row.id}>{row.label}</option>)}</select></label>
        <label className="text-xs text-muted">Relation<select className="control mt-1.5 w-full" value={linkForm.relation} onChange={(e)=>setLinkForm({...linkForm,relation:e.target.value as typeof linkForm.relation})}><option value="CONTROLS">CONTROLS</option><option value="EVIDENCES">EVIDENCES</option><option value="VALIDATES">VALIDATES</option><option value="DERIVES_FROM">DERIVES_FROM</option><option value="REQUIRES">REQUIRES</option></select></label>
        <button type="button" disabled={busy==="link"||!linkForm.revisionId||!linkForm.targetId} onClick={()=>void act("link",()=>linkEngineeringDocumentRevision({data:{...linkForm,sourceReference:linkForm.sourceReference.trim()}}),"Where-used link created.")} className="self-end rounded border border-accent px-4 py-2.5 text-xs font-semibold text-accent disabled:opacity-40">Link revision</button>
      </div>
    </Panel>

    <Panel title="Controlled revision register" kicker="Lifecycle · SHA-256 · Where-used · Superseded history">
      <div className="space-y-3">{state.revisions.length?state.revisions.map((row)=><article key={row.id} className="rounded-xl border border-border bg-bg/35 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-mono text-xs font-semibold text-accent">{row.documentNumber} · {row.revisionCode}</p><p className="mt-1 text-sm font-semibold text-fg">{row.title}</p><p className="mt-1 text-[10px] text-muted">{row.fileName} · {row.mediaType} · {row.fileSizeBytes.toLocaleString("en-IN")} bytes</p></div><div className="text-right"><p className="text-[10px] font-bold uppercase tracking-wider text-green">{row.status}</p><p className="mt-1 font-mono text-[10px] text-subtle">SHA-256 {shortHash(row.contentSha256)}</p></div></div>
        <div className="mt-3 grid gap-3 lg:grid-cols-2"><div className="rounded border border-border/70 p-3"><p className="text-[10px] font-semibold uppercase tracking-wider text-subtle">Source</p><p className="mt-1 break-all text-[11px] text-muted">{row.sourceUri}</p><p className="mt-1 text-[10px] text-subtle">{row.sourceRef}</p>{row.supersedesRevisionId?<p className="mt-2 text-[10px] text-muted">Supersedes {row.supersedesRevisionId}</p>:null}{row.supersededByRevisionId?<p className="mt-1 text-[10px] text-warn">Superseded by {row.supersededByRevisionId}</p>:null}</div><div className="rounded border border-border/70 p-3"><p className="text-[10px] font-semibold uppercase tracking-wider text-subtle">Where-used</p>{row.whereUsed.length?<div className="mt-2 space-y-1">{row.whereUsed.map((link)=><p key={link.id} className="break-all text-[10px] text-muted">{link.relation} · {link.targetType} · {link.targetId}</p>)}</div>:<p className="mt-2 text-[10px] text-warn">No governed where-used link.</p>}</div></div>
        <div className="mt-3 flex flex-wrap gap-2">{row.status==="draft"?<button type="button" disabled={busy==="submit-"+row.id} onClick={()=>void act("submit-"+row.id,()=>transitionEngineeringDocumentRevision({data:{revisionId:row.id,toStatus:"pending_approval",sourceReference:"UI:ENGINEERING:PDM-SUBMIT",reason:"Submitted after checksum and where-used review."}}),"Revision submitted for approval.")} className="rounded border border-border px-3 py-2 text-[11px] font-semibold">Submit</button>:null}{row.status==="pending_approval"?<><button type="button" disabled={busy==="approve-"+row.id} onClick={()=>void act("approve-"+row.id,()=>transitionEngineeringDocumentRevision({data:{revisionId:row.id,toStatus:"approved",sourceReference:"UI:ENGINEERING:PDM-APPROVE",reason:"Document revision approved after maker-checker review."}}),"Revision approved.")} className="rounded border border-green px-3 py-2 text-[11px] font-semibold text-green">Approve</button><button type="button" disabled={busy==="reject-"+row.id} onClick={()=>void act("reject-"+row.id,()=>transitionEngineeringDocumentRevision({data:{revisionId:row.id,toStatus:"rejected",sourceReference:"UI:ENGINEERING:PDM-REJECT",reason:"Document revision rejected."}}),"Revision rejected.")} className="rounded border border-warn px-3 py-2 text-[11px] font-semibold text-warn">Reject</button></>:null}{row.status==="approved"?<button type="button" disabled={busy==="release-"+row.id} onClick={()=>void act("release-"+row.id,()=>releaseEngineeringDocumentRevision({data:{revisionId:row.id,releaseNote:"Released into controlled engineering configuration.",sourceReference:"UI:ENGINEERING:PDM-RELEASE"}}),"Revision released; prior current revision superseded if applicable.")} className="rounded bg-accent px-3 py-2 text-[11px] font-semibold text-bg">Release revision</button>:null}</div>
      </article>):<p className="text-sm text-muted">No controlled engineering revision has been registered yet.</p>}</div>
    </Panel>

    <Panel title="Released configuration manifest" kicker="Freeze exact document revisions and checksums for a released baseline">
      <div className="grid gap-3 md:grid-cols-3">
        <label className="text-xs text-muted">Released baseline<select className="control mt-1.5 w-full" value={manifestForm.baselineId} onChange={(e)=>{const baseline=state.targets.baselines.find((row)=>row.id===e.target.value);const matching=baseline?.bomRevision?state.targets.bomReleases.find((row)=>row.bomRevision===baseline.bomRevision):null;setManifestForm({...manifestForm,baselineId:e.target.value,bomReleaseId:matching?.id??""});}}><option value="">Select baseline</option>{state.targets.baselines.map((row)=><option key={row.id} value={row.id}>{row.id} · {row.familyCode} {row.revisionCode}</option>)}</select></label>
        <label className="text-xs text-muted">Exact BOM release<select className="control mt-1.5 w-full" value={manifestForm.bomReleaseId} onChange={(e)=>setManifestForm({...manifestForm,bomReleaseId:e.target.value})}><option value="">No BOM release</option>{state.targets.bomReleases.map((row)=><option key={row.id} value={row.id}>{row.venture} · {row.modelId} · {row.bomRevision}</option>)}</select></label>
        <label className="text-xs text-muted">Evidence reference<input className="control mt-1.5 w-full" value={manifestForm.sourceReference} onChange={(e)=>setManifestForm({...manifestForm,sourceReference:e.target.value})}/></label>
      </div>
      <button type="button" disabled={busy==="manifest"||!manifestForm.baselineId||manifestForm.sourceReference.trim().length<2} onClick={()=>void act("manifest",()=>captureEngineeringConfigurationManifest({data:{baselineId:manifestForm.baselineId,bomReleaseId:manifestForm.bomReleaseId||null,sourceReference:manifestForm.sourceReference.trim()}}),"Released configuration manifest frozen.")} className="mt-4 rounded bg-accent px-4 py-2.5 text-xs font-semibold text-bg disabled:opacity-40">Freeze released manifest</button>
      <div className="mt-4 space-y-2">{state.manifests.length?state.manifests.map((row)=><div key={row.id} className="rounded-lg border border-border/70 p-3"><div className="flex flex-wrap justify-between gap-3"><div><p className="font-mono text-xs font-semibold text-fg">{row.id}</p><p className="mt-1 text-[10px] text-muted">Baseline {row.baselineId}{row.bomReleaseId?" · BOM release "+row.bomReleaseId:""}</p></div><div className="text-right"><p className="text-xs font-semibold">{row.documentCount} document(s)</p><p className="mt-1 font-mono text-[10px] text-subtle">{shortHash(row.configurationFingerprint)}</p></div></div></div>):<p className="text-xs text-muted">No released configuration manifest frozen yet.</p>}</div>
    </Panel>
  </div>;
}
