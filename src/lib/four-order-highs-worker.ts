import loadHighs from "highs";
import type { SimulationHighsRaw } from "./four-order-highs.ts";

self.onmessage = (event:MessageEvent<{lp:string}>) => {
 void (async()=>{
  try {
   if(event.data.lp.length>500000)throw Error("Simulation model exceeds budget");
   const wasmUrl=new URL("../generated/highs.wasm",import.meta.url).href;
   const options={locateFile:(path:string)=>path.endsWith(".wasm")?wasmUrl:path} as unknown as Parameters<typeof loadHighs>[0];
   const highs=await loadHighs(options);
   const result=highs.solve(event.data.lp,{output_flag:false,log_to_console:false,parallel:"off",threads:1,random_seed:0,time_limit:10,mip_rel_gap:0});
   const raw:SimulationHighsRaw={Status:String(result.Status),ObjectiveValue:result.ObjectiveValue,
    Columns:Object.fromEntries(Object.entries(result.Columns||{}).map(([id,row])=>[id,{Primal:Number(row.Primal)}]))};
   self.postMessage({ok:true,raw});
  } catch(e) { self.postMessage({ok:false,error:e instanceof Error?e.message:"Simulation HiGHS failed"}); }
 })();
};
