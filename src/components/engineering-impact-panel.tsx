import { useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { Kpi, Panel } from "@/components/kpi";
import { assessEngineeringImpact } from "@/lib/impact-propagation-authority";

type Row=Record<string,unknown>;
type ImpactResult={
  sourceNodeId:string;
  sourceNode:{id:string;title:string;domain:string}|null;
  affectedNodes:Array<{
    id:string;title:string;kind:string;domain:string;depth:number;viaRelation:string;
    impactAction:string;path:string[];
  }>;
  engineeringObjectIds:string[];
  evidenceIds:string[];
  releaseGateIds:string[];
  evidenceSuspectCount:number;
  releaseGateReviewCount:number;
  affectedProgramTasks:Array<{id:string;title:string;status:string}>;
  affectedRisks:Array<{id:string;risk:string;status:string;exposureScore:number|null}>;
  issues:string[];
  changeReference:string;
  sourceCommit:string;
  advisoryOnly:boolean;
};

const text=(row:Row,key:string)=>row[key]==null?"":String(row[key]);

export function EngineeringImpactPanel({
  state,
}:{
  state:{
    nodes:Array<{id:string;title:string;kind:string;domain:string;lifecycle:string;sourceRef:string}>;
    recent:Row[];
    source:{repository:string;commit:string;asOfDate:string};
  };
}){
  const router=useRouter();
  const [sourceNodeId,setSourceNodeId]=useState("");
  const [changeReference,setChangeReference]=useState("");
  const [result,setResult]=useState<ImpactResult|null>(null);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");

  async function assess(){
    setBusy(true);
    setMessage("");
    try{
      const response=await assessEngineeringImpact({data:{sourceNodeId,changeReference}});
      setResult(response.result as ImpactResult);
      setMessage(`Impact assessment ${response.id} captured as immutable advisory evidence.`);
      await router.invalidate();
    }catch(error){
      setMessage(error instanceof Error?error.message:"Impact assessment failed.");
    }finally{
      setBusy(false);
    }
  }

  return <div className="space-y-4">
    <Panel title="Engineering Impact Analysis" kicker="Engineering Graph traversal · advisory only · no automatic authority mutation">
      <div className="grid gap-3 lg:grid-cols-[1.2fr_1.6fr_auto]">
        <label className="text-xs text-muted">Changed / candidate source node
          <select className="control mt-1.5 w-full" value={sourceNodeId} onChange={(e)=>setSourceNodeId(e.target.value)}>
            <option value="">Select governed graph node</option>
            {state.nodes.map((node)=><option key={node.id} value={node.id}>{node.id} · {node.domain} · {node.title}</option>)}
          </select>
        </label>
        <label className="text-xs text-muted">Change / evidence reference
          <input className="control mt-1.5 w-full" value={changeReference} onChange={(e)=>setChangeReference(e.target.value)} placeholder="ECR, supplier revision, analysis or controlled source reference"/>
        </label>
        <button type="button" disabled={busy||!sourceNodeId||!changeReference.trim()} onClick={()=>void assess()} className="self-end rounded bg-accent px-4 py-2.5 text-xs font-semibold text-bg disabled:opacity-40">Assess impact</button>
      </div>
      <p className="mt-3 text-xs text-muted">Graph source: {state.source.repository}@{state.source.commit.slice(0,8)} · as of {state.source.asOfDate}. Only represented graph relationships are propagated; absent relationships remain coverage gaps.</p>
      {message?<div role="status" className="mt-3 rounded border border-border bg-surface px-3 py-2 text-xs text-muted">{message}</div>:null}
    </Panel>

    {result?<>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Kpi label="Affected nodes" value={String(result.affectedNodes.length)} hint={result.sourceNode?.title||result.sourceNodeId}/>
        <Kpi label="Engineering objects" value={String(result.engineeringObjectIds.length)} hint="Refresh/review"/>
        <Kpi label="Evidence suspect" value={String(result.evidenceSuspectCount)} hint="Revalidation required" tone={result.evidenceSuspectCount?"warn":"ok"}/>
        <Kpi label="Release gates" value={String(result.releaseGateReviewCount)} hint="Review required" tone={result.releaseGateReviewCount?"danger":"ok"}/>
        <Kpi label="Program tasks" value={String(result.affectedProgramTasks.length)} hint="Linked schedule work"/>
        <Kpi label="Risks" value={String(result.affectedRisks.length)} hint="Linked governed risks" tone={result.affectedRisks.length?"warn":"ok"}/>
      </div>

      <Panel title="Impact propagation" kicker="First discovered controlled path · relation · required action">
        {result.affectedNodes.length?<div className="overflow-x-auto"><table className="w-full min-w-[980px] text-xs">
          <thead className="border-b border-border uppercase tracking-wider text-subtle"><tr><th className="px-3 py-2 text-left">Node</th><th className="px-3 py-2 text-left">Kind / domain</th><th className="px-3 py-2 text-left">Relation</th><th className="px-3 py-2 text-left">Impact action</th><th className="px-3 py-2 text-left">Path</th></tr></thead>
          <tbody>{result.affectedNodes.map((node)=><tr key={node.id} className="border-t border-border/70"><td className="px-3 py-3"><p className="font-semibold text-fg">{node.title}</p><p className="font-mono text-[10px] text-subtle">{node.id}</p></td><td className="px-3 py-3 text-muted">{node.kind} · {node.domain}</td><td className="px-3 py-3 text-muted">{node.viaRelation}</td><td className="px-3 py-3 font-semibold text-accent">{node.impactAction.replaceAll("_"," ")}</td><td className="max-w-lg px-3 py-3 text-[10px] text-muted">{node.path.join(" → ")}</td></tr>)}</tbody>
        </table></div>:<p className="text-sm text-muted">No downstream graph relationship is represented for this source. Do not infer broader impact until graph coverage is extended.</p>}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Program impact" kicker="Tasks linked by required input/evidence">
          {result.affectedProgramTasks.length?<div className="space-y-2">{result.affectedProgramTasks.map((item)=><div key={item.id} className="rounded border border-border p-3 text-xs"><p className="font-semibold text-fg">{item.id} · {item.title}</p><p className="mt-1 text-muted">Current state: {item.status}</p></div>)}</div>:<p className="text-sm text-muted">No persisted program task currently links to the impacted graph nodes.</p>}
        </Panel>
        <Panel title="Risk impact" kicker="Canonical risks linked to affected governed objects">
          {result.affectedRisks.length?<div className="space-y-2">{result.affectedRisks.map((item)=><div key={item.id} className="rounded border border-border p-3 text-xs"><p className="font-semibold text-fg">{item.id} · {item.risk}</p><p className="mt-1 text-muted">State {item.status} · exposure {item.exposureScore??"unrated"}/9</p></div>)}</div>:<p className="text-sm text-muted">No active canonical risk currently links to the impacted graph nodes.</p>}
        </Panel>
      </div>
    </>:null}

    <Panel title="Recent impact evidence" kicker="Immutable advisory snapshots">
      {state.recent.length?<div className="space-y-2">{state.recent.map((row)=><div key={text(row,"id")} className="grid gap-1 rounded border border-border p-3 text-xs md:grid-cols-[180px_1fr_160px]"><span className="font-mono text-subtle">{text(row,"source_node_id")}</span><span className="text-muted">{text(row,"change_reference")}</span><span className="text-subtle">{text(row,"created_at")}</span></div>)}</div>:<p className="text-sm text-muted">No impact assessment has been captured yet.</p>}
    </Panel>
  </div>;
}
