import { useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { Kpi, Panel } from "@/components/kpi";
import {
  captureSupplierPerformanceSnapshot,
  recordSupplierResponseEvent,
  type SupplierPerformanceState,
} from "@/lib/supplier-performance-authority";

const pct=(value:number|null)=>value==null?"WITHHELD":`${value.toFixed(1)}%`;
const hours=(value:number|null)=>value==null?"WITHHELD":`${value.toFixed(1)} h`;
const ppm=(value:number|null)=>value==null?"WITHHELD":Math.round(value).toLocaleString("en-IN");
const iso=(value:string)=>value?new Date(value).toISOString():"";

export function SupplierPerformancePanel({state}:{state:SupplierPerformanceState}){
  const router=useRouter();
  const [busy,setBusy]=useState("");
  const [message,setMessage]=useState("");
  const [snapshotRef,setSnapshotRef]=useState("UI:SUPPLIER_PERFORMANCE");
  const [event,setEvent]=useState({
    supplierId:"",
    requestReference:"",
    requestType:"RFQ / technical query",
    requestedAt:"",
    respondedAt:"",
    sourceReference:"UI:SUPPLIER_RESPONSE",
  });

  async function run(key:string,action:()=>Promise<unknown>,success:string){
    setBusy(key);setMessage("");
    try{
      await action();
      setMessage(success);
      await router.invalidate();
    }catch(error){
      setMessage(error instanceof Error?error.message:"Supplier performance action failed.");
    }finally{setBusy("");}
  }

  const summary=state.live.summary;

  return <div className="space-y-4">
    <Panel title="Supplier Performance & Quality Scorecard" kicker="OTIF · PPM · NCR/CAPA · cost variance · traceability · responsiveness">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-7">
        <Kpi label="Suppliers" value={String(summary.supplierCount)} hint="Active canonical suppliers"/>
        <Kpi label="OTIF evidenced" value={String(summary.suppliersWithOtifEvidence)} hint="Completed PO/GRN history"/>
        <Kpi label="Quality evidenced" value={String(summary.suppliersWithQualityEvidence)} hint="Received / accepted / rejected"/>
        <Kpi label="Traceability evidenced" value={String(summary.suppliersWithTraceabilityEvidence)} hint="GRN identity coverage"/>
        <Kpi label="Response evidenced" value={String(summary.suppliersWithResponseEvidence)} hint="Governed request/response events"/>
        <Kpi label="Open NCR/CAPA" value={`${summary.openNcrCount}/${summary.openCapaCount}`} hint="Supplier-linked incoming quality" tone={summary.openNcrCount||summary.openCapaCount?"warn":"ok"}/>
        <Kpi label="Overdue CAPA" value={String(summary.overdueCapaCount)} hint="Supplier-linked corrective action" tone={summary.overdueCapaCount?"warn":"ok"}/>
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="min-w-[280px] flex-1 text-xs text-muted">Scorecard review / evidence reference
          <input className="control mt-1.5 w-full" value={snapshotRef} onChange={(e)=>setSnapshotRef(e.target.value)}/>
        </label>
        <button type="button" disabled={busy==="snapshot"||!snapshotRef.trim()} onClick={()=>void run(
          "snapshot",
          ()=>captureSupplierPerformanceSnapshot({data:{sourceReference:snapshotRef.trim()}}),
          "Supplier performance snapshot captured."
        )} className="rounded border border-accent px-4 py-2 text-xs font-semibold text-accent disabled:opacity-40">Capture scorecard snapshot</button>
      </div>
      <p className="mt-3 text-[10px] leading-4 text-subtle">No composite weighted supplier score is created. Each dimension keeps its own denominator and evidence boundary. Supplier Risk Intelligence remains the probabilistic/lane-risk layer.</p>
      {state.latest?<p className="mt-2 text-[10px] text-subtle">Latest immutable snapshot: {state.latest.id} · {state.latest.sourceReference} · {state.latest.createdAt}</p>:null}
      {message?<div role="status" className="mt-3 rounded border border-border bg-surface px-3 py-2 text-xs text-muted">{message}</div>:null}
    </Panel>

    <Panel title="Supplier scorecard" kicker="Observed operating performance · not a hidden ranking algorithm">
      {state.live.suppliers.length?<div className="overflow-x-auto"><table className="w-full min-w-[1780px] text-xs">
        <thead className="border-b border-border uppercase tracking-wider text-subtle"><tr>
          <th className="px-3 py-2 text-left">Supplier</th>
          <th className="px-3 py-2 text-left">OTIF</th>
          <th className="px-3 py-2 text-left">Incoming quality</th>
          <th className="px-3 py-2 text-left">NCR / CAPA</th>
          <th className="px-3 py-2 text-left">Cost variance</th>
          <th className="px-3 py-2 text-left">Traceability</th>
          <th className="px-3 py-2 text-left">Responsiveness</th>
          <th className="px-3 py-2 text-left">Evidence</th>
          <th className="px-3 py-2 text-left">Attention</th>
        </tr></thead>
        <tbody>{state.live.suppliers.map((row)=><tr key={row.supplierId} className="border-t border-border/70 align-top">
          <td className="px-3 py-3"><p className="font-semibold text-fg">{row.supplierName}</p><p className="font-mono text-[10px] text-subtle">{row.supplierId}</p></td>
          <td className="px-3 py-3"><p className="font-semibold">{pct(row.otifPct)}</p><p className="text-[10px] text-muted">On time {pct(row.onTimePct)} · In full {pct(row.inFullPct)}</p><p className="text-[10px] text-subtle">{row.completedOrderCount} completed PO(s)</p></td>
          <td className="px-3 py-3"><p className="font-semibold">{ppm(row.rejectPpm)} PPM</p><p className="text-[10px] text-muted">Yield {pct(row.acceptanceYieldPct)}</p><p className="text-[10px] text-subtle">{row.receivedQty} received · {row.rejectedQty} rejected</p></td>
          <td className="px-3 py-3"><p>{row.openNcrCount} open NCR · {row.openCapaCount} open CAPA</p><p className={row.overdueCapaCount?"text-warn":"text-muted"}>{row.overdueCapaCount} overdue CAPA</p><p className="text-[10px] text-subtle">Effectiveness evidence {pct(row.capaEffectivenessEvidencePct)}</p></td>
          <td className="px-3 py-3"><p className={row.costVariancePct!=null&&row.costVariancePct>0?"font-semibold text-warn":"font-semibold"}>{pct(row.costVariancePct)}</p><p className="text-[10px] text-muted">Invoice ex-GST vs PO price basis</p></td>
          <td className="px-3 py-3"><p className="font-semibold">{pct(row.traceabilityCompletenessPct)}</p><p className="text-[10px] text-muted">{row.traceableReceiptCount}/{row.receiptCount} receipt(s) core-complete</p></td>
          <td className="px-3 py-3"><p className="font-semibold">{hours(row.meanResponseHours)}</p><p className="text-[10px] text-muted">Median {hours(row.medianResponseHours)}</p><p className="text-[10px] text-subtle">{row.responseEventCount} response event(s)</p></td>
          <td className="px-3 py-3"><p className="font-semibold">{pct(row.evidenceCoveragePct)}</p><p className="text-[10px] text-muted">6 explicit dimensions</p></td>
          <td className="max-w-sm px-3 py-3">{row.attention.length?<ul className="space-y-1 text-warn">{row.attention.map((item)=><li key={item}>• {item}</li>)}</ul>:<p className="text-green">No evidenced exception in represented dimensions.</p>}</td>
        </tr>)}</tbody>
      </table></div>:<p className="text-sm text-muted">No active suppliers exist.</p>}
    </Panel>

    <Panel title="Responsiveness evidence" kicker="Explicit supplier request → response timestamps · append-only correction history">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <label className="text-xs text-muted">Supplier
          <select className="control mt-1.5 w-full" value={event.supplierId} onChange={(e)=>setEvent({...event,supplierId:e.target.value})}>
            <option value="">Select supplier</option>
            {state.suppliers.map((supplier)=><option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
          </select>
        </label>
        <label className="text-xs text-muted">Request reference<input className="control mt-1.5 w-full" value={event.requestReference} onChange={(e)=>setEvent({...event,requestReference:e.target.value})}/></label>
        <label className="text-xs text-muted">Request type<input className="control mt-1.5 w-full" value={event.requestType} onChange={(e)=>setEvent({...event,requestType:e.target.value})}/></label>
        <label className="text-xs text-muted">Source reference<input className="control mt-1.5 w-full" value={event.sourceReference} onChange={(e)=>setEvent({...event,sourceReference:e.target.value})}/></label>
        <label className="text-xs text-muted">Requested at<input type="datetime-local" className="control mt-1.5 w-full" value={event.requestedAt} onChange={(e)=>setEvent({...event,requestedAt:e.target.value})}/></label>
        <label className="text-xs text-muted">Responded at<input type="datetime-local" className="control mt-1.5 w-full" value={event.respondedAt} onChange={(e)=>setEvent({...event,respondedAt:e.target.value})}/></label>
        <button type="button" disabled={busy==="response"||!event.supplierId||!event.requestReference.trim()||!event.requestedAt||!event.respondedAt||!event.sourceReference.trim()} onClick={()=>void run(
          "response",
          ()=>recordSupplierResponseEvent({data:{
            supplierId:event.supplierId,
            requestReference:event.requestReference.trim(),
            requestType:event.requestType.trim(),
            requestedAt:iso(event.requestedAt),
            respondedAt:iso(event.respondedAt),
            supersedesEventId:null,
            sourceReference:event.sourceReference.trim(),
          }}),
          "Supplier response evidence recorded."
        )} className="self-end rounded bg-accent px-4 py-2.5 text-xs font-semibold text-bg disabled:opacity-40">Record response event</button>
      </div>
    </Panel>
  </div>;
}
