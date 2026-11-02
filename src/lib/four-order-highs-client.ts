import type { SimulationHighsRaw } from "./four-order-highs.ts";
/** A separate short-lived worker; no writes or governed optimizer calls. */
export function solveFourOrderSimulation(lp:string):Promise<SimulationHighsRaw> {
 const worker=new Worker(new URL("./four-order-highs-worker.ts",import.meta.url),{type:"module",name:"vyndi-simulation-only-highs"});
 return new Promise((resolve,reject)=>{
  const finish=()=>{clearTimeout(timer);worker.terminate();};
  const timer=setTimeout(()=>{worker.terminate();reject(Error("Simulation solver exceeded 30 seconds"));},30000);
  worker.onmessage=(e:MessageEvent<{ok:boolean;raw:SimulationHighsRaw;error?:string}>)=>{
   finish();if(e.data.ok)resolve(e.data.raw);else reject(Error(e.data.error||"Simulation solve failed"));
  };
  worker.onerror=e=>{finish();reject(Error(e.message||"Simulation worker failed"));};
  worker.postMessage({lp});
 });
}
