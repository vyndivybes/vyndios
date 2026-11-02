/**
 * SIMULATION ONLY. Whole-order monthly scheduling and virtual just-in-time
 * material supply. No real stock, supplier, cash, routing release or persistence.
 */
import { FOUR_ORDER_DEMO_IDS } from "./ibpe-simulation-acceptance.ts";
export const FOUR_ORDER_HIGHS_VERSION = "VYNDI-SIM-HIGHS-1.0.0";
type Acceptance = {
 mode: string; productionAuthorized: boolean; sourceHash: string;
 orders: {orderId:string;productId:string;units:number;month:number;simulationCardRevision:number;orderRevision:number;physicalApproval:boolean}[];
};
type Bom = {model_id:string;bom_revision:string;sku:string;quantity:number|string;bom_line_key:string};
type Capacity = {work_centre_id:string;available_hours_per_month:number|string;efficiency:number|string;standard_hours_per_unit:number|string;planning_status:string;source_ref:string};
export type FourOrderHighsModel = {
 version:string; sourceHash:string; horizon:number; lp:string;
 orders:{id:string;units:number;due:number;requirements:{sku:string;quantity:number}[]}[];
 resources:{id:string;hours:number;hoursPerUnit:number;sourceRef:string}[];
 skus:string[];
};
export type SimulationHighsRaw = {Status:string;ObjectiveValue?:number;Columns?:Record<string,{Primal:number}>};
const scope=FOUR_ORDER_DEMO_IDS;
const tiers:Record<string,string>={aluminium:"core",carbon:"pro",premiumCarbon:"apex"};
function number(value:unknown,label:string,min=0) {
 const n=Number(value);
 if(value===null||value===""||!Number.isFinite(n)||n<min||n>1e6)throw Error("Invalid "+label);
 return n;
}
const x=(i:number,m:number)=>"x_"+i+"_"+m;
const p=(i:number,m:number)=>"p_"+i+"_"+m;
const terms=(rows:[number,string][])=>rows.map(([n,id],i)=>(i?" + ":"")+n+" "+id).join("")||"0";
export function compileFourOrderHighs(a:Acceptance,bom:Bom[],capacity:Capacity[]):FourOrderHighsModel {
 const sorted=[...a.orders].sort((a,b)=>a.orderId.localeCompare(b.orderId));
 if(a.mode!=="SIMULATION_ONLY"||a.productionAuthorized!==false||sorted.length!==4||
    sorted.some((o,i)=>o.orderId!==scope[i]||o.physicalApproval!==false||o.simulationCardRevision!==o.orderRevision))
   throw Error("Exact four-order simulation scope required");
 const seen=new Set<string>();
 for(const b of bom) {
  const key=[b.model_id,b.bom_revision,b.bom_line_key,b.sku].join("|");
  if(seen.has(key))throw Error("Duplicate BOM line");
  seen.add(key);
 }
 const orders=sorted.map(o=>{
  const units=number(o.units,"units",1);
  if(!Number.isInteger(units)||!Number.isInteger(o.month)||o.month<1||o.month>36)throw Error("Invalid units or due month");
  const lines=bom.filter(b=>b.model_id===tiers[o.productId]);
  if(!lines.length||new Set(lines.map(b=>b.bom_revision)).size!==1)throw Error("Missing or ambiguous simulation BOM");
  const grouped=new Map<string,number>();
  for(const b of lines){
   if(!b.sku.trim())throw Error("Missing SKU");
   grouped.set(b.sku,(grouped.get(b.sku)||0)+number(b.quantity,"BOM quantity",1e-9)*units);
  }
  return {id:o.orderId,units,due:o.month,requirements:[...grouped].sort(([a],[b])=>a.localeCompare(b)).map(([sku,quantity])=>({sku,quantity}))};
 });
 const resources=[...capacity].sort((a,b)=>a.work_centre_id.localeCompare(b.work_centre_id)).map(c=>{
  if(c.planning_status!=="approved"||!c.work_centre_id.trim()||!c.source_ref.trim())throw Error("Unapproved capacity");
  const efficiency=number(c.efficiency,"efficiency",1e-9);
  if(efficiency>1)throw Error("Invalid efficiency");
  return {id:c.work_centre_id,hours:number(c.available_hours_per_month,"capacity")*efficiency,
   hoursPerUnit:number(c.standard_hours_per_unit,"capacity hours per unit",1e-9),sourceRef:c.source_ref};
 });
 if(!resources.length||new Set(resources.map(r=>r.id)).size!==resources.length)throw Error("Missing or duplicate capacity");
 const skus=[...new Set(orders.flatMap(o=>o.requirements.map(r=>r.sku)))].sort();
 const horizon=36;
 const months=(due=1)=>Array.from({length:horizon-due+1},(_,i)=>i+due);
 const lines=["Minimize"," obj: "+terms(orders.flatMap((o,i)=>months(o.due).map(m=>[(m-o.due)*(1000+i)*o.units,x(i,m)] as [number,string])).filter(([n])=>n!==0)),"Subject To"];
 orders.forEach((o,i)=>lines.push(" order_"+i+": "+terms(months(o.due).map(m=>[1,x(i,m)]))+" = 1"));
 resources.forEach((r,j)=>months().forEach(m=>{
  const load=orders.flatMap((o,i)=>m>=o.due?[[o.units*r.hoursPerUnit,x(i,m)] as [number,string]]:[]);
  if(load.length)lines.push(" capacity_"+j+"_"+m+": "+terms(load)+" <= "+r.hours);
 }));
 skus.forEach((sku,j)=>months().forEach(m=>{
  const material=orders.flatMap((o,i)=>m>=o.due?o.requirements.filter(r=>r.sku===sku).map(r=>[r.quantity,x(i,m)] as [number,string]):[]);
  // Positive equality avoids any reliance on initial stock or real open POs.
  lines.push(" material_"+j+"_"+m+": "+p(j,m)+(material.length?" - "+material.map(([n,id])=>n+" "+id).join(" - "):"")+" = 0");
 }));
 lines.push("Bounds");
 skus.forEach((_,j)=>months().forEach(m=>lines.push(" 0 <= "+p(j,m))));
 lines.push("Binary");
 orders.forEach((o,i)=>months(o.due).forEach(m=>lines.push(" "+x(i,m))));
 lines.push("End");
 return {version:FOUR_ORDER_HIGHS_VERSION,sourceHash:a.sourceHash,horizon,lp:lines.join("\n"),orders,resources,skus};
}
/** Independent semantic checks, not a replay of generated LP constraints.
 * Missing columns fail closed, including zero columns. Optimality is reported by
 * HiGHS; this checker proves primal feasibility and objective consistency only.
 */
export function verifyFourOrderHighs(model:FourOrderHighsModel,raw:SimulationHighsRaw) {
 const issues:string[]=[];
 const expected=new Set<string>();
 const eps=1e-6;
 const schedule:{orderId:string;month:number;units:number}[]=[];
 const procurement:{sku:string;month:number;quantity:number}[]=[];
 let objective=0;
 if(raw.Status!=="Optimal")issues.push("Solver did not report Optimal");
 const get=(id:string)=>{
  expected.add(id);
  const v=raw.Columns?.[id]?.Primal;
  if(typeof v!=="number"||!Number.isFinite(v)){issues.push("Missing/nonfinite column "+id);return 0;}
  if(v< -eps)issues.push("Negative column "+id);
  return v;
 };
 const values=model.orders.map((o,i)=>{
  let total=0;const byMonth=new Map<number,number>();
  for(let m=o.due;m<=model.horizon;m++){
   const v=get(x(i,m));byMonth.set(m,v);total+=v;
   if(v>1+eps||Math.abs(v-Math.round(v))>eps)issues.push("Nonbinary "+x(i,m));
   if(v>0.5)schedule.push({orderId:o.id,month:m,units:o.units});
   objective+=v*(m-o.due)*(1000+i)*o.units;
  }
  if(Math.abs(total-1)>eps)issues.push("Order assignment "+o.id);
  return byMonth;
 });
 for(let m=1;m<=model.horizon;m++){
  for(const r of model.resources){
   const used=model.orders.reduce((n,o,i)=>n+o.units*r.hoursPerUnit*(values[i].get(m)||0),0);
   if(used>r.hours+eps)issues.push("Capacity "+r.id+" M"+m);
  }
  model.skus.forEach((sku,j)=>{
   const quantity=get(p(j,m));
   const required=model.orders.reduce((sum,o,i)=>sum+o.requirements.filter(r=>r.sku===sku).reduce((n,r)=>n+r.quantity,0)*(values[i].get(m)||0),0);
   if(Math.abs(quantity-required)>eps*Math.max(1,required))issues.push("Material balance "+sku+" M"+m);
   if(quantity>eps)procurement.push({sku,month:m,quantity});
  });
 }
 for(const id of Object.keys(raw.Columns||{}))if(!expected.has(id))issues.push("Unknown column "+id);
 if(!Number.isFinite(raw.ObjectiveValue)||Math.abs(raw.ObjectiveValue!-objective)>eps*Math.max(1,Math.abs(objective)))issues.push("Objective mismatch");
 return {valid:issues.length===0,issues,objective,schedule,procurement,variableCount:expected.size,
  validation:"Independent primal feasibility; optimality reported by HiGHS" as const};
}
