import assert from "node:assert/strict";
import test from "node:test";
import loadHighs from "highs";
import { FOUR_ORDER_DEMO_IDS, acceptFourOrderSimulation } from "../src/lib/ibpe-simulation-acceptance.ts";

const rows=FOUR_ORDER_DEMO_IDS.map((id,i)=>({
 id,revision:i===2?3:2,status:"confirmed",product_id:i===0?"carbon":i===1?"premiumCarbon":"aluminium",
 units:1,plan_month:1,card_id:"CARD-"+i,card_revision:2,card_status:i===2?"hold":"released",
 bom_revision:"BOM",approved_by:null,approved_at:null,
}));
const bom=["core","pro","apex"].map(model_id=>({model_id,bom_revision:"BOM-"+model_id,sku:"PART",quantity:2,bom_line_key:"1"}));
const capacity=[{work_centre_id:"ASSEMBLY",available_hours_per_month:1,efficiency:1,standard_hours_per_unit:1,planning_status:"approved",source_ref:"TEST"}];

test("four-order HiGHS commissioning: actual MILP, independent feasibility and adversarial rejection",async()=>{
 const api=await import("../src/lib/four-order-highs.ts");
 const acceptance=acceptFourOrderSimulation(rows);
 const model=api.compileFourOrderHighs(acceptance,bom,capacity);
 const highs=await loadHighs();
 const options={output_flag:false,log_to_console:false,threads:1,parallel:"off",random_seed:0,mip_rel_gap:0,time_limit:10};
 const raw=highs.solve(model.lp,options);
 assert.equal(raw.Status,"Optimal");
 const verified=api.verifyFourOrderHighs(model,raw);
 assert.equal(verified.valid,true,JSON.stringify(verified.issues));
 assert.equal(verified.schedule.length,4);
 assert.deepEqual(verified.schedule.map(x=>x.month).sort((a,b)=>a-b),[1,2,3,4]);
 assert.equal(verified.procurement.reduce((sum,x)=>sum+x.quantity,0),8);
 // Exhaust all 24 possible schedules independently of the LP generator.
 const permute=a=>a.length?a.flatMap((x,i)=>permute(a.filter((_,j)=>i!==j)).map(p=>[x,...p])):[[]];
 const optimum=Math.min(...permute([1,2,3,4]).map(p=>p.reduce((sum,m,i)=>sum+(m-1)*(1000+i),0)));
 assert.equal(verified.objective,optimum);
 assert.deepEqual(highs.solve(model.lp,options).Columns,raw.Columns);
 assert.equal(api.compileFourOrderHighs(acceptance,[...bom].reverse(),[...capacity].reverse()).lp,model.lp);
 const clone=()=>structuredClone(raw);
 let bad=clone(); delete bad.Columns[Object.keys(bad.Columns)[0]];
 assert.equal(api.verifyFourOrderHighs(model,bad).valid,false);
 bad=clone();bad.Columns.rogue={Primal:0};assert.equal(api.verifyFourOrderHighs(model,bad).valid,false);
 bad=clone();bad.ObjectiveValue+=1;assert.equal(api.verifyFourOrderHighs(model,bad).valid,false);
 bad=clone();bad.Status="Time limit reached";assert.equal(api.verifyFourOrderHighs(model,bad).valid,false);
 const x=Object.keys(raw.Columns).find(k=>k.startsWith("x_")&&raw.Columns[k].Primal>0.5);
 bad=clone();bad.Columns[x].Primal=0.5;assert.equal(api.verifyFourOrderHighs(model,bad).valid,false);
 bad=clone();bad.Columns[x].Primal=NaN;assert.equal(api.verifyFourOrderHighs(model,bad).valid,false);
 const p=Object.keys(raw.Columns).find(k=>k.startsWith("p_")&&raw.Columns[k].Primal>0);
 bad=clone();bad.Columns[p].Primal=0;assert.equal(api.verifyFourOrderHighs(model,bad).valid,false);
 const zero=api.compileFourOrderHighs(acceptance,bom,[{...capacity[0],available_hours_per_month:0}]);
 const infeasible=highs.solve(zero.lp,options);
 assert.equal(infeasible.Status,"Infeasible");
 assert.equal(api.verifyFourOrderHighs(zero,infeasible).valid,false);
 assert.throws(()=>api.compileFourOrderHighs({...acceptance,orders:acceptance.orders.slice(0,3)},bom,capacity),/four|scope/i);
 assert.throws(()=>api.compileFourOrderHighs(acceptance,bom,[{...capacity[0],efficiency:NaN}]),/capacity|efficiency/i);
 assert.throws(()=>api.compileFourOrderHighs(acceptance,bom,[{...capacity[0],efficiency:2}]),/efficiency/i);
 assert.throws(()=>api.compileFourOrderHighs(acceptance,[...bom,bom[0]],capacity),/duplicate/i);
 assert.throws(()=>api.compileFourOrderHighs(acceptance,bom,[...capacity,capacity[0]]),/duplicate/i);
 const before=JSON.stringify({acceptance,bom,capacity});
 api.compileFourOrderHighs(acceptance,bom,capacity);
 assert.equal(JSON.stringify({acceptance,bom,capacity}),before);
});

test("simulation authority remains authenticated, consented, fresh and write-free",async()=>{
 const {readFile}=await import("node:fs/promises");
 const authority=await readFile(new URL("../src/lib/ibpe-simulation-authority.ts",import.meta.url),"utf8");
 for(const name of ["prepareFourOrderHighs","validateFourOrderHighs"]){
  const block=authority.slice(authority.indexOf("export const "+name));
  assert.match(block,/middleware\(\[authMiddleware\]\)/);
  assert.match(block,/requireBusinessActor\("view"/);
 }
 assert.match(authority,/confirmation:z.literal\("SIMULATION_ONLY"\)/);
 assert.match(authority,/current.modelHash!==data.modelHash/);
 assert.match(authority,/verifyFourOrderHighs\(current.model,data.raw\)/);
 assert.doesNotMatch(authority,/\b(?:insert into|delete from|update\s+vyndi_|approve_vyndi_production_batch)\b/i);
 const page=await readFile(new URL("../src/routes/command/ibpe-operating-workspace_.simulation.tsx",import.meta.url),"utf8");
 assert.match(page,/!consent\|\|!solverConsent\|\|running/);
 assert.match(page,/setConsent\(false\)/);
 assert.match(page,/REAL readiness remains HOLD/);
});

test("historic optimizer acceptance cannot be mistaken for current REAL readiness",async()=>{
 const {readFile}=await import("node:fs/promises");
 const page=await readFile(new URL("../src/routes/command/ibpe-operating-workspace_.optimizer.tsx",import.meta.url),"utf8");
 assert.match(page,/Historical receipt only/);
 assert.match(page,/Accepted when recorded/);
 assert.doesNotMatch(page,/>Accepted for execution<\/p>/);
});

test("simulation requires mounted client readiness before consent is interactive",async()=>{
 const {readFile}=await import("node:fs/promises");
 const page=await readFile(new URL("../src/routes/command/ibpe-operating-workspace_.simulation.tsx",import.meta.url),"utf8");
 assert.match(page,/useEffect\(\(\)=>\{setHydrated\(true\)\},\[\]\)/);
 assert.match(page,/data-simulation-interactive=\{hydrated\?"ready":"loading"\}/);
 assert.match(page,/type="checkbox" disabled=\{!hydrated\|\|running\} checked=\{consent\}/);
 const browser=await readFile(new URL("../scripts/four-order-simulation-browser-acceptance.mjs",import.meta.url),"utf8");
 assert.match(browser,/data-simulation-interactive="ready"/);
});

test("every governed status bar exposes the separate simulation entry",async()=>{
 const {readFile}=await import("node:fs/promises");
 const projection=await readFile(new URL("../src/components/ibpe-workspace-projection.tsx",import.meta.url),"utf8");
 assert.match(projection,/<Link[^>]*to="\/command\/ibpe-operating-workspace\/simulation"[^>]*aria-label="Run four-order simulation IBPE"/);
 assert.match(projection,/REAL baseline only/);
 assert.match(projection,/Simulation does not require a physical production release/);
});
