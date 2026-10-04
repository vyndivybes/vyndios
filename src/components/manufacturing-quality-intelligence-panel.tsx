import { useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { Kpi, Panel } from "@/components/kpi";
import {
  captureManufacturingQualityIntelligence,
  recordQualityMeasurement,
} from "@/lib/manufacturing-quality-authority";

type QualityIntelligence={
  live:{
    generatedAt:string;
    stageForecasts:Array<{
      stage:string;inspectionRecords:number;sampleSize:number;defectQuantity:number;
      forecast:{
        available:boolean;method:string;observedDefectPct:number|null;expectedDefectPct:number|null;
        lower90Pct:number|null;upper90Pct:number|null;expectedYieldPct:number|null;reason:string;
      };
    }>;
    capabilities:Array<{
      characteristicCode:string;characteristicName:string;unit:string;specConflict:boolean;
      capability:{
        available:boolean;sampleSize:number;mean:number|null;stdDev:number|null;cp:number|null;cpk:number|null;
        lowerSpecLimit:number|null;upperSpecLimit:number|null;reason:string;
      };
      latestSourceReference:string;
    }>;
    qualityControl:{
      ncrTotal:number;ncrOpen:number;ncrOpenCritical:number;ncrOpenMajor:number;
      capaTotal:number;capaOpen:number;capaVerified:number;releasedSerials:number;blockedSerials:number;
    };
    manufacturingActuals:{
      completedJobs:number;completedQuantity:number;scrapInr:number;reworkInr:number;
      totalActualCostInr:number;scrapReworkCostPct:number|null;
    };
    boundaries:string[];
  };
  latest:{
    id:string;sourceReference:string;actorRole:string;createdAt:string;
  }|null;
};

const pct=(value:number|null)=>value==null?"WITHHELD":`${value.toFixed(1)}%`;
const inr=(value:number)=>`₹${value.toLocaleString("en-IN",{maximumFractionDigits:0})}`;
const optional=(value:string)=>{
  if(!value.trim()) return null;
  const n=Number(value);
  return Number.isFinite(n)?n:null;
};

export function ManufacturingQualityIntelligencePanel({state}:{state:QualityIntelligence}){
  const router=useRouter();
  const [showMeasurement,setShowMeasurement]=useState(false);
  const [busy,setBusy]=useState("");
  const [message,setMessage]=useState("");
  const [sourceReference,setSourceReference]=useState("UI:QUALITY_INTELLIGENCE");
  const [form,setForm]=useState({
    inspectionId:"",travellerId:"",jobCardId:"",
    characteristicCode:"",characteristicName:"",unit:"mm",measuredValue:"",
    nominalValue:"",lowerSpecLimit:"",upperSpecLimit:"",
    measurementMethod:"Controlled dimensional inspection",equipmentRef:"",
  });

  async function saveMeasurement(){
    setBusy("measurement");
    setMessage("");
    try{
      const id="MEAS-"+crypto.randomUUID();
      await recordQualityMeasurement({data:{
        id,
        inspectionId:form.inspectionId.trim()||null,
        travellerId:form.travellerId.trim()||null,
        jobCardId:form.jobCardId.trim()||null,
        characteristicCode:form.characteristicCode.trim(),
        characteristicName:form.characteristicName.trim(),
        unit:form.unit.trim(),
        measuredValue:Number(form.measuredValue),
        nominalValue:optional(form.nominalValue),
        lowerSpecLimit:optional(form.lowerSpecLimit),
        upperSpecLimit:optional(form.upperSpecLimit),
        measurementMethod:form.measurementMethod.trim(),
        equipmentRef:form.equipmentRef.trim()||null,
        sourceReference,
      }});
      setMessage(`Measurement ${id} recorded as canonical Quality evidence.`);
      setShowMeasurement(false);
      await router.invalidate();
    }catch(error){
      setMessage(error instanceof Error?error.message:"Measurement recording failed.");
    }finally{setBusy("");}
  }

  async function capture(){
    setBusy("capture");
    setMessage("");
    try{
      const response=await captureManufacturingQualityIntelligence({data:{sourceReference}});
      setMessage(`Quality Intelligence snapshot ${response.id} captured.`);
      await router.invalidate();
    }catch(error){
      setMessage(error instanceof Error?error.message:"Quality Intelligence capture failed.");
    }finally{setBusy("");}
  }

  const finalForecast=state.live.stageForecasts.find((item)=>item.stage==="final")?.forecast;
  const capable=state.live.capabilities.filter((item)=>item.capability.available&&Number(item.capability.cpk)>=1.33).length;
  const rated=state.live.capabilities.filter((item)=>item.capability.available).length;

  return <div className="space-y-4">
    <Panel title="Manufacturing & Quality Intelligence" kicker="Canonical inspection evidence · empirical prediction · SPC capability">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Kpi label="Final defect probability" value={pct(finalForecast?.expectedDefectPct??null)} hint={finalForecast?.available?"Posterior predictive":"Insufficient inspection sample"} tone={finalForecast?.available&&Number(finalForecast.expectedDefectPct)>5?"warn":"default"}/>
        <Kpi label="Final yield estimate" value={pct(finalForecast?.expectedYieldPct??null)} hint="Inspection evidence only"/>
        <Kpi label="Capability rated" value={`${rated}/${state.live.capabilities.length}`} hint={`${capable} with Cpk ≥1.33`}/>
        <Kpi label="Open NCR" value={String(state.live.qualityControl.ncrOpen)} hint={`${state.live.qualityControl.ncrOpenCritical} critical · ${state.live.qualityControl.ncrOpenMajor} major`} tone={state.live.qualityControl.ncrOpen?"warn":"ok"}/>
        <Kpi label="Open CAPA" value={String(state.live.qualityControl.capaOpen)} hint={`${state.live.qualityControl.capaVerified} verified`} tone={state.live.qualityControl.capaOpen?"warn":"ok"}/>
        <Kpi label="Scrap + rework actual" value={state.live.manufacturingActuals.scrapReworkCostPct==null?"UNRATED":pct(state.live.manufacturingActuals.scrapReworkCostPct)} hint={`${inr(state.live.manufacturingActuals.scrapInr+state.live.manufacturingActuals.reworkInr)} observed cost`}/>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={()=>setShowMeasurement((value)=>!value)} className="rounded border border-border px-3 py-2 text-xs font-semibold hover:border-accent">{showMeasurement?"Close measurement form":"Record measurement"}</button>
        <button type="button" disabled={busy==="capture"||!sourceReference.trim()} onClick={()=>void capture()} className="rounded border border-accent px-3 py-2 text-xs font-semibold text-accent disabled:opacity-40">Capture intelligence snapshot</button>
      </div>
      <label className="mt-3 block max-w-3xl text-xs text-muted">Evidence source / study reference<input className="control mt-1.5 w-full" value={sourceReference} onChange={(e)=>setSourceReference(e.target.value)}/></label>
      {message?<div role="status" className="mt-3 rounded border border-border bg-surface px-3 py-2 text-xs text-muted">{message}</div>:null}

      {showMeasurement?<div className="mt-4 rounded-xl border border-border bg-surface/30 p-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label className="text-xs text-muted">Characteristic code<input className="control mt-1.5 w-full" value={form.characteristicCode} onChange={(e)=>setForm({...form,characteristicCode:e.target.value})} placeholder="BB-SHELL-WIDTH"/></label>
          <label className="text-xs text-muted">Characteristic name<input className="control mt-1.5 w-full" value={form.characteristicName} onChange={(e)=>setForm({...form,characteristicName:e.target.value})}/></label>
          <label className="text-xs text-muted">Measured value<input inputMode="decimal" className="control mt-1.5 w-full" value={form.measuredValue} onChange={(e)=>setForm({...form,measuredValue:e.target.value})}/></label>
          <label className="text-xs text-muted">Unit<input className="control mt-1.5 w-full" value={form.unit} onChange={(e)=>setForm({...form,unit:e.target.value})}/></label>
          <label className="text-xs text-muted">Nominal<input inputMode="decimal" className="control mt-1.5 w-full" value={form.nominalValue} onChange={(e)=>setForm({...form,nominalValue:e.target.value})}/></label>
          <label className="text-xs text-muted">LSL<input inputMode="decimal" className="control mt-1.5 w-full" value={form.lowerSpecLimit} onChange={(e)=>setForm({...form,lowerSpecLimit:e.target.value})}/></label>
          <label className="text-xs text-muted">USL<input inputMode="decimal" className="control mt-1.5 w-full" value={form.upperSpecLimit} onChange={(e)=>setForm({...form,upperSpecLimit:e.target.value})}/></label>
          <label className="text-xs text-muted">Equipment ref<input className="control mt-1.5 w-full" value={form.equipmentRef} onChange={(e)=>setForm({...form,equipmentRef:e.target.value})}/></label>
          <label className="text-xs text-muted">Inspection ID<input className="control mt-1.5 w-full" value={form.inspectionId} onChange={(e)=>setForm({...form,inspectionId:e.target.value})}/></label>
          <label className="text-xs text-muted">Traveller ID<input className="control mt-1.5 w-full" value={form.travellerId} onChange={(e)=>setForm({...form,travellerId:e.target.value})}/></label>
          <label className="text-xs text-muted">Job Card ID<input className="control mt-1.5 w-full" value={form.jobCardId} onChange={(e)=>setForm({...form,jobCardId:e.target.value})}/></label>
          <label className="text-xs text-muted xl:col-span-2">Measurement method<input className="control mt-1.5 w-full" value={form.measurementMethod} onChange={(e)=>setForm({...form,measurementMethod:e.target.value})}/></label>
        </div>
        <button type="button" disabled={busy==="measurement"||!form.characteristicCode.trim()||!form.characteristicName.trim()||!form.unit.trim()||!form.measuredValue.trim()||!sourceReference.trim()} onClick={()=>void saveMeasurement()} className="mt-4 rounded bg-accent px-3 py-2 text-xs font-semibold text-bg disabled:opacity-40">Record governed measurement</button>
      </div>:null}
    </Panel>

    <div className="grid gap-4 xl:grid-cols-2">
      <Panel title="Inspection defect / yield forecast" kicker="Beta-binomial · uniform prior · minimum sample 20">
        {state.live.stageForecasts.length?<div className="space-y-2">{state.live.stageForecasts.map((item)=><div key={item.stage} className="rounded border border-border p-3"><div className="flex flex-wrap justify-between gap-2"><p className="text-sm font-semibold capitalize">{item.stage.replaceAll("_"," ")}</p><span className="text-xs text-muted">{item.sampleSize} inspected · {item.defectQuantity} defects</span></div>{item.forecast.available?<div className="mt-2 grid grid-cols-3 gap-2 text-xs"><div><p className="text-subtle">Expected defect</p><p className="font-semibold text-accent">{pct(item.forecast.expectedDefectPct)}</p></div><div><p className="text-subtle">90% interval</p><p className="font-semibold">{pct(item.forecast.lower90Pct)}–{pct(item.forecast.upper90Pct)}</p></div><div><p className="text-subtle">Yield estimate</p><p className="font-semibold text-green">{pct(item.forecast.expectedYieldPct)}</p></div></div>:<p className="mt-2 text-xs text-warn">WITHHELD — {item.forecast.reason}</p>}</div>)}</div>:<p className="text-sm text-muted">No canonical inspection samples exist yet.</p>}
      </Panel>

      <Panel title="Process Capability" kicker="Actual measurements · n ≥30 · consistent LSL/USL">
        {state.live.capabilities.length?<div className="space-y-2">{state.live.capabilities.map((item)=><div key={item.characteristicCode} className="rounded border border-border p-3"><div className="flex flex-wrap justify-between gap-2"><div><p className="text-sm font-semibold">{item.characteristicCode} · {item.characteristicName}</p><p className="text-[10px] text-subtle">{item.capability.sampleSize} measurement(s) · {item.unit}</p></div>{item.capability.available?<span className={`text-xs font-semibold ${Number(item.capability.cpk)>=1.33?"text-green":"text-warn"}`}>Cp {item.capability.cp} · Cpk {item.capability.cpk}</span>:<span className="text-xs font-semibold text-warn">WITHHELD</span>}</div>{item.capability.available?<p className="mt-2 text-xs text-muted">Mean {item.capability.mean} · s {item.capability.stdDev} · LSL {item.capability.lowerSpecLimit} · USL {item.capability.upperSpecLimit}</p>:<p className="mt-2 text-xs text-muted">{item.capability.reason}</p>}</div>)}</div>:<p className="text-sm text-muted">No governed measurement characteristics recorded yet.</p>}
      </Panel>
    </div>

    <Panel title="Manufacturing actuals" kicker="Observed evidence · not a future scrap-rate forecast">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Kpi label="Completed jobs" value={String(state.live.manufacturingActuals.completedJobs)} hint="Actual cost snapshots"/>
        <Kpi label="Completed quantity" value={String(state.live.manufacturingActuals.completedQuantity)} hint="Recorded finished units"/>
        <Kpi label="Scrap actual" value={inr(state.live.manufacturingActuals.scrapInr)} hint="Posted job cost"/>
        <Kpi label="Rework actual" value={inr(state.live.manufacturingActuals.reworkInr)} hint="Posted job cost"/>
        <Kpi label="Released / blocked" value={`${state.live.qualityControl.releasedSerials} / ${state.live.qualityControl.blockedSerials}`} hint="Current serialized Quality decisions"/>
      </div>
    </Panel>

    <Panel title="Evidence boundaries" kicker="Quality prediction guardrails">
      {state.live.boundaries.map((item)=><p key={item} className="text-xs leading-5 text-muted">• {item}</p>)}
      {state.latest?<p className="mt-3 text-[10px] text-subtle">Latest captured snapshot: {state.latest.id} · {state.latest.sourceReference} · {state.latest.createdAt}</p>:null}
    </Panel>
  </div>;
}
