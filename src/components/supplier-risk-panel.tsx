import { useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { Kpi, Panel } from "@/components/kpi";
import { captureSupplierRiskIntelligence } from "@/lib/supplier-risk-authority";

type SupplierRiskState={
  live:{
    generatedAt:string;
    laneRisks:Array<{
      laneRevisionId:string;supplierId:string;sku:string;revisionCode:string;alternateRank:number;
      currency:string;landedUnitCostInr:number;moq:number;orderMultiple:number;reliabilityMethod:string;
      reliabilitySourceRef:string;policySourceRef:string;sourceRef:string;completedDeliveryEvents:number;
      receivedQuantity:number;rejectedQuantity:number;
      risk:{
        singleSource:boolean;approvedLaneCount:number;singleSourceProbability:null;
        governedLeadTimeDays:number|null;governedReliabilityPct:number|null;qualityRating:number|null;deliveryRating:number|null;
        deliveryForecast:{available:boolean;eventCount:number;adverseCount:number;observedLatePct:number|null;expectedLatePct:number|null;lower90Pct:number|null;upper90Pct:number|null;reason:string};
        actualLeadTime:{available:boolean;eventCount:number;meanDays:number|null;p80Days:number|null;meanDriftDays:number|null;reason:string};
        incomingQuality:{available:boolean;sampleSize:number;defectQuantity:number;expectedDefectPct:number|null;lower90Pct:number|null;upper90Pct:number|null;reason:string};
      };
    }>;
    summary:{
      activeApprovedLaneRevisions:number;coveredSkus:number;singleSourceSkuCount:number;singleSourceSkus:string[];
      deliveryForecastRatedLanes:number;incomingQualityRatedLanes:number;actualLeadTimeRatedLanes:number;
    };
    boundaries:string[];
  };
  latest:{id:string;sourceReference:string;actorRole:string;createdAt:string}|null;
};

const pct=(value:number|null)=>value==null?"WITHHELD":`${value.toFixed(1)}%`;
const days=(value:number|null)=>value==null?"WITHHELD":`${value.toFixed(1)} d`;

export function SupplierRiskPanel({state}:{state:SupplierRiskState}){
  const router=useRouter();
  const [sourceReference,setSourceReference]=useState("UI:SUPPLIER_RISK");
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");

  async function capture(){
    setBusy(true);
    setMessage("");
    try{
      const response=await captureSupplierRiskIntelligence({data:{sourceReference}});
      setMessage(`Supplier Risk snapshot ${response.id} captured.`);
      await router.invalidate();
    }catch(error){
      setMessage(error instanceof Error?error.message:"Supplier Risk capture failed.");
    }finally{setBusy(false);}
  }

  return <div className="space-y-4">
    <Panel title="Supplier Risk Intelligence" kicker="Approved supplier lanes · actual PO/GRN delivery · incoming quality">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Kpi label="Covered SKUs" value={String(state.live.summary.coveredSkus)} hint={`${state.live.summary.activeApprovedLaneRevisions} approved lane revision(s)`}/>
        <Kpi label="Single-source SKUs" value={String(state.live.summary.singleSourceSkuCount)} hint={state.live.summary.singleSourceSkus.slice(0,4).join(", ")||"No current single source"} tone={state.live.summary.singleSourceSkuCount?"warn":"ok"}/>
        <Kpi label="Delivery forecast rated" value={String(state.live.summary.deliveryForecastRatedLanes)} hint="≥5 completed PO/GRN events"/>
        <Kpi label="Lead-time drift rated" value={String(state.live.summary.actualLeadTimeRatedLanes)} hint="≥5 actual lead times"/>
        <Kpi label="Incoming quality rated" value={String(state.live.summary.incomingQualityRatedLanes)} hint="≥20 received units"/>
        <Kpi label="Snapshot" value={state.latest?state.latest.id.slice(0,12):"NOT CAPTURED"} hint={state.latest?.sourceReference||"Live evidence only"}/>
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="min-w-[280px] flex-1 text-xs text-muted">Evidence source / review reference<input className="control mt-1.5 w-full" value={sourceReference} onChange={(e)=>setSourceReference(e.target.value)}/></label>
        <button type="button" disabled={busy||!sourceReference.trim()} onClick={()=>void capture()} className="rounded border border-accent px-4 py-2 text-xs font-semibold text-accent disabled:opacity-40">Capture Supplier Risk snapshot</button>
      </div>
      {message?<div role="status" className="mt-3 rounded border border-border bg-surface px-3 py-2 text-xs text-muted">{message}</div>:null}
    </Panel>

    <Panel title="Supplier lane risk" kicker="Governed lane evidence and empirical performance remain separate">
      {state.live.laneRisks.length?<div className="overflow-x-auto"><table className="w-full min-w-[1640px] text-xs">
        <thead className="border-b border-border uppercase tracking-wider text-subtle"><tr>
          <th className="px-3 py-2 text-left">SKU / supplier</th>
          <th className="px-3 py-2 text-left">Source exposure</th>
          <th className="px-3 py-2 text-left">Governed lane</th>
          <th className="px-3 py-2 text-left">Empirical delivery</th>
          <th className="px-3 py-2 text-left">Actual lead time</th>
          <th className="px-3 py-2 text-left">Incoming quality</th>
          <th className="px-3 py-2 text-left">Evidence</th>
        </tr></thead>
        <tbody>{state.live.laneRisks.map((item)=><tr key={item.laneRevisionId} className="border-t border-border/70 align-top">
          <td className="px-3 py-3"><p className="font-semibold text-fg">{item.sku}</p><p className="text-muted">{item.supplierId} · alt rank {item.alternateRank}</p><p className="font-mono text-[10px] text-subtle">{item.laneRevisionId}</p></td>
          <td className="px-3 py-3">{item.risk.singleSource?<><p className="font-semibold text-warn">SINGLE SOURCE</p><p className="mt-1 text-[10px] text-muted">Configuration fact · probability not inferred</p></>:<><p className="font-semibold text-green">{item.risk.approvedLaneCount} approved sources</p><p className="mt-1 text-[10px] text-muted">Current SKU coverage</p></>}</td>
          <td className="px-3 py-3"><p>Lead time {item.risk.governedLeadTimeDays??"—"} d</p><p>Reliability {pct(item.risk.governedReliabilityPct)}</p><p>Quality / Delivery rating {item.risk.qualityRating??"—"} / {item.risk.deliveryRating??"—"}</p><p className="text-[10px] text-subtle">{item.currency} · MOQ {item.moq} · multiple {item.orderMultiple}</p></td>
          <td className="px-3 py-3">{item.risk.deliveryForecast.available?<><p className="font-semibold text-accent">Late probability {pct(item.risk.deliveryForecast.expectedLatePct)}</p><p className="text-muted">90% {pct(item.risk.deliveryForecast.lower90Pct)}–{pct(item.risk.deliveryForecast.upper90Pct)}</p><p className="text-[10px] text-subtle">{item.risk.deliveryForecast.eventCount} completed events</p></>:<p className="text-warn">WITHHELD<br/><span className="text-[10px] text-muted">{item.risk.deliveryForecast.reason}</span></p>}</td>
          <td className="px-3 py-3">{item.risk.actualLeadTime.available?<><p>Mean {days(item.risk.actualLeadTime.meanDays)}</p><p>P80 {days(item.risk.actualLeadTime.p80Days)}</p><p className={`font-semibold ${Number(item.risk.actualLeadTime.meanDriftDays)>0?"text-warn":"text-green"}`}>Drift {item.risk.actualLeadTime.meanDriftDays==null?"—":`${item.risk.actualLeadTime.meanDriftDays>=0?"+":""}${item.risk.actualLeadTime.meanDriftDays} d`}</p></>:<p className="text-warn">WITHHELD<br/><span className="text-[10px] text-muted">{item.risk.actualLeadTime.reason}</span></p>}</td>
          <td className="px-3 py-3">{item.risk.incomingQuality.available?<><p className="font-semibold">Reject probability {pct(item.risk.incomingQuality.expectedDefectPct)}</p><p className="text-muted">90% {pct(item.risk.incomingQuality.lower90Pct)}–{pct(item.risk.incomingQuality.upper90Pct)}</p><p className="text-[10px] text-subtle">{item.receivedQuantity} received · {item.rejectedQuantity} rejected</p></>:<p className="text-warn">WITHHELD<br/><span className="text-[10px] text-muted">{item.risk.incomingQuality.reason}</span></p>}</td>
          <td className="max-w-sm px-3 py-3 text-[10px] text-muted"><p>{item.sourceRef}</p><p>{item.reliabilitySourceRef||"Reliability source not recorded"}</p><p>{item.policySourceRef||"Policy source not recorded"}</p></td>
        </tr>)}</tbody>
      </table></div>:<p className="text-sm text-muted">No currently effective approved supplier lanes exist. Supplier Risk remains unassessed rather than inferred.</p>}
    </Panel>

    <Panel title="Supplier Risk boundaries" kicker="Evidence-class separation">
      {state.live.boundaries.map((item)=><p key={item} className="text-xs leading-5 text-muted">• {item}</p>)}
      {state.latest?<p className="mt-3 text-[10px] text-subtle">Latest captured snapshot: {state.latest.id} · {state.latest.sourceReference} · {state.latest.createdAt}</p>:null}
    </Panel>
  </div>;
}
