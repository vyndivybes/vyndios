import { useMemo, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { Kpi, Panel } from "@/components/kpi";
import { runProgramForecast, updateProgramForecastInputs } from "@/lib/forecast-authority";

type Row=Record<string,unknown>;
type ForecastState={
  tasks:Row[];
  dependencies:Row[];
  live:{
    method:string;
    schedule:{
      available:boolean;coveragePct:number;missingTaskIds:string[];criticalPath:string[];
      p50Days:number|null;p80Days:number|null;p95Days:number|null;reason:string;
    };
    cost:{
      available:boolean;coveragePct:number;requiredTaskCount:number;missingTaskIds:string[];
      p50Lakh:number|null;p80Lakh:number|null;p95Lakh:number|null;reason:string;
    };
    limitations:string[];
  };
  latest:{
    id:string;method:string;sourceReference:string;createdAt:string;
    result:ForecastState["live"];
  }|null;
};

const text=(row:Row,key:string)=>row[key]==null?"":String(row[key]);
const val=(row:Row,key:string)=>row[key]==null?"":String(row[key]);
const optional=(value:string)=>{
  if(!value.trim()) return null;
  const n=Number(value);
  return Number.isFinite(n)?n:null;
};
const money=(value:number|null)=>value==null?"—":`₹${value.toFixed(1)}L`;

export function ProgramForecastPanel({state}:{state:ForecastState}){
  const router=useRouter();
  const [drafts,setDrafts]=useState<Record<string,Record<string,string|boolean>>>({});
  const [sourceReference,setSourceReference]=useState("UI:PROGRAM_FORECAST");
  const [busy,setBusy]=useState("");
  const [message,setMessage]=useState("");
  const live=state.live;

  const rows=useMemo(()=>state.tasks.map((row)=>{
    const id=text(row,"id");
    const draft=drafts[id]??{};
    return {
      row,id,
      o:String(draft.o??val(row,"optimistic_days")),
      m:String(draft.m??val(row,"most_likely_days")),
      p:String(draft.p??val(row,"pessimistic_days")),
      costRequired:Boolean(draft.costRequired??row.cost_forecast_required),
      co:String(draft.co??val(row,"cost_optimistic_lakh")),
      cm:String(draft.cm??val(row,"cost_most_likely_lakh")),
      cp:String(draft.cp??val(row,"cost_pessimistic_lakh")),
    };
  }),[state.tasks,drafts]);

  function patch(id:string,key:string,value:string|boolean){
    setDrafts((current)=>({...current,[id]:{...(current[id]??{}),[key]:value}}));
  }

  async function save(rowData:(typeof rows)[number]){
    setBusy(rowData.id);
    setMessage("");
    try{
      await updateProgramForecastInputs({data:{
        taskId:rowData.id,
        optimisticDays:optional(rowData.o),
        mostLikelyDays:optional(rowData.m),
        pessimisticDays:optional(rowData.p),
        costForecastRequired:rowData.costRequired,
        costOptimisticLakh:optional(rowData.co),
        costMostLikelyLakh:optional(rowData.cm),
        costPessimisticLakh:optional(rowData.cp),
        sourceReference,
      }});
      setMessage(`Forecast inputs saved for ${rowData.id}.`);
      await router.invalidate();
    }catch(error){
      setMessage(error instanceof Error?error.message:"Unable to save forecast inputs.");
    }finally{setBusy("");}
  }

  async function run(){
    setBusy("run");
    setMessage("");
    try{
      const response=await runProgramForecast({data:{sourceReference}});
      setMessage(`Forecast ${response.id} captured as immutable governed evidence.`);
      await router.invalidate();
    }catch(error){
      setMessage(error instanceof Error?error.message:"Forecast run failed.");
    }finally{setBusy("");}
  }

  return <div className="space-y-4">
    <Panel title="Schedule & Cost Forecast" kicker="PERT three-point approximation · explicit uncertainty inputs · no false precision">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Kpi label="Schedule coverage" value={`${live.schedule.coveragePct.toFixed(1)}%`} hint={live.schedule.available?"Forecastable":"P quantiles withheld"} tone={live.schedule.available?"ok":"warn"}/>
        <Kpi label="Schedule P50" value={live.schedule.p50Days==null?"WITHHELD":`${live.schedule.p50Days} d`} hint="From program start"/>
        <Kpi label="Schedule P80" value={live.schedule.p80Days==null?"WITHHELD":`${live.schedule.p80Days} d`} hint="Planning quantile"/>
        <Kpi label="Schedule P95" value={live.schedule.p95Days==null?"WITHHELD":`${live.schedule.p95Days} d`} hint="Planning quantile"/>
        <Kpi label="Cost coverage" value={`${live.cost.coveragePct.toFixed(1)}%`} hint={live.cost.requiredTaskCount?`${live.cost.requiredTaskCount} cost-required task(s)`:"No cost-required tasks"} tone={live.cost.available?"ok":"warn"}/>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-border p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-green">Schedule distribution</p>
          {live.schedule.available?<div className="mt-3 grid grid-cols-3 gap-3 text-center"><div><p className="text-[10px] text-subtle">P50</p><p className="text-xl font-semibold text-accent">{live.schedule.p50Days} d</p></div><div><p className="text-[10px] text-subtle">P80</p><p className="text-xl font-semibold text-accent">{live.schedule.p80Days} d</p></div><div><p className="text-[10px] text-subtle">P95</p><p className="text-xl font-semibold text-accent">{live.schedule.p95Days} d</p></div><p className="col-span-3 text-xs text-muted">Expected critical path: {live.schedule.criticalPath.join(" → ")||"none"}</p></div>:<div className="mt-3 text-sm text-muted"><p>{live.schedule.reason}</p>{live.schedule.missingTaskIds.length?<p className="mt-2 text-xs text-warn">Missing complete O/M/P: {live.schedule.missingTaskIds.join(", ")}</p>:null}</div>}
        </div>
        <div className="rounded-xl border border-border p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-green">Cost distribution</p>
          {live.cost.available?<div className="mt-3 grid grid-cols-3 gap-3 text-center"><div><p className="text-[10px] text-subtle">P50</p><p className="text-xl font-semibold text-accent">{money(live.cost.p50Lakh)}</p></div><div><p className="text-[10px] text-subtle">P80</p><p className="text-xl font-semibold text-accent">{money(live.cost.p80Lakh)}</p></div><div><p className="text-[10px] text-subtle">P95</p><p className="text-xl font-semibold text-accent">{money(live.cost.p95Lakh)}</p></div></div>:<div className="mt-3 text-sm text-muted"><p>{live.cost.reason}</p>{live.cost.missingTaskIds.length?<p className="mt-2 text-xs text-warn">Missing complete cost O/M/P: {live.cost.missingTaskIds.join(", ")}</p>:null}</div>}
        </div>
      </div>

      <label className="mt-4 block max-w-2xl text-xs text-muted">Forecast source / decision reference<input className="control mt-1.5 w-full" value={sourceReference} onChange={(e)=>setSourceReference(e.target.value)}/></label>
      <button type="button" disabled={busy==="run"||(!live.schedule.available&&!live.cost.available)||!sourceReference.trim()} onClick={()=>void run()} className="mt-3 rounded bg-accent px-4 py-2 text-xs font-semibold text-bg disabled:opacity-40">Capture governed forecast run</button>
      {message?<div role="status" className="mt-3 rounded border border-border bg-surface px-3 py-2 text-xs text-muted">{message}</div>:null}
    </Panel>

    <Panel title="Forecast Inputs" kicker="O = optimistic · M = most likely · P = pessimistic">
      {rows.length?<div className="overflow-x-auto"><table className="w-full min-w-[1280px] text-xs">
        <thead className="border-b border-border uppercase tracking-wider text-subtle"><tr><th className="px-3 py-2 text-left">Task</th><th className="px-3 py-2 text-left">Schedule O / M / P days</th><th className="px-3 py-2 text-left">Cost required</th><th className="px-3 py-2 text-left">Cost O / M / P ₹L</th><th className="px-3 py-2 text-left">Evidence</th><th className="px-3 py-2 text-left">Control</th></tr></thead>
        <tbody>{rows.map((item)=><tr key={item.id} className="border-t border-border/70"><td className="px-3 py-3"><p className="font-semibold text-fg">{text(item.row,"title")}</p><p className="font-mono text-[10px] text-subtle">{item.id}</p></td><td className="px-3 py-3"><div className="flex gap-2">{(["o","m","p"] as const).map((key)=><input key={key} inputMode="decimal" className="control w-24" value={item[key]} onChange={(e)=>patch(item.id,key,e.target.value)} placeholder={key.toUpperCase()}/>)}</div></td><td className="px-3 py-3"><label className="inline-flex items-center gap-2"><input type="checkbox" checked={item.costRequired} onChange={(e)=>patch(item.id,"costRequired",e.target.checked)}/>Include</label></td><td className="px-3 py-3"><div className="flex gap-2">{(["co","cm","cp"] as const).map((key)=><input key={key} inputMode="decimal" className="control w-24" value={item[key]} onChange={(e)=>patch(item.id,key,e.target.value)} placeholder={key==="co"?"O":key==="cm"?"M":"P"}/>)}</div></td><td className="max-w-xs px-3 py-3 text-[10px] text-muted">{text(item.row,"source_reference")}</td><td className="px-3 py-3"><button type="button" disabled={busy===item.id||!sourceReference.trim()} onClick={()=>void save(item)} className="rounded border border-border px-2 py-1.5 font-semibold hover:border-accent disabled:opacity-40">Save O/M/P</button></td></tr>)}</tbody>
      </table></div>:<p className="text-sm text-muted">No governed program tasks exist. Build the Program & Gate Plan before forecasting.</p>}
    </Panel>

    <Panel title="Forecast method & limitations" kicker={live.method}>
      <div className="space-y-1">{live.limitations.map((item)=><p key={item} className="text-xs leading-5 text-muted">• {item}</p>)}</div>
      {state.latest?<p className="mt-3 text-[10px] text-subtle">Latest captured run: {state.latest.id} · {state.latest.sourceReference} · {state.latest.createdAt}</p>:<p className="mt-3 text-[10px] text-subtle">No immutable forecast run captured yet.</p>}
    </Panel>
  </div>;
}
