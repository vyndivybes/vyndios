import { useEffect, useState } from "react";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { getFourOrderSimulationPreview, runAcceptedFourOrderSimulation, prepareFourOrderHighs, validateFourOrderHighs } from "@/lib/ibpe-simulation-authority";

import { solveFourOrderSimulation } from "@/lib/four-order-highs-client";

export const Route = createFileRoute("/command/ibpe-operating-workspace_/simulation")({
 loader: () => getFourOrderSimulationPreview(),
 component: FourOrderSimulationPage,
});

function FourOrderSimulationPage() {
 const preview=Route.useLoaderData();
 const router=useRouter();
 const [hydrated,setHydrated]=useState(false);
 useEffect(()=>{setHydrated(true)},[]);
 const [consent,setConsent]=useState(false);
 const [solverConsent,setSolverConsent]=useState(false);
 const [highs,setHighs]=useState<Awaited<ReturnType<typeof validateFourOrderHighs>>|null>(null);
 const [phase,setPhase]=useState("");
 const [running,setRunning]=useState(false);
 const [error,setError]=useState("");
 const [receipt,setReceipt]=useState<Awaited<ReturnType<typeof runAcceptedFourOrderSimulation>>|null>(null);
 async function run() {
  if(!consent||running)return;
  setRunning(true);setError("");setReceipt(null);setHighs(null);setSolverConsent(false);
  try{
   const result=await runAcceptedFourOrderSimulation({data:{
    confirmation:"SIMULATION_ONLY",expectedSourceHash:preview.sourceHash,
   }});
   setReceipt(result);
  }catch(e){
   setConsent(false);
   setError(e instanceof Error?e.message:"Simulation blocked by source authority.");
   await router.invalidate();
  }finally{setRunning(false)}
 }
 async function optimize(){
  if(!consent||!solverConsent||running)return;
  setRunning(true);setError("");setHighs(null);
  try {
   setPhase("Preparing fresh simulation inputs…");
   const prepared=await prepareFourOrderHighs({data:{confirmation:"SIMULATION_ONLY",expectedSourceHash:preview.sourceHash}});
   setPhase("Solving simulation MILP with HiGHS…");
   const raw=await solveFourOrderSimulation(prepared.model.lp);
   setPhase("Independently validating on the server…");
   const validated=await validateFourOrderHighs({data:{confirmation:"SIMULATION_ONLY",expectedSourceHash:preview.sourceHash,modelHash:prepared.modelHash,
    raw:{Status:raw.Status,ObjectiveValue:raw.ObjectiveValue!,Columns:raw.Columns!}}});
   setHighs(validated);setReceipt(validated.ibpe);
  }catch(e){
   setError(e instanceof Error?e.message:"Simulation optimizer blocked");
   setConsent(false);setSolverConsent(false);
   await router.invalidate();
  }finally{setRunning(false);setPhase("");}
 }
 return <main data-simulation-interactive={hydrated?"ready":"loading"} className="space-y-6">
  <header className="space-y-2">
   <p className="text-xs font-semibold uppercase tracking-widest text-accent">VYNDI IBPE / Simulation authority</p>
   <h1 className="font-display text-3xl">Four-order simulation: IBPE + HiGHS</h1>
   <p className="max-w-4xl text-sm text-muted">Sandbox mathematics only. The four confirmed demo orders below become accepted <strong>simulation inputs</strong>. This does not authorize real production, engineering change, procurement, finance, stock consumption or funding.</p>
   <Link className="text-sm text-accent underline" to="/command/ibpe-operating-workspace">Return to governed IBPE</Link>
  </header>
  <section className="rounded-xl border border-warn/50 p-4">
   <h2 className="font-semibold text-warn">REAL readiness: NOT RELEASED · design confirmation required</h2>
   <p className="mt-1 text-sm text-muted">Design confirmation is pending; there are no approved real job cards. Three legacy/demo card rows carry a stored released label without physical approval provenance. The R3 demo order retains its held R2 history. Only a virtual R3 successor is created in memory; original card, stock, PO and cost histories are preserved.</p>
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
    <input type="checkbox" disabled={!hydrated||running} checked={consent} onChange={e=>setConsent(e.target.checked)} />
    <span>I accept these four specific demo orders as <strong>SIMULATION ONLY</strong>. I acknowledge that no real job card or physical approval is changed and the cash and stock values are placeholders.</span>
   </label>
   <button type="button" disabled={!hydrated||!consent||running}
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
   <p className="text-sm text-muted">IBPE engine {receipt.engineVersion} executed against a memory-only zero-opening-stock, zero-cash scenario. Run the separately consented simulation HiGHS step below to validate a schedule and virtual material plan.</p>
   <div className="space-y-3 border-t border-border pt-4">
    <h3 className="font-semibold">SIMULATION readiness: IBPE complete · {highs?"HiGHS primal validated":"HiGHS awaiting consent"}</h3>
    <p className="text-sm text-muted">Schedule whole orders in months 1–36, without early production. Every work centre uses its approved planning standard for every bicycle. Virtual unlimited zero-lead supply covers the scheduled BOM demand. Minimize weighted lateness. No supplier, finance or physical release authority.</p>
    <label className="flex gap-3 text-sm"><input type="checkbox" checked={solverConsent} disabled={running} onChange={e=>{setSolverConsent(e.target.checked);setHighs(null)}}/>
     <span>I consent to a memory-only <strong>SIMULATION HiGHS</strong> run and server feasibility verification. No stock, PO, finance or production record will be written. The solver uses this browser's isolated Web Worker; no PC installation or local service is needed.</span>
    </label>
    <button type="button" disabled={!consent||!solverConsent||running} onClick={()=>void optimize()}
     className="rounded-lg border border-accent px-4 py-3 text-sm font-semibold text-accent disabled:opacity-40">{running?phase||"Running simulation…":"Run simulation-only HiGHS"}</button>
    <p role="status" className="text-sm text-muted">{phase}</p>
   </div>
   <ul className="list-disc pl-5 text-xs text-muted">{receipt.limitations.map(x=><li key={x}>{x}</li>)}</ul>
  </section>:null}
  {highs?<section aria-label="Validated simulation optimizer receipt" className="rounded-xl border border-accent/50 p-4 space-y-3">
   <h2 className="font-semibold text-accent">SIMULATION PASS: HiGHS {highs.solverReportedStatus} · independent primal validation passed</h2>
   <p className="text-sm">Objective {highs.objective} weighted unit-month lateness · {highs.variableCount} validated variables · {highs.procurement.length} virtual material rows</p>
   <div className="overflow-auto"><table className="w-full text-left text-sm"><thead><tr><th>Demo order</th><th>Simulated month</th><th>Units</th></tr></thead>
    <tbody>{highs.schedule.map(o=><tr key={o.orderId}><td className="py-2 font-mono text-xs">{o.orderId}</td><td>{o.month}</td><td>{o.units}</td></tr>)}</tbody>
   </table></div>
   <details><summary className="cursor-pointer text-sm">Virtual material plan</summary><div className="overflow-auto"><table className="w-full text-left text-sm">
    <thead><tr><th>SKU</th><th>Month</th><th>Virtual quantity</th></tr></thead><tbody>{highs.procurement.map(p=><tr key={p.sku+":"+p.month}><td>{p.sku}</td><td>{p.month}</td><td>{p.quantity}</td></tr>)}</tbody>
   </table></div></details>
   <div className="space-y-1 break-all font-mono text-xs text-muted">
    <p>Simulation optimizer {highs.version}</p><p>Deployed source SHA: {highs.sourceSha}</p>
    <p>Order source SHA-256: {highs.sourceHash}</p><p>IBPE input SHA-256: {highs.inputHash}</p>
    <p>Model SHA-256: {highs.modelHash}</p><p>Validated result SHA-256: {highs.resultHash}</p>
   </div>
   <p className="text-sm text-warn">Memory-only receipt. REAL readiness remains HOLD for design confirmation; production is NOT RELEASED. No persisted optimizer packet or manufacturing authority is created.</p>
   <ul className="list-disc pl-5 text-xs text-muted">{highs.assumptions.map(a=><li key={a}>{a}</li>)}</ul>
  </section>:null}
 </main>;
}
