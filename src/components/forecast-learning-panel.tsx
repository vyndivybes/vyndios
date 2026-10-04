import { useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { Kpi, Panel } from "@/components/kpi";
import {
  captureForecastLearningSnapshot,
  captureForecastVintage,
  closeLearningPeriod,
  type ForecastLearningState,
} from "@/lib/forecast-learning-authority";

const pct=(value:number|null)=>value==null?"WITHHELD":`${value.toLocaleString("en-IN",{maximumFractionDigits:2})}%`;

export function ForecastLearningPanel({
  state,
  allowActions=true,
}:{
  state:ForecastLearningState;
  allowActions?:boolean;
}){
  const router=useRouter();
  const [sourceReference,setSourceReference]=useState("FORECAST-REVIEW");
  const [planMonth,setPlanMonth]=useState(state.suggestedClosePlanMonth??1);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const learning=state.live;

  async function act(action:()=>Promise<unknown>,success:string){
    setBusy(true);setMessage("");
    try{
      await action();
      setMessage(success);
      await router.invalidate();
    }catch(error){
      setMessage(error instanceof Error?error.message:"Forecast learning action failed.");
    }finally{setBusy(false);}
  }

  return <Panel title="Forecast Learning Loop" kicker="Immutable vintage → governed close → variance → learning">
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
      <Kpi label="Closed periods" value={String(learning.closedPeriods)} hint={`Minimum ${state.minimumClosedPeriods} distinct periods`} tone={learning.available?"ok":"warn"}/>
      <Kpi label="WAPE" value={pct(learning.wapePct)} hint="Σ|Actual − Forecast| / ΣActual" tone={learning.available&&Number(learning.wapePct)>20?"warn":"ok"}/>
      <Kpi label="Bias" value={pct(learning.biasPct)} hint="Positive = over-forecast" tone={learning.available&&Math.abs(Number(learning.biasPct))>10?"warn":"ok"}/>
      <Kpi label="Plan attainment" value={pct(learning.planAttainmentPct)} hint="Actual / approved-plan baseline"/>
      <Kpi label="Forecast attainment" value={pct(learning.forecastAttainmentPct)} hint="Actual / governed forecast"/>
      <Kpi label="Forecast Value Added" value={learning.fvaPct==null?"WITHHELD":pct(learning.fvaPct)} hint={learning.fvaUnits>=0?`Improved by ${learning.fvaUnits} unit-error`:`Degraded by ${Math.abs(learning.fvaUnits)} unit-error`} tone={learning.available&&learning.fvaUnits<0?"warn":"ok"}/>
    </div>

    <div className={`mt-4 rounded-xl border p-4 ${learning.available?"border-green/30 bg-green/5":"border-warn/35 bg-warn/5"}`}>
      <p className="text-xs font-semibold uppercase tracking-wider">{learning.available?"Learning evidence active":"Learning WITHHELD"}</p>
      <p className="mt-2 text-xs leading-5 text-muted">{learning.reason}</p>
      <p className="mt-2 text-[10px] leading-4 text-subtle">No hindsight: only a vintage captured before a target calendar period starts can score that period. Close corrections create a new revision; prior close evidence remains immutable.</p>
    </div>

    {allowActions?<div className="mt-5 rounded-xl border border-border p-4">
      <div className="grid gap-3 md:grid-cols-[1fr_160px_auto]">
        <label className="text-xs text-muted">
          Evidence / review reference
          <input className="control mt-1.5 w-full" value={sourceReference} onChange={(e)=>setSourceReference(e.target.value)} placeholder="S&OP / IBPE review reference"/>
        </label>
        <label className="text-xs text-muted">
          Plan month to close
          <input className="control mt-1.5 w-full" type="number" min={1} max={36} value={planMonth} onChange={(e)=>setPlanMonth(Math.max(1,Math.min(36,Number(e.target.value)||1)))}/>
        </label>
        <div className="flex flex-wrap items-end gap-2">
          <button type="button" disabled={busy||sourceReference.trim().length<3} onClick={()=>void act(
            ()=>captureForecastVintage({data:{sourceReference:sourceReference.trim()}}),
            "Immutable forecast vintage captured."
          )} className="rounded border border-accent px-3 py-2 text-xs font-semibold text-accent disabled:opacity-40">Capture forecast vintage</button>
          <button type="button" disabled={busy||sourceReference.trim().length<3} onClick={()=>void act(
            ()=>closeLearningPeriod({data:{planMonth,sourceReference:sourceReference.trim()}}),
            `M${planMonth} learning period closed.`
          )} className="rounded border border-border px-3 py-2 text-xs font-semibold text-fg disabled:opacity-40">Close period</button>
          <button type="button" disabled={busy||sourceReference.trim().length<3} onClick={()=>void act(
            ()=>captureForecastLearningSnapshot({data:{sourceReference:sourceReference.trim()}}),
            "Forecast-learning snapshot captured."
          )} className="rounded bg-accent px-3 py-2 text-xs font-semibold text-bg disabled:opacity-40">Capture learning snapshot</button>
        </div>
      </div>
      {state.approvedPlan?<p className="mt-3 text-[10px] text-subtle">Approved plan {state.approvedPlan.id} · R{state.approvedPlan.revision} · horizon {state.approvedPlan.horizonStart}. Suggested close M{state.suggestedClosePlanMonth??"—"}.</p>:<p className="mt-3 text-xs text-warn">No single approved plan is available; vintage capture and close are blocked.</p>}
      {message?<p role="status" className="mt-3 text-xs text-muted">{message}</p>:null}
    </div>:null}

    <div className="mt-5 grid gap-4 xl:grid-cols-2">
      <div className="rounded-xl border border-border p-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-green">Recent vintages</p>
        <div className="mt-3 max-h-72 space-y-2 overflow-auto">
          {state.vintages.length?state.vintages.map((row)=><div key={row.id} className="rounded-lg bg-surface/45 p-3">
            <div className="flex justify-between gap-3"><strong className="text-xs text-fg">R{row.approvedPlanRevision} · {row.id.slice(0,18)}</strong><span className="text-[10px] text-subtle">{row.capturedAt.slice(0,19).replace("T"," ")}</span></div>
            <p className="mt-1 text-[10px] text-muted">Cutoff {row.cutoffAt.slice(0,19).replace("T"," ")} · {row.sourceReference}</p>
          </div>):<p className="text-xs text-muted">No immutable forecast vintage captured yet.</p>}
        </div>
      </div>
      <div className="rounded-xl border border-border p-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-green">Period-close evidence</p>
        <div className="mt-3 max-h-72 space-y-2 overflow-auto">
          {state.closes.length?state.closes.map((row)=><div key={row.id} className="rounded-lg bg-surface/45 p-3">
            <div className="flex justify-between gap-3"><strong className="text-xs text-fg">{row.periodStart.slice(0,10)} · M{row.planMonth} · R{row.revision}</strong><span className="text-[10px] text-subtle">{row.actualUnits} units</span></div>
            <p className="mt-1 text-[10px] text-muted">Revenue ₹{row.revenueLakh.toLocaleString("en-IN")}L · Procurement cash ₹{row.procurementCashLakh.toLocaleString("en-IN")}L · Cash {row.closingCashLakh==null?"not evidenced":`₹${row.closingCashLakh.toLocaleString("en-IN")}L ${row.cashVerified?"verified":"unverified"}`}</p>
          </div>):<p className="text-xs text-muted">No governed learning period close captured yet.</p>}
        </div>
      </div>
    </div>
  </Panel>;
}
