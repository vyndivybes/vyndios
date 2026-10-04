import { useState } from "react";
import { Kpi, Panel } from "@/components/kpi";
import { runEngineeringScenario } from "@/lib/engineering-scenario-authority";

type Row=Record<string,unknown>;
type ScenarioState={
  nodes:Array<{id:string;title:string;kind:string;domain:string;lifecycle:string}>;
  tasks:Array<{
    id:string;title:string;status:string;
    optimisticDays:number|null;mostLikelyDays:number|null;pessimisticDays:number|null;
    costForecastRequired:boolean;costOptimisticLakh:number|null;costMostLikelyLakh:number|null;costPessimisticLakh:number|null;
  }>;
  recent:Row[];
  source:{repository:string;commit:string;asOfDate:string};
};

type ScenarioResult={
  valid:true;
  scenarioName:string;
  sourceReference:string;
  impact:{
    sourceNodeId:string;
    sourceNode:{id:string;title:string;domain:string}|null;
    affectedNodes:Array<{id:string;title:string;kind:string;domain:string;impactAction:string;path:string[]}>;
    evidenceSuspectCount:number;
    releaseGateReviewCount:number;
    engineeringObjectIds:string[];
    evidenceIds:string[];
    releaseGateIds:string[];
  };
  baseline:{
    schedule:{available:boolean;p50Days:number|null;p80Days:number|null;p95Days:number|null;criticalPath:string[]};
    cost:{available:boolean;p50Lakh:number|null;p80Lakh:number|null;p95Lakh:number|null};
  };
  scenario:{
    schedule:{available:boolean;p50Days:number|null;p80Days:number|null;p95Days:number|null;criticalPath:string[]};
    cost:{available:boolean;p50Lakh:number|null;p80Lakh:number|null;p95Lakh:number|null};
  };
  scheduleDelta:{p50Days:number|null;p80Days:number|null;p95Days:number|null}|null;
  costDelta:{p50Lakh:number|null;p80Lakh:number|null;p95Lakh:number|null}|null;
  linkedProgramTasks:Array<{id:string;title:string;status:string}>;
  linkedRisks:Array<{id:string;risk:string;status:string;exposureScore:number|null}>;
  issues:string[];
};

const text=(row:Row,key:string)=>row[key]==null?"":String(row[key]);
const optional=(value:string)=>{
  if(!value.trim()) return null;
  const n=Number(value);
  return Number.isFinite(n)?n:null;
};
const signed=(value:number|null,suffix="")=>value==null?"WITHHELD":`${value>=0?"+":""}${value.toFixed(1)}${suffix}`;
const money=(value:number|null)=>value==null?"WITHHELD":`₹${value.toFixed(1)}L`;

export function EngineeringScenarioPanel({state}:{state:ScenarioState}){
  const [scenarioName,setScenarioName]=useState("Engineering what-if");
  const [sourceNodeId,setSourceNodeId]=useState("");
  const [targetTaskId,setTargetTaskId]=useState("");
  const [scheduleO,setScheduleO]=useState("");
  const [scheduleM,setScheduleM]=useState("");
  const [scheduleP,setScheduleP]=useState("");
  const [costO,setCostO]=useState("");
  const [costM,setCostM]=useState("");
  const [costP,setCostP]=useState("");
  const [sourceReference,setSourceReference]=useState("UI:ENGINEERING_SCENARIO");
  const [result,setResult]=useState<ScenarioResult|null>(null);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");

  function selectTask(id:string){
    setTargetTaskId(id);
    const task=state.tasks.find((item)=>item.id===id);
    if(!task) return;
    setScheduleO(task.optimisticDays==null?"":String(task.optimisticDays));
    setScheduleM(task.mostLikelyDays==null?"":String(task.mostLikelyDays));
    setScheduleP(task.pessimisticDays==null?"":String(task.pessimisticDays));
    setCostO(task.costOptimisticLakh==null?"":String(task.costOptimisticLakh));
    setCostM(task.costMostLikelyLakh==null?"":String(task.costMostLikelyLakh));
    setCostP(task.costPessimisticLakh==null?"":String(task.costPessimisticLakh));
  }

  async function run(){
    setBusy(true);
    setMessage("");
    try{
      const response=await runEngineeringScenario({data:{
        scenarioName,
        sourceNodeId,
        targetTaskId:targetTaskId||null,
        scheduleOptimisticDays:optional(scheduleO),
        scheduleMostLikelyDays:optional(scheduleM),
        schedulePessimisticDays:optional(scheduleP),
        costOptimisticLakh:optional(costO),
        costMostLikelyLakh:optional(costM),
        costPessimisticLakh:optional(costP),
        sourceReference,
      }});
      setResult(response.result as ScenarioResult);
      setMessage(`Scenario ${response.id} captured as immutable advisory evidence.`);
    }catch(error){
      setMessage(error instanceof Error?error.message:"Engineering scenario failed.");
    }finally{
      setBusy(false);
    }
  }

  return <div className="space-y-5">
    <Panel title="Engineering Scenario Engine" kicker="Change X → graph impact → schedule/cost consequence → risk/release review">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <label className="text-xs text-muted">Scenario name<input className="control mt-1.5 w-full" value={scenarioName} onChange={(e)=>setScenarioName(e.target.value)}/></label>
        <label className="text-xs text-muted xl:col-span-2">Changed governed node<select className="control mt-1.5 w-full" value={sourceNodeId} onChange={(e)=>setSourceNodeId(e.target.value)}><option value="">Select Engineering Graph node</option>{state.nodes.map((node)=><option key={node.id} value={node.id}>{node.id} · {node.domain} · {node.title}</option>)}</select></label>
        <label className="text-xs text-muted">Target program task<select className="control mt-1.5 w-full" value={targetTaskId} onChange={(e)=>selectTask(e.target.value)}><option value="">Impact only / no forecast override</option>{state.tasks.map((task)=><option key={task.id} value={task.id}>{task.id} · {task.title}</option>)}</select></label>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-border p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-green">Scenario schedule O / M / P days</p>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <input inputMode="decimal" className="control" value={scheduleO} onChange={(e)=>setScheduleO(e.target.value)} placeholder="Optimistic"/>
            <input inputMode="decimal" className="control" value={scheduleM} onChange={(e)=>setScheduleM(e.target.value)} placeholder="Most likely"/>
            <input inputMode="decimal" className="control" value={scheduleP} onChange={(e)=>setScheduleP(e.target.value)} placeholder="Pessimistic"/>
          </div>
          <p className="mt-2 text-[10px] text-subtle">Leave all three blank for impact-only analysis. Values are scenario assumptions and do not update the governed task.</p>
        </div>
        <div className="rounded-xl border border-border p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-green">Scenario cost O / M / P ₹L</p>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <input inputMode="decimal" className="control" value={costO} onChange={(e)=>setCostO(e.target.value)} placeholder="Optimistic"/>
            <input inputMode="decimal" className="control" value={costM} onChange={(e)=>setCostM(e.target.value)} placeholder="Most likely"/>
            <input inputMode="decimal" className="control" value={costP} onChange={(e)=>setCostP(e.target.value)} placeholder="Pessimistic"/>
          </div>
          <p className="mt-2 text-[10px] text-subtle">Cost overrides remain scenario-only. No approved budget, PO, ledger or program task is changed.</p>
        </div>
      </div>

      <label className="mt-4 block max-w-3xl text-xs text-muted">Scenario source / decision reference<input className="control mt-1.5 w-full" value={sourceReference} onChange={(e)=>setSourceReference(e.target.value)}/></label>
      <button type="button" disabled={busy||!scenarioName.trim()||!sourceNodeId||!sourceReference.trim()} onClick={()=>void run()} className="mt-3 rounded bg-accent px-4 py-2.5 text-xs font-semibold text-bg disabled:opacity-40">{busy?"Running scenario…":"Run engineering scenario"}</button>
      {message?<div role="status" className="mt-3 rounded border border-border bg-surface px-3 py-2 text-xs text-muted">{message}</div>:null}
      <p className="mt-3 text-[10px] text-subtle">Authority graph: {state.source.repository}@{state.source.commit.slice(0,8)} · scenario outputs are advisory snapshots only.</p>
    </Panel>

    {result?<>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Kpi label="Affected nodes" value={String(result.impact.affectedNodes.length)} hint={result.impact.sourceNode?.title||result.impact.sourceNodeId}/>
        <Kpi label="Evidence suspect" value={String(result.impact.evidenceSuspectCount)} hint="Review / revalidation" tone={result.impact.evidenceSuspectCount?"warn":"ok"}/>
        <Kpi label="Release gates" value={String(result.impact.releaseGateReviewCount)} hint="Review required" tone={result.impact.releaseGateReviewCount?"danger":"ok"}/>
        <Kpi label="Schedule Δ P50" value={signed(result.scheduleDelta?.p50Days??null," d")} hint="Scenario vs baseline"/>
        <Kpi label="Cost Δ P50" value={result.costDelta?.p50Lakh==null?"WITHHELD":signed(result.costDelta.p50Lakh,"L")} hint="₹ lakh; scenario vs baseline"/>
        <Kpi label="Linked risks" value={String(result.linkedRisks.length)} hint="Canonical active risks" tone={result.linkedRisks.length?"warn":"ok"}/>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Baseline vs scenario forecast" kicker="Governed baseline inputs vs scenario-only assumptions">
          <div className="overflow-x-auto"><table className="w-full min-w-[600px] text-xs"><thead className="border-b border-border uppercase tracking-wider text-subtle"><tr><th className="px-3 py-2 text-left">Measure</th><th className="px-3 py-2 text-right">Baseline</th><th className="px-3 py-2 text-right">Scenario</th><th className="px-3 py-2 text-right">Δ</th></tr></thead><tbody>
            <tr className="border-t border-border/70"><td className="px-3 py-3">Schedule P50</td><td className="px-3 py-3 text-right">{result.baseline.schedule.p50Days==null?"WITHHELD":`${result.baseline.schedule.p50Days} d`}</td><td className="px-3 py-3 text-right">{result.scenario.schedule.p50Days==null?"WITHHELD":`${result.scenario.schedule.p50Days} d`}</td><td className="px-3 py-3 text-right font-semibold">{signed(result.scheduleDelta?.p50Days??null," d")}</td></tr>
            <tr className="border-t border-border/70"><td className="px-3 py-3">Schedule P80</td><td className="px-3 py-3 text-right">{result.baseline.schedule.p80Days==null?"WITHHELD":`${result.baseline.schedule.p80Days} d`}</td><td className="px-3 py-3 text-right">{result.scenario.schedule.p80Days==null?"WITHHELD":`${result.scenario.schedule.p80Days} d`}</td><td className="px-3 py-3 text-right font-semibold">{signed(result.scheduleDelta?.p80Days??null," d")}</td></tr>
            <tr className="border-t border-border/70"><td className="px-3 py-3">Schedule P95</td><td className="px-3 py-3 text-right">{result.baseline.schedule.p95Days==null?"WITHHELD":`${result.baseline.schedule.p95Days} d`}</td><td className="px-3 py-3 text-right">{result.scenario.schedule.p95Days==null?"WITHHELD":`${result.scenario.schedule.p95Days} d`}</td><td className="px-3 py-3 text-right font-semibold">{signed(result.scheduleDelta?.p95Days??null," d")}</td></tr>
            <tr className="border-t border-border/70"><td className="px-3 py-3">Cost P50</td><td className="px-3 py-3 text-right">{money(result.baseline.cost.p50Lakh)}</td><td className="px-3 py-3 text-right">{money(result.scenario.cost.p50Lakh)}</td><td className="px-3 py-3 text-right font-semibold">{result.costDelta?.p50Lakh==null?"WITHHELD":`${result.costDelta.p50Lakh>=0?"+":""}₹${result.costDelta.p50Lakh.toFixed(1)}L`}</td></tr>
          </tbody></table></div>
          <p className="mt-3 text-xs text-muted">Baseline path: {result.baseline.schedule.criticalPath.join(" → ")||"unavailable"}<br/>Scenario path: {result.scenario.schedule.criticalPath.join(" → ")||"unavailable"}</p>
        </Panel>

        <Panel title="Technical / release impact" kicker="Controlled graph relationships only">
          {result.impact.affectedNodes.length?<div className="space-y-2">{result.impact.affectedNodes.slice(0,10).map((node)=><div key={node.id} className="rounded border border-border p-3 text-xs"><div className="flex flex-wrap justify-between gap-2"><p className="font-semibold text-fg">{node.id} · {node.title}</p><span className="font-semibold text-accent">{node.impactAction.replaceAll("_"," ")}</span></div><p className="mt-1 text-muted">{node.kind} · {node.domain}</p><p className="mt-1 break-words text-[10px] text-subtle">{node.path.join(" → ")}</p></div>)}</div>:<p className="text-sm text-muted">No represented downstream graph impact.</p>}
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Program implications" kicker="Tasks linked to affected controlled nodes">
          {result.linkedProgramTasks.length?<div className="space-y-2">{result.linkedProgramTasks.map((task)=><div key={task.id} className="rounded border border-border p-3 text-xs"><p className="font-semibold">{task.id} · {task.title}</p><p className="mt-1 text-muted">Current governed state: {task.status}</p></div>)}</div>:<p className="text-sm text-muted">No current program task links to the affected nodes.</p>}
        </Panel>
        <Panel title="Risk implications" kicker="Existing canonical risk links only">
          {result.linkedRisks.length?<div className="space-y-2">{result.linkedRisks.map((risk)=><div key={risk.id} className="rounded border border-border p-3 text-xs"><p className="font-semibold">{risk.id} · {risk.risk}</p><p className="mt-1 text-muted">State {risk.status} · governed exposure {risk.exposureScore??"unrated"}/9</p></div>)}</div>:<p className="text-sm text-muted">No active canonical risk currently links to the affected nodes.</p>}
        </Panel>
      </div>

      {result.issues.length?<Panel title="Coverage / forecast caveats" kicker="Do not infer missing evidence">{result.issues.map((issue)=><p key={issue} className="text-xs leading-5 text-muted">• {issue}</p>)}</Panel>:null}
    </>:null}

    <Panel title="Recent Engineering Scenarios" kicker="Immutable advisory evidence">
      {state.recent.length?<div className="space-y-2">{state.recent.map((row)=><div key={text(row,"id")} className="grid gap-1 rounded border border-border p-3 text-xs md:grid-cols-[180px_1fr_180px]"><span className="font-mono text-subtle">{text(row,"scenario_name")}</span><span className="text-muted">{text(row,"source_node_id")} · {text(row,"source_reference")}</span><span className="text-subtle">{text(row,"created_at")}</span></div>)}</div>:<p className="text-sm text-muted">No Engineering Scenario has been captured yet.</p>}
    </Panel>
  </div>;
}
