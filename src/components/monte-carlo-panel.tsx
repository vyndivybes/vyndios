import { useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { Kpi, Panel } from "@/components/kpi";
import { runMonteCarloProgramForecast } from "@/lib/monte-carlo-authority";

type MonteCarloState={
  taskCount:number;
  scheduleInputCoveragePct:number;
  costRequiredCount:number;
  latest:{
    id:string;method:string;iterations:number;seed:number;sourceReference:string;createdAt:string;
    result:{
      available:boolean;
      schedule:{p50Days:number|null;p80Days:number|null;p95Days:number|null;minDays:number|null;maxDays:number|null;criticalPathFrequency:Array<{path:string[];count:number;frequencyPct:number}>};
      cost:{available:boolean;p50Lakh:number|null;p80Lakh:number|null;p95Lakh:number|null;minLakh:number|null;maxLakh:number|null};
      limitations:string[];
      issues:string[];
    };
  }|null;
};

const money=(value:number|null)=>value==null?"WITHHELD":`₹${value.toFixed(1)}L`;

export function MonteCarloPanel({state}:{state:MonteCarloState}){
  const router=useRouter();
  const [iterations,setIterations]=useState("5000");
  const [seed,setSeed]=useState("4210");
  const [sourceReference,setSourceReference]=useState("UI:MONTE_CARLO_FORECAST");
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");

  async function run(){
    setBusy(true);
    setMessage("");
    try{
      const response=await runMonteCarloProgramForecast({data:{
        iterations:Math.round(Number(iterations)||0),
        seed:Math.round(Number(seed)||0),
        sourceReference,
      }});
      setMessage(`Monte Carlo run ${response.id} captured as immutable governed evidence.`);
      await router.invalidate();
    }catch(error){
      setMessage(error instanceof Error?error.message:"Monte Carlo run failed.");
    }finally{
      setBusy(false);
    }
  }

  const result=state.latest?.result??null;

  return <div className="space-y-4">
    <Panel title="Monte Carlo Uncertainty" kicker="Triangular task uncertainty · critical path recalculated every iteration">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Kpi label="Schedule input coverage" value={`${state.scheduleInputCoveragePct.toFixed(1)}%`} hint={`${state.taskCount} governed task(s)`} tone={state.scheduleInputCoveragePct===100?"ok":"warn"}/>
        <Kpi label="MC Schedule P50" value={result?.schedule.p50Days==null?"WITHHELD":`${result.schedule.p50Days} d`} hint={state.latest?`${state.latest.iterations.toLocaleString("en-IN")} iterations`:"No captured run"}/>
        <Kpi label="MC Schedule P80" value={result?.schedule.p80Days==null?"WITHHELD":`${result.schedule.p80Days} d`} hint="Resampled critical path"/>
        <Kpi label="MC Schedule P95" value={result?.schedule.p95Days==null?"WITHHELD":`${result.schedule.p95Days} d`} hint="Planning quantile"/>
        <Kpi label="MC Cost P50" value={result?.cost.p50Lakh==null?"WITHHELD":money(result.cost.p50Lakh)} hint={`${state.costRequiredCount} cost-required task(s)`}/>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
        <div className="rounded-xl border border-border p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-green">Run controls</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-muted">Iterations<input type="number" min="1000" max="50000" step="1000" className="control mt-1.5 w-full" value={iterations} onChange={(e)=>setIterations(e.target.value)}/></label>
            <label className="text-xs text-muted">Deterministic seed<input type="number" min="1" className="control mt-1.5 w-full" value={seed} onChange={(e)=>setSeed(e.target.value)}/></label>
          </div>
          <label className="mt-3 block text-xs text-muted">Source / decision reference<input className="control mt-1.5 w-full" value={sourceReference} onChange={(e)=>setSourceReference(e.target.value)}/></label>
          <button type="button" disabled={busy||state.scheduleInputCoveragePct<100||!sourceReference.trim()} onClick={()=>void run()} className="mt-3 rounded bg-accent px-4 py-2 text-xs font-semibold text-bg disabled:opacity-40">{busy?"Simulating…":"Run governed Monte Carlo"}</button>
          {message?<div role="status" className="mt-3 rounded border border-border bg-surface px-3 py-2 text-xs text-muted">{message}</div>:null}
        </div>

        <div className="rounded-xl border border-border p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-green">Critical-path frequency</p>
          {result?.schedule.criticalPathFrequency.length?<div className="mt-3 space-y-2">{result.schedule.criticalPathFrequency.slice(0,8).map((item)=><div key={item.path.join("→")} className="rounded border border-border p-3"><div className="flex items-center justify-between gap-3"><span className="text-xs font-semibold text-fg">{item.path.join(" → ")}</span><span className="text-xs font-semibold text-accent">{item.frequencyPct.toFixed(1)}%</span></div><p className="mt-1 text-[10px] text-muted">{item.count.toLocaleString("en-IN")} sampled iteration(s)</p></div>)}</div>:<p className="mt-3 text-sm text-muted">No captured Monte Carlo run yet. Complete schedule O/M/P inputs for every governed program task first.</p>}
        </div>
      </div>

      {state.latest?<p className="mt-4 text-[10px] text-subtle">Latest: {state.latest.id} · seed {state.latest.seed} · {state.latest.sourceReference} · {state.latest.createdAt}</p>:null}
    </Panel>

    <Panel title="Monte Carlo boundary" kicker="What this engine does — and does not do">
      <div className="space-y-1 text-xs leading-5 text-muted">
        <p>• Every iteration samples explicit task schedule O/M/P distributions and recalculates the network, so critical-path switching is represented.</p>
        <p>• Cost Monte Carlo runs only when every cost-required task has complete governed cost O/M/P inputs.</p>
        <p>• Task distributions are currently independent; cross-task correlation is not yet modeled.</p>
        <p>• This is <strong className="text-fg">not</strong> a physical material/FEA/fatigue/validation response model. Those probabilities remain withheld until governed engineering response functions and validated input distributions exist.</p>
      </div>
    </Panel>
  </div>;
}
