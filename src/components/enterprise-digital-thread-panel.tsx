import { useMemo, useState } from "react";
import { Kpi, Panel } from "@/components/kpi";
import { traceEnterpriseDigitalThread } from "@/lib/enterprise-digital-thread-authority";


export function EnterpriseDigitalThreadPanel(){
  const [query,setQuery]=useState("");
  const [result,setResult]=useState<any>(null);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");

  async function run(){
    if(!query.trim()) return;
    setBusy(true);setMessage("");
    try{
      const response=await traceEnterpriseDigitalThread({data:{query:query.trim()}});
      setResult(response);
      if(!response.matched) setMessage("No governed enterprise lineage matched that reference.");
    }catch(error){
      setMessage(error instanceof Error?error.message:"Unable to build enterprise digital thread.");
    }finally{setBusy(false);}
  }

  const affected=useMemo(()=>{
    if(!result?.impact?.affectedNodeIds?.length) return [];
    const ids=new Set<string>(result.impact.affectedNodeIds);
    return result.nodes.filter((node:any)=>ids.has(node.id));
  },[result]);

  return <Panel title="Enterprise Digital Thread" kicker="Supplier → material → production → quality → fulfilment → finance → risk">
    <div className="grid gap-3 md:grid-cols-[1fr_auto]">
      <label className="text-xs text-muted">
        Trace any governed reference
        <input
          className="control mt-1.5 w-full"
          value={query}
          onChange={(e)=>setQuery(e.target.value)}
          onKeyDown={(e)=>{if(e.key==="Enter") void run();}}
          placeholder="Serial, Traveller, Job Card, PO, GRN, supplier, shipment, invoice, equipment..."
        />
      </label>
      <button type="button" disabled={busy||!query.trim()} onClick={()=>void run()} className="self-end rounded bg-accent px-4 py-2.5 text-xs font-semibold text-bg disabled:opacity-40">
        Trace & assess impact
      </button>
    </div>

    {message?<div role="status" className="mt-3 rounded border border-border bg-surface px-3 py-2 text-xs text-muted">{message}</div>:null}

    {result?.matched?<div className="mt-5 space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-8">
        <Kpi label="Job Cards" value={String(result.summary.jobCards)} hint="Production roots"/>
        <Kpi label="Serials" value={String(result.summary.travellers)} hint="Traveller identities"/>
        <Kpi label="Suppliers" value={String(result.summary.suppliers)} hint="Canonical suppliers"/>
        <Kpi label="GRNs" value={String(result.summary.goodsReceipts)} hint="Goods receipts"/>
        <Kpi label="Quality release" value={String(result.summary.qualityReleases)} hint="Current releases"/>
        <Kpi label="Shipments" value={String(result.summary.shipments)} hint="Posted dispatch"/>
        <Kpi label="Risks" value={String(result.summary.risks)} hint="Linked open risks"/>
        <Kpi label="Impact" value={String(result.impact.affectedNodeIds.length)} hint="Downstream affected nodes"/>
      </div>

      <div className="rounded-xl border border-border p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-green">Authority boundary</p>
        <p className="mt-2 text-xs leading-5 text-muted">
          Serial → shipment identity is <strong className="text-fg">not inferred</strong>. {result.summary.serialShipmentExact
            ? "Every posted shipment in this matched lineage has exact active serialized allocation evidence."
            : "Any legacy or incompletely allocated shipment remains an explicit governed gap until exact serial allocation evidence exists."}
        </p>
      </div>

      {result.gaps?.length?<div className="rounded-xl border border-warn/40 p-4">
        <p className="text-xs font-semibold text-warn">Governed gaps</p>
        <ul className="mt-2 space-y-1 text-xs text-muted">{result.gaps.map((gap:any,index:number)=><li key={gap.code+index}>• {gap.message}</li>)}</ul>
      </div>:null}

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-xl border border-border p-4">
          <p className="text-sm font-semibold text-fg">Impact from matched reference</p>
          {affected.length?<div className="mt-3 max-h-80 space-y-2 overflow-auto">
            {affected.map((node:any)=><div key={node.id} className="rounded-lg bg-surface/45 p-3">
              <div className="flex items-start justify-between gap-3"><strong className="text-xs text-fg">{node.title}</strong><span className="text-[10px] uppercase text-subtle">{node.kind}</span></div>
              <p className="mt-1 break-all font-mono text-[10px] text-muted">{node.id}</p>
            </div>)}
          </div>:<p className="mt-3 text-xs text-muted">No downstream affected nodes are represented from this root.</p>}
        </div>

        <div className="rounded-xl border border-border p-4">
          <p className="text-sm font-semibold text-fg">Canonical thread nodes</p>
          <div className="mt-3 max-h-80 space-y-2 overflow-auto">
            {result.nodes.slice(0,120).map((node:any)=><div key={node.id} className="rounded-lg bg-surface/45 p-3">
              <div className="flex items-start justify-between gap-3"><strong className="text-xs text-fg">{node.title}</strong><span className="text-[10px] uppercase text-subtle">{node.kind}</span></div>
              <p className="mt-1 break-all font-mono text-[10px] text-muted">{node.id}</p>
            </div>)}
          </div>
        </div>
      </div>
    </div>:null}
  </Panel>;
}
