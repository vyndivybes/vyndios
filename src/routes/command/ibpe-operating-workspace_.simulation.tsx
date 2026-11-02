import { useState } from "react";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { getFourOrderSimulationPreview, runAcceptedFourOrderSimulation } from "@/lib/ibpe-simulation-authority";

export const Route = createFileRoute("/command/ibpe-operating-workspace_/simulation")({
 loader: () => getFourOrderSimulationPreview(),
 component: FourOrderSimulationPage,
});

function FourOrderSimulationPage() {
 const preview=Route.useLoaderData();
 const router=useRouter();
 const [consent,setConsent]=useState(false);
 const [running,setRunning]=useState(false);
 const [error,setError]=useState("");
 const [receipt,setReceipt]=useState<Awaited<ReturnType<typeof runAcceptedFourOrderSimulation>>|null>(null);
 async function run() {
  if(!consent||running)return;
  setRunning(true);setError("");setReceipt(null);
  try{
   const result=await runAcceptedFourOrderSimulation({data:{
    confirmation:"SIMULATION_ONLY",expectedSourceHash:preview.sourceHash,
   }});
   setReceipt(result);
  }catch(e){
   setError(e instanceof Error?e.message:"Simulation blocked by source authority.");
   await router.invalidate();
  }finally{setRunning(false)}
 }
 return <main className="space-y-6">
  <header className="space-y-2">
   <p className="text-xs font-semibold uppercase tracking-widest text-accent">VYNDI IBPE / Simulation authority</p>
   <h1 className="font-display text-3xl">Four-order simulation acceptance</h1>
   <p className="max-w-4xl text-sm text-muted">Sandbox mathematics only. The four confirmed demo orders below become accepted <strong>simulation inputs</strong>. This does not authorize real production, engineering change, procurement, finance, stock consumption or funding.</p>
   <Link className="text-sm text-accent underline" to="/command/ibpe-operating-workspace">Return to governed IBPE</Link>
  </header>
  <section className="rounded-xl border border-warn/50 p-4">
   <h2 className="font-semibold text-warn">Independent REAL production gates remain blocked</h2>
   <p className="mt-1 text-sm text-muted">Three released job cards have no recorded physical approval evidence. The R3 order has a held R2 card, consumed material, a serial traveller and a received PO. We create only a virtual R3 successor in memory; the original cards and booked ₹1,500 cost history are never rewritten.</p>
  </section>
  <section className="rounded-xl border border-border p-4 space-y-3">
   <h2 className="font-semibold">Frozen source preview</h2>
   <p className="break-all font-mono text-xs text-muted">Simulation version {preview.version} · source SHA-256 {preview.sourceHash}</p>
   <div className="overflow-auto">
    <table className="w-full text-left text-sm">
     <thead><tr className="border-b border-border text-muted"><th className="py-2">Order</th><th>Order</th><th>Source card</th><th>Simulation</th><th>Authority</th></tr></thead>
     <tbody>{preview.orders.map(o=><tr key={o.orderId} className="border-b border-border/30">
      <td className="py-2 font-mono text-xs">{o.orderId.slice(0,13)}…</td>
      <td>R{o.orderRevision} · {o.productId} · {o.units} unit(s)</td>
      <td>R{o.sourceCardRevision} · {o.sourceCardStatus}</td>
      <td>R{o.simulationCardRevision}{o.virtualSuccessor?" · virtual successor":""}</td>
      <td className="text-warn">Simulation only</td>
     </tr>)}</tbody>
    </table>
   </div>
   <label className="flex gap-3 text-sm">
    <input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)} />
    <span>I accept these four specific demo orders as <strong>SIMULATION ONLY</strong>. I acknowledge that no real job card or physical approval is changed and the cash and stock values are placeholders.</span>
   </label>
   <button type="button" disabled={!consent||running}
     className="rounded-lg border border-accent bg-accent/10 px-4 py-2 text-sm font-semibold text-accent disabled:opacity-40"
     onClick={()=>void run()}>{running?"Running isolated IBPE math…":"Accept and run simulation IBPE"}</button>
   {error?<p role="alert" className="text-sm text-warn">{error}</p>:null}
  </section>
  {receipt?<section className="rounded-xl border border-border p-4 space-y-3">
   <h2 className="font-semibold">Simulation result — NOT a production release</h2>
   <div className="grid gap-3 sm:grid-cols-4">
    <p className="text-sm">Accepted demo orders <strong className="block text-xl">{receipt.acceptedOrderCount}</strong></p>
    <p className="text-sm">Virtual R3 successors <strong className="block text-xl">{receipt.virtualSuccessorCount}</strong></p>
    <p className="text-sm">Scenario revision mismatch <strong className="block text-xl">{receipt.revisionMismatches}</strong></p>
    <p className="text-sm">Simulated procurement rows <strong className="block text-xl">{receipt.summary.fulfillmentShortageSkuMonths}</strong></p>
   </div>
   <p className="font-mono text-xs break-all text-muted">Input SHA-256: {receipt.inputHash}</p>
   <p className="text-sm text-muted">IBPE engine {receipt.engineVersion} executed against a memory-only zero-opening-stock, zero-cash scenario. HiGHS is not run by this page.</p>
   <ul className="list-disc pl-5 text-xs text-muted">{receipt.limitations.map(x=><li key={x}>{x}</li>)}</ul>
  </section>:null}
 </main>;
}
