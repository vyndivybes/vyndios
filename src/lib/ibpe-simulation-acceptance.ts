/**
 * Versioned FOUR-ORDER-DEMO-2026-11 simulation projection.
 * No approved physical job card, real inventory, actual cash, supplier PO,
 * COGS, or production mutation is created by this module.
 */
import { createHash } from "node:crypto";
import { runRuntimeIbpe, RUNTIME_IBPE_ENGINE_VERSION, type RuntimeIbpeInput } from "./ibpe-runtime-parity.ts";
import type { ProductLineId } from "./finance/model.ts";

export const FOUR_ORDER_DEMO_IDS = [
  "SO-02ca96da-5206-4b94-9fef-062a2a992919",
  "SO-69e011a9-2c99-4ffa-82f7-39eef01bf05e",
  "SO-800d46b7-d354-4e80-a3a9-d6c2207be5bf",
  "SO-991bfe7e-85f6-4849-a5d0-04c2792606e3",
] as const;
export const FOUR_ORDER_SIMULATION_VERSION = "VYNDI-SIM-FOUR-ORDER-1.0.0" as const;
const ids = new Set<string>(FOUR_ORDER_DEMO_IDS);
const expectedStale = "SO-800d46b7-d354-4e80-a3a9-d6c2207be5bf";
const model: Record<ProductLineId, string> = { aluminium:"core",carbon:"pro",premiumCarbon:"apex" };
const tier: Record<string, ProductLineId> = { core:"aluminium",pro:"carbon",apex:"premiumCarbon" };

export type FourOrderSource = {
 id: string; revision: number|string; status: string; product_id: string;
 units: number|string; plan_month: number|string; card_id: string|null;
 card_revision: number|string|null; card_status: string|null;
 bom_revision: string|null; approved_by: string|null; approved_at: string|null;
};
export type AcceptedSimulationOrder = {
 orderId:string; orderRevision:number; sourceCardId:string;
 sourceCardRevision:number; simulationCardId:string; simulationCardRevision:number;
 virtualSuccessor:boolean; simulationAcceptance:"accepted-for-simulation-only";
 physicalApproval:false; productId:ProductLineId; modelTier:string;
 units:number; month:number; sourceCardStatus:string; sourceBomRevision:string|null;
};
export type FourOrderAcceptance = {
 version:typeof FOUR_ORDER_SIMULATION_VERSION; mode:"SIMULATION_ONLY";
 sourceHash:string; productionAuthorized:false;
 orders:AcceptedSimulationOrder[];
 warning:string;
};
export type PlanningBomRow = {model_id:string;bom_revision:string;sku:string;quantity:number|string;bom_line_key:string};
export type CapacityStandardRow = {
 work_centre_id:string;available_hours_per_month:number|string;efficiency:number|string;
 standard_hours_per_unit:number|string;planning_status:string;source_ref:string;
};

function stable(value:unknown):unknown {
 if(Array.isArray(value)) return value.map(stable);
 if(value && typeof value==="object") return Object.fromEntries(
   Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b))
     .map(([k,v])=>[k,stable(v)])
 );
 return value;
}
function sha(value:unknown){ return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }
function strictlyPositive(value:unknown,label:string){
 const n=Number(value);if(!Number.isFinite(n)||n<=0)throw Error(`Invalid ${label}`);return n;
}
function validMonth(value:unknown){
 const n=Number(value);if(!Number.isInteger(n)||n<1||n>36)throw Error("Invalid simulation month");return n;
}

export function acceptFourOrderSimulation(rows:FourOrderSource[]):FourOrderAcceptance {
 if(rows.length!==4||new Set(rows.map(r=>r.id)).size!==4||rows.some(r=>!ids.has(r.id)))
  throw Error("Simulation scope must contain the exact four approved demo order IDs");
 const sorted=[...rows].sort((a,b)=>a.id.localeCompare(b.id));
 const projected:AcceptedSimulationOrder[]=sorted.map(r=>{
  if(r.status!=="confirmed")throw Error(`Simulation source order ${r.id} is not confirmed`);
  if(!r.card_id||!r.card_status||r.card_revision==null)throw Error(`Simulation source card missing for ${r.id}`);
  if(!(r.product_id in model))throw Error(`Unknown simulation product ${r.product_id}`);
  if(!["hold","released"].includes(r.card_status))throw Error(`Unexpected simulation source card status for ${r.id}`);
  const rev=strictlyPositive(r.revision,"order revision");
  const cardRev=strictlyPositive(r.card_revision,"source card revision");
  if(!Number.isInteger(rev)||!Number.isInteger(cardRev))throw Error("Revision must be integral");
  const stale=rev!==cardRev;
  if(stale && (r.id!==expectedStale||rev!==3||cardRev!==2||r.card_status!=="hold"))
   throw Error("Unexpected card revision drift; refresh and requalify scenario");
  if(!stale && r.id===expectedStale)throw Error("Expected R2/R3 HOLD changed; refresh simulation authorization");
  return {
   orderId:r.id,orderRevision:rev,sourceCardId:r.card_id,sourceCardRevision:cardRev,
   simulationCardId:`SIM-ONLY:${r.card_id}:R${rev}`,
   simulationCardRevision:rev,virtualSuccessor:stale,
   simulationAcceptance:"accepted-for-simulation-only",physicalApproval:false,
   productId:r.product_id as ProductLineId,modelTier:model[r.product_id as ProductLineId],
   units:strictlyPositive(r.units,"units"),month:validMonth(r.plan_month),
   sourceCardStatus:r.card_status,sourceBomRevision:r.bom_revision,
  };
 });
 return {
  version:FOUR_ORDER_SIMULATION_VERSION,mode:"SIMULATION_ONLY",
  sourceHash:sha({version:FOUR_ORDER_SIMULATION_VERSION,raw:sorted.map(r=>({
   id:r.id,status:r.status,revision:r.revision,units:r.units,product_id:r.product_id,
   plan_month:r.plan_month,card_id:r.card_id,card_revision:r.card_revision,
   card_status:r.card_status,bom_revision:r.bom_revision,approved_at:r.approved_at,approved_by:r.approved_by,
  }))}),
  productionAuthorized:false,orders:projected,
  warning:"SCENARIO ONLY: R3 successor and all four job cards are simulated planning projections. No manufacturing, purchasing, real cash, inventory, or statutory authority.",
 };
}

export function buildFourOrderSimulationInput(
 acceptance:FourOrderAcceptance,
 planningBom:PlanningBomRow[],
 capacityStandards:CapacityStandardRow[],
):RuntimeIbpeInput {
 if(acceptance.mode!=="SIMULATION_ONLY"||acceptance.productionAuthorized!==false||acceptance.orders.length!==4)
  throw Error("Unqualified simulation acceptance");
 const found=new Map<string,Set<string>>();
 for(const row of planningBom){
  if(!tier[row.model_id])continue;
  if(!found.has(row.model_id))found.set(row.model_id,new Set());
  found.get(row.model_id)!.add(row.bom_revision);
 }
 for(const x of ["core","pro","apex"])if(found.get(x)?.size!==1)
  throw Error(`Simulation requires exactly one active approved planning BOM for ${x}`);
 if(capacityStandards.length===0||capacityStandards.some(x=>x.planning_status!=="approved"))
  throw Error("Simulation requires approved capacity standards");
 const bom:RuntimeIbpeInput["bom"]=planningBom.filter(r=>Boolean(tier[r.model_id])).map(r=>({
  id:`SIM-BOM:${r.model_id}:${r.bom_revision}:${r.bom_line_key}:${r.sku}`,
  productId:tier[r.model_id],revisionId:r.bom_revision,approved:true,sku:r.sku,
  quantityPerUnit:strictlyPositive(r.quantity,"BOM quantity"),
  sourceRef:`SIMULATION_ONLY:BOM:${r.bom_revision}`,
 }));
 const inventory:RuntimeIbpeInput["inventory"]=[...new Set(bom.map(x=>x.sku))].sort().map(sku=>({
  sku,onHandQty:0,reservedQty:0,safetyStockQty:0,mslQty:0,
  leadTimeMonths:0,moq:1,orderMultiple:1,sourceRef:"SIMULATION_ONLY:ZERO-OPENING-STOCK",
 }));
 const group=new Map<string,{sku:string;period:number;quantity:number;orderIds:Set<string>}>();
 for(const order of acceptance.orders){
  for(const line of bom.filter(b=>b.productId===order.productId)){
   const key=`${order.month}|${line.sku}`;
   const previous=group.get(key)||{sku:line.sku,period:order.month,quantity:0,orderIds:new Set<string>()};
   previous.quantity+=order.units*line.quantityPerUnit;
   previous.orderIds.add(order.orderId);group.set(key,previous);
  }
 }
 const committedMaterialRequirements:RuntimeIbpeInput["committedMaterialRequirements"]=[...group.values()].sort((a,b)=>a.period-b.period||a.sku.localeCompare(b.sku)).map(x=>({
  id:`SIM-COMMITTED:M${x.period}:${x.sku}`,sku:x.sku,period:x.period,
  quantity:x.quantity,orderCount:x.orderIds.size,sourceRef:"SIMULATION_ONLY:VIRTUAL-JOB-CARDS",
 }));
 const capacity:RuntimeIbpeInput["capacity"]=[];
 for(const row of capacityStandards){
  const units=Number(row.available_hours_per_month)*Number(row.efficiency)/strictlyPositive(row.standard_hours_per_unit,"capacity hours");
  if(!Number.isFinite(units)||units<0)throw Error("Invalid simulation capacity");
  for(let m=1;m<=36;m++)capacity.push({
   id:`SIM-CAP:${row.work_centre_id}:M${m}`,period:m,
   capacityUnits:units,sourceRef:`SIMULATION_ONLY:${row.source_ref}`,
  });
 }
 return {
  demand:acceptance.orders.map(x=>({
   id:`SIM-DEMAND:${x.orderId}`,productId:x.productId,period:x.month,planQty:0,
   forecastQty:x.units,committedQty:x.units,actualQty:0,confidence:1,
   sourceRef:`SIMULATION_ONLY:${x.orderId}`,
  })),
  bom,inventory,committedMaterialRequirements,
  reservations:[],receipts:[],capacity,cashFlows:[],
  funding:{openingBankCashLakh:0,minimumOperatingReserveLakh:0,restrictedCashLakh:0,fundraisingLeadMonths:3},
  runtimeControls:{paymentLagBySku:{},cashAnchorPeriod:0,cashAnchorSourceRef:"SIMULATION_ONLY:ZERO-CASH"},
 };
}

export function runFourOrderSimulation(
 acceptance:FourOrderAcceptance,bom:PlanningBomRow[],capacity:CapacityStandardRow[],
) {
 const input=buildFourOrderSimulationInput(acceptance,bom,capacity);
 const output=runRuntimeIbpe(input,{horizonMonths:36});
 return {
  version:FOUR_ORDER_SIMULATION_VERSION,engineVersion:RUNTIME_IBPE_ENGINE_VERSION,
  mode:"SIMULATION_ONLY" as const,productionAuthorized:false as const,
  financiallyAuthoritative:false as const,optimizerCertified:false as const,
  sourceHash:acceptance.sourceHash,inputHash:sha(input),
  acceptedOrderCount:acceptance.orders.length,
  virtualSuccessorCount:acceptance.orders.filter(o=>o.virtualSuccessor).length,
  revisionMismatches:acceptance.orders.filter(o=>o.simulationCardRevision!==o.orderRevision).length,
  summary:output.summary,
  limitations:[
   "Only four explicitly selected demo orders are accepted; real job-card approvals remain missing.",
   "Material inventory begins at zero; no actual stock/PO/reservations are imported.",
   "Cash begins at zero; no real payments, tax, revenue or COGS enter this simulation.",
   "HiGHS optimization, production deployment, physical release and funding certification are NOT executed or authorized.",
  ],
 };
}
