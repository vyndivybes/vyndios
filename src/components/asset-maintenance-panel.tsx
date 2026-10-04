import { useMemo, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { Kpi, Panel } from "@/components/kpi";
import {
  cancelMaintenanceWorkOrder,
  completeMaintenanceWorkOrder,
  createMaintenancePlan,
  createMaintenanceWorkOrder,
  registerEquipmentAsset,
  startMaintenanceWorkOrder,
} from "@/lib/asset-maintenance-authority";

type Row=Record<string,unknown>;
type State={
  assets:Row[];
  plans:Row[];
  workOrders:Row[];
  parts:Row[];
  intelligence:{
    totalAssets:number;
    unavailableAssetCount:number;
    releaseBlockedAssetCount:number;
    openWorkOrderCount:number;
    correctiveFailureCount:number;
    observedOperatingHours:number;
    downtimeHours:number;
    mtbfHours:number|null;
    mttrHours:number|null;
    observedAvailabilityPct:number|null;
    oeePct:number|null;
    oeeReason:string;
    overdueMaintenanceAssetIds:string[];
    overdueCalibrationAssetIds:string[];
    releaseBlockedAssetIds:string[];
  };
};

const txt=(row:Row,key:string)=>row[key]==null?"":String(row[key]);
const fmt=(value:number|null,suffix="")=>value==null?"WITHHELD":value.toFixed(1)+suffix;
const iso=(value:string)=>value?new Date(value).toISOString():null;

export function AssetMaintenancePanel({state}:{state:State}){
  const router=useRouter();
  const [message,setMessage]=useState("");
  const [busy,setBusy]=useState("");
  const [asset,setAsset]=useState({
    assetTag:"",equipmentType:"",description:"",manufacturer:"",modelNumber:"",serialNumber:"",
    location:"",criticality:"medium",ownerRef:"",calibrationRequired:false,calibrationDueAt:"",sourceReference:"UI:ASSET",
  });
  const [plan,setPlan]=useState({
    equipmentId:"",title:"",strategy:"preventive",intervalDays:"",nextDueAt:"",instructions:"",sourceReference:"UI:MAINTENANCE_PLAN",
  });
  const [work,setWork]=useState({
    equipmentId:"",planId:"",type:"preventive",priority:"normal",title:"",description:"",
    failureCode:"",failureMode:"",scheduledFor:"",sourceReference:"UI:MAINTENANCE_WO",
  });
  const [completion,setCompletion]=useState<Record<string,Record<string,string>>>({});

  const activeAssets=useMemo(()=>state.assets.filter((row)=>txt(row,"status")!=="retired"),[state.assets]);
  const planForAsset=state.plans.filter((row)=>!work.equipmentId||txt(row,"equipment_id")===work.equipmentId);

  async function run(key:string,action:()=>Promise<unknown>,success:string){
    setBusy(key);setMessage("");
    try{await action();setMessage(success);await router.invalidate();}
    catch(error){setMessage(error instanceof Error?error.message:"Asset maintenance action failed.");}
    finally{setBusy("");}
  }

  async function addAsset(){
    await run("asset",()=>registerEquipmentAsset({data:{
      assetTag:asset.assetTag,
      equipmentType:asset.equipmentType,
      description:asset.description,
      manufacturer:asset.manufacturer||null,
      modelNumber:asset.modelNumber||null,
      serialNumber:asset.serialNumber||null,
      location:asset.location||null,
      criticality:asset.criticality as "low"|"medium"|"high"|"critical",
      ownerRef:asset.ownerRef||null,
      commissionedAt:null,
      calibrationRequired:asset.calibrationRequired,
      calibrationDueAt:asset.calibrationRequired&&asset.calibrationDueAt?iso(asset.calibrationDueAt):null,
      sourceReference:asset.sourceReference,
    }}),"Asset registered.");
  }

  async function addPlan(){
    await run("plan",()=>createMaintenancePlan({data:{
      equipmentId:plan.equipmentId,
      title:plan.title,
      strategy:plan.strategy as "preventive"|"inspection"|"calibration"|"condition_based",
      intervalDays:plan.intervalDays?Number(plan.intervalDays):null,
      nextDueAt:plan.nextDueAt?iso(plan.nextDueAt):null,
      instructions:plan.instructions,
      sourceReference:plan.sourceReference,
    }}),"Maintenance plan created.");
  }

  async function addWork(){
    await run("work",()=>createMaintenanceWorkOrder({data:{
      equipmentId:work.equipmentId,
      planId:work.planId||null,
      type:work.type as "preventive"|"corrective"|"inspection"|"calibration",
      priority:work.priority as "low"|"normal"|"high"|"critical",
      title:work.title,
      description:work.description,
      failureCode:work.failureCode||null,
      failureMode:work.failureMode||null,
      scheduledFor:work.scheduledFor?iso(work.scheduledFor):null,
      sourceReference:work.sourceReference,
    }}),"Maintenance work order created.");
  }

  function patchCompletion(id:string,key:string,value:string){
    setCompletion((current)=>({...current,[id]:{...(current[id]??{}),[key]:value}}));
  }

  async function finish(row:Row){
    const id=txt(row,"id");
    const draft=completion[id]??{};
    const hasPart=Boolean(draft.partSku?.trim());
    await run("complete:"+id,()=>completeMaintenanceWorkOrder({data:{
      workOrderId:id,
      rootCause:draft.rootCause?.trim()||null,
      actionTaken:draft.actionTaken?.trim()||"",
      labourHours:draft.labourHours?.trim()?Number(draft.labourHours):null,
      externalCostInr:draft.externalCostInr?.trim()?Number(draft.externalCostInr):0,
      evidenceReference:draft.evidenceReference?.trim()||"",
      returnToServiceReference:draft.returnToServiceReference?.trim()||"",
      parts:hasPart?[{
        sku:draft.partSku!.trim(),
        quantity:Number(draft.partQty||1),
        unitCostInr:Number(draft.partUnitCost||0),
        sourceReference:draft.partSource?.trim()||draft.evidenceReference?.trim()||"MAINTENANCE:PART",
      }]:[],
      sourceReference:draft.sourceReference?.trim()||"UI:MAINTENANCE_COMPLETE",
    }}),"Maintenance work completed and return-to-service gate evaluated.");
  }

  const metric=state.intelligence;

  return <div className="space-y-4">
    <Panel title="Asset & Maintenance Intelligence" kicker="Canonical EPR equipment · preventive/corrective control · evidence before return to service">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-8">
        <Kpi label="Assets" value={String(metric.totalAssets)} hint="Active equipment"/>
        <Kpi label="Release blocked" value={String(metric.releaseBlockedAssetCount)} hint="Status / due-date blockers" tone={metric.releaseBlockedAssetCount?"warn":"ok"}/>
        <Kpi label="Open work" value={String(metric.openWorkOrderCount)} hint="Draft / scheduled / active"/>
        <Kpi label="Failures" value={String(metric.correctiveFailureCount)} hint="Completed corrective events"/>
        <Kpi label="MTBF" value={fmt(metric.mtbfHours," h")} hint="Captured EPR hours / failures"/>
        <Kpi label="MTTR" value={fmt(metric.mttrHours," h")} hint="Mean corrective repair time"/>
        <Kpi label="Availability" value={fmt(metric.observedAvailabilityPct,"%")} hint="Observed MTBF/(MTBF+MTTR)"/>
        <Kpi label="OEE" value="WITHHELD" hint="Performance + quality loss evidence required"/>
      </div>
      <p className="mt-3 text-xs leading-5 text-muted">{metric.oeeReason}</p>
      {metric.releaseBlockedAssetIds.length?<p className="mt-2 text-xs text-warn">Blocked assets: {metric.releaseBlockedAssetIds.join(" · ")}</p>:null}
      <p className="mt-2 text-[10px] text-subtle">Observed operating hours {metric.observedOperatingHours.toFixed(1)} h · captured downtime {metric.downtimeHours.toFixed(1)} h. No infinite reliability or unsupported OEE values are manufactured from missing evidence.</p>
      {message?<div role="status" className="mt-3 rounded border border-border bg-surface px-3 py-2 text-xs text-muted">{message}</div>:null}
    </Panel>

    <Panel title="Register equipment asset" kicker="Extends epr_equipment · no parallel asset master">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <label className="text-xs text-muted">Asset tag<input className="control mt-1.5 w-full" value={asset.assetTag} onChange={(e)=>setAsset({...asset,assetTag:e.target.value})}/></label>
        <label className="text-xs text-muted">Equipment type<input className="control mt-1.5 w-full" value={asset.equipmentType} onChange={(e)=>setAsset({...asset,equipmentType:e.target.value})}/></label>
        <label className="text-xs text-muted">Manufacturer<input className="control mt-1.5 w-full" value={asset.manufacturer} onChange={(e)=>setAsset({...asset,manufacturer:e.target.value})}/></label>
        <label className="text-xs text-muted">Model<input className="control mt-1.5 w-full" value={asset.modelNumber} onChange={(e)=>setAsset({...asset,modelNumber:e.target.value})}/></label>
        <label className="text-xs text-muted">Serial<input className="control mt-1.5 w-full" value={asset.serialNumber} onChange={(e)=>setAsset({...asset,serialNumber:e.target.value})}/></label>
        <label className="text-xs text-muted">Location<input className="control mt-1.5 w-full" value={asset.location} onChange={(e)=>setAsset({...asset,location:e.target.value})}/></label>
        <label className="text-xs text-muted">Criticality<select className="control mt-1.5 w-full" value={asset.criticality} onChange={(e)=>setAsset({...asset,criticality:e.target.value})}><option>low</option><option>medium</option><option>high</option><option>critical</option></select></label>
        <label className="text-xs text-muted">Owner / custodian<input className="control mt-1.5 w-full" value={asset.ownerRef} onChange={(e)=>setAsset({...asset,ownerRef:e.target.value})}/></label>
        <label className="text-xs text-muted md:col-span-2">Description<input className="control mt-1.5 w-full" value={asset.description} onChange={(e)=>setAsset({...asset,description:e.target.value})}/></label>
        <label className="flex items-center gap-2 self-end text-xs text-muted"><input type="checkbox" checked={asset.calibrationRequired} onChange={(e)=>setAsset({...asset,calibrationRequired:e.target.checked})}/>Calibration required</label>
        <label className="text-xs text-muted">Calibration due<input type="datetime-local" disabled={!asset.calibrationRequired} className="control mt-1.5 w-full disabled:opacity-40" value={asset.calibrationDueAt} onChange={(e)=>setAsset({...asset,calibrationDueAt:e.target.value})}/></label>
        <label className="text-xs text-muted md:col-span-2">Source reference<input className="control mt-1.5 w-full" value={asset.sourceReference} onChange={(e)=>setAsset({...asset,sourceReference:e.target.value})}/></label>
        <button type="button" disabled={busy==="asset"||!asset.assetTag.trim()||!asset.equipmentType.trim()} onClick={()=>void addAsset()} className="self-end rounded bg-accent px-4 py-2.5 text-xs font-semibold text-bg disabled:opacity-40">Register asset</button>
      </div>
    </Panel>

    <Panel title="Asset register" kicker="Status · due controls · execution eligibility">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {state.assets.map((row)=><article key={txt(row,"id")} className="rounded-xl border border-border p-4">
          <div className="flex items-start justify-between gap-3"><div><p className="font-semibold text-fg">{txt(row,"asset_tag")}</p><p className="text-[10px] text-subtle">{txt(row,"id")}</p></div><span className="rounded-full border border-border px-2 py-1 text-[10px] uppercase">{txt(row,"status")}</span></div>
          <p className="mt-2 text-xs text-muted">{txt(row,"equipment_type")} · {txt(row,"criticality")||"medium"} criticality</p>
          <p className="mt-2 text-xs text-muted">{txt(row,"manufacturer")} {txt(row,"model_number")} {txt(row,"serial_number")}</p>
          <div className="mt-3 grid grid-cols-2 gap-2 text-[10px] text-subtle">
            <span>Maintenance due<br/><strong className="text-fg">{txt(row,"maintenance_due_at")||"—"}</strong></span>
            <span>Calibration due<br/><strong className="text-fg">{txt(row,"calibration_due_at")||"—"}</strong></span>
          </div>
        </article>)}
      </div>
    </Panel>

    <Panel title="Maintenance plans" kicker="Preventive · inspection · calibration · condition-based">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <label className="text-xs text-muted">Equipment<select className="control mt-1.5 w-full" value={plan.equipmentId} onChange={(e)=>setPlan({...plan,equipmentId:e.target.value})}><option value="">Select</option>{activeAssets.map((row)=><option key={txt(row,"id")} value={txt(row,"id")}>{txt(row,"asset_tag")}</option>)}</select></label>
        <label className="text-xs text-muted">Plan title<input className="control mt-1.5 w-full" value={plan.title} onChange={(e)=>setPlan({...plan,title:e.target.value})}/></label>
        <label className="text-xs text-muted">Strategy<select className="control mt-1.5 w-full" value={plan.strategy} onChange={(e)=>setPlan({...plan,strategy:e.target.value})}><option>preventive</option><option>inspection</option><option>calibration</option><option>condition_based</option></select></label>
        <label className="text-xs text-muted">Interval days<input inputMode="numeric" className="control mt-1.5 w-full" value={plan.intervalDays} onChange={(e)=>setPlan({...plan,intervalDays:e.target.value})}/></label>
        <label className="text-xs text-muted">Next due<input type="datetime-local" className="control mt-1.5 w-full" value={plan.nextDueAt} onChange={(e)=>setPlan({...plan,nextDueAt:e.target.value})}/></label>
        <label className="text-xs text-muted md:col-span-2">Instructions<input className="control mt-1.5 w-full" value={plan.instructions} onChange={(e)=>setPlan({...plan,instructions:e.target.value})}/></label>
        <button type="button" disabled={busy==="plan"||!plan.equipmentId||!plan.title.trim()} onClick={()=>void addPlan()} className="self-end rounded bg-accent px-4 py-2.5 text-xs font-semibold text-bg disabled:opacity-40">Create plan</button>
      </div>
      <div className="mt-4 grid gap-2 md:grid-cols-2">
        {state.plans.map((row)=><div key={txt(row,"id")} className="rounded-lg border border-border p-3 text-xs"><strong>{txt(row,"title")}</strong><p className="mt-1 text-muted">{txt(row,"strategy")} · due {txt(row,"next_due_at")||"condition trigger"} · asset {txt(row,"equipment_id")}</p></div>)}
      </div>
    </Panel>

    <Panel title="Maintenance work orders" kicker="Fault → repair → evidence → return to service">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <label className="text-xs text-muted">Equipment<select className="control mt-1.5 w-full" value={work.equipmentId} onChange={(e)=>setWork({...work,equipmentId:e.target.value,planId:""})}><option value="">Select</option>{activeAssets.map((row)=><option key={txt(row,"id")} value={txt(row,"id")}>{txt(row,"asset_tag")}</option>)}</select></label>
        <label className="text-xs text-muted">Plan<select className="control mt-1.5 w-full" value={work.planId} onChange={(e)=>setWork({...work,planId:e.target.value})}><option value="">Ad hoc</option>{planForAsset.map((row)=><option key={txt(row,"id")} value={txt(row,"id")}>{txt(row,"title")}</option>)}</select></label>
        <label className="text-xs text-muted">Type<select className="control mt-1.5 w-full" value={work.type} onChange={(e)=>setWork({...work,type:e.target.value})}><option>preventive</option><option>corrective</option><option>inspection</option><option>calibration</option></select></label>
        <label className="text-xs text-muted">Priority<select className="control mt-1.5 w-full" value={work.priority} onChange={(e)=>setWork({...work,priority:e.target.value})}><option>low</option><option>normal</option><option>high</option><option>critical</option></select></label>
        <label className="text-xs text-muted md:col-span-2">Title<input className="control mt-1.5 w-full" value={work.title} onChange={(e)=>setWork({...work,title:e.target.value})}/></label>
        <label className="text-xs text-muted">Failure code<input className="control mt-1.5 w-full" value={work.failureCode} onChange={(e)=>setWork({...work,failureCode:e.target.value})}/></label>
        <label className="text-xs text-muted">Failure mode<input className="control mt-1.5 w-full" value={work.failureMode} onChange={(e)=>setWork({...work,failureMode:e.target.value})}/></label>
        <label className="text-xs text-muted md:col-span-3">Description<input className="control mt-1.5 w-full" value={work.description} onChange={(e)=>setWork({...work,description:e.target.value})}/></label>
        <button type="button" disabled={busy==="work"||!work.equipmentId||!work.title.trim()} onClick={()=>void addWork()} className="self-end rounded bg-accent px-4 py-2.5 text-xs font-semibold text-bg disabled:opacity-40">Create work order</button>
      </div>

      <div className="mt-5 space-y-3">
        {state.workOrders.map((row)=>{
          const id=txt(row,"id"),status=txt(row,"status"),draft=completion[id]??{};
          return <article key={id} className="rounded-xl border border-border p-4">
            <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-semibold">{txt(row,"title")}</p><p className="text-[10px] text-subtle">{id} · {txt(row,"work_order_type")} · asset {txt(row,"equipment_id")}</p></div><span className="rounded-full border border-border px-2 py-1 text-[10px] uppercase">{status}</span></div>
            {status==="scheduled"||status==="draft"?<div className="mt-3 flex flex-wrap gap-2">
              <button type="button" disabled={busy==="start:"+id} onClick={()=>void run("start:"+id,()=>startMaintenanceWorkOrder({data:{workOrderId:id,sourceReference:"UI:MAINTENANCE_START"}}),"Maintenance work started; asset removed from service.")} className="rounded border border-accent px-3 py-2 text-xs font-semibold text-accent">Start maintenance</button>
              <button type="button" disabled={busy==="cancel:"+id} onClick={()=>void run("cancel:"+id,()=>cancelMaintenanceWorkOrder({data:{workOrderId:id,reason:"Operator-cancelled before execution",sourceReference:"UI:MAINTENANCE_CANCEL"}}),"Maintenance work order cancelled; equipment release gate re-evaluated.")} className="rounded border border-border px-3 py-2 text-xs font-semibold text-muted hover:border-accent">Cancel</button>
            </div>:null}
            {status==="in_progress"?<div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <label className="text-xs text-muted">Root cause<input className="control mt-1.5 w-full" value={draft.rootCause??""} onChange={(e)=>patchCompletion(id,"rootCause",e.target.value)}/></label>
              <label className="text-xs text-muted md:col-span-2">Action taken<input className="control mt-1.5 w-full" value={draft.actionTaken??""} onChange={(e)=>patchCompletion(id,"actionTaken",e.target.value)}/></label>
              <label className="text-xs text-muted">Labour hours<input inputMode="decimal" className="control mt-1.5 w-full" value={draft.labourHours??""} onChange={(e)=>patchCompletion(id,"labourHours",e.target.value)}/></label>
              <label className="text-xs text-muted">Evidence reference<input className="control mt-1.5 w-full" value={draft.evidenceReference??""} onChange={(e)=>patchCompletion(id,"evidenceReference",e.target.value)}/></label>
              <label className="text-xs text-muted">Return to service reference<input className="control mt-1.5 w-full" value={draft.returnToServiceReference??""} onChange={(e)=>patchCompletion(id,"returnToServiceReference",e.target.value)}/></label>
              <label className="text-xs text-muted">External cost ₹<input inputMode="decimal" className="control mt-1.5 w-full" value={draft.externalCostInr??""} onChange={(e)=>patchCompletion(id,"externalCostInr",e.target.value)}/></label>
              <label className="text-xs text-muted">Part SKU<input className="control mt-1.5 w-full" value={draft.partSku??""} onChange={(e)=>patchCompletion(id,"partSku",e.target.value)}/></label>
              <label className="text-xs text-muted">Part qty<input inputMode="decimal" className="control mt-1.5 w-full" value={draft.partQty??""} onChange={(e)=>patchCompletion(id,"partQty",e.target.value)}/></label>
              <label className="text-xs text-muted">Part unit cost ₹<input inputMode="decimal" className="control mt-1.5 w-full" value={draft.partUnitCost??""} onChange={(e)=>patchCompletion(id,"partUnitCost",e.target.value)}/></label>
              <button type="button" disabled={busy==="complete:"+id||!draft.actionTaken?.trim()||!draft.evidenceReference?.trim()||!draft.returnToServiceReference?.trim()} onClick={()=>void finish(row)} className="self-end rounded bg-accent px-4 py-2.5 text-xs font-semibold text-bg disabled:opacity-40">Complete & evaluate Return to service</button>
            </div>:null}
          </article>;
        })}
      </div>
    </Panel>
  </div>;
}
