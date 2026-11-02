import { createHash } from "node:crypto";
import { compileFourOrderHighs, verifyFourOrderHighs, FOUR_ORDER_HIGHS_VERSION } from "./four-order-highs.ts";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "./auth/middleware.ts";
import { requireBusinessActor } from "./business-actor.ts";
import { getSql } from "./db.ts";
import {
  FOUR_ORDER_DEMO_IDS,
  acceptFourOrderSimulation,
  runFourOrderSimulation,
  type FourOrderSource,
  type PlanningBomRow,
  type CapacityStandardRow,
} from "./ibpe-simulation-acceptance.ts";

async function liveSimulationSource() {
  const sql = await getSql();
  // Read-only snapshot: does NOT post inventory, approve batches, or write GL.
  const rows = await sql.query<FourOrderSource>(
    `select o.id,o.revision,o.status,o.product_id,o.units,o.plan_month,
            c.id as card_id,c.sales_order_revision as card_revision,
            c.status as card_status,c.bom_revision,c.approved_by,c.approved_at::text
       from vyndi_sales_orders o
       left join epr_production_job_cards c
         on c.sales_order_id=o.id and c.superseded_at is null
      where o.id=any($1::text[])
      order by o.id`,
    [[...FOUR_ORDER_DEMO_IDS]],
  );
  return acceptFourOrderSimulation(rows);
}

/** View-only: preview the source fingerprint before consenting to a simulated run. */
export const getFourOrderSimulationPreview = createServerFn({ method:"GET" })
 .middleware([authMiddleware])
 .handler(async({context})=>{
   await requireBusinessActor("view",{userId:context.userId,email:context.userEmail});
   return liveSimulationSource();
 });

/**
 * Explicitly consented, fresh-input, memory-only IBPE exercise.
 * No source table write and no governed/prod optimizer packet is produced.
 * Simulation acceptance is scoped to this response, not a physical approval.
 */
export const runAcceptedFourOrderSimulation = createServerFn({ method:"POST" })
 .middleware([authMiddleware])
 .validator(z.object({
   confirmation:z.literal("SIMULATION_ONLY"),
   expectedSourceHash:z.string().regex(/^[a-f0-9]{64}$/),
 }))
 .handler(async({data,context})=>{
   await requireBusinessActor("view",{userId:context.userId,email:context.userEmail});
   const current=await liveSimulationSource();
   if(data.expectedSourceHash!==current.sourceHash)
     throw new Error("Simulation source revision/card/approval changed. Refresh preview and review before consenting again.");
   const {bom,capacity}=await simulationPlanningSources();
   return runFourOrderSimulation(current,bom,capacity);
 });

async function simulationPlanningSources(){
   const sql=await getSql();
   const [bom,capacity]=await Promise.all([
     sql.query<PlanningBomRow>(
       `select model_id,bom_revision,bom_line_key,sku,quantity
          from epr_bom_inventory_mappings
         where model_id in ('core','pro','apex') and status='active'
           and configuration_option_id is null and approved_by is not null and approved_at is not null
           and effective_from<=now() and (effective_to is null or effective_to>now())
         order by model_id,bom_revision,bom_line_key,sku`,
     ),
     sql.query<CapacityStandardRow>(
       `select work_centre_id,available_hours_per_month,efficiency,
               standard_hours_per_unit,planning_status,source_ref
          from vyndi_capacity_standards
         where planning_status='approved' order by sequence,work_centre_id`,
     ),
   ]);

 return {bom,capacity};
}

const consent=z.object({confirmation:z.literal("SIMULATION_ONLY"),expectedSourceHash:z.string().regex(/^[a-f0-9]{64}$/)});
const hash=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
async function prepareHighs(expectedSourceHash:string){
 const acceptance=await liveSimulationSource();
 if(acceptance.sourceHash!==expectedSourceHash)throw Error("Simulation source changed. Refresh and consent again.");
 const {bom,capacity}=await simulationPlanningSources();
 const sourceSha=(process.env.VYNDI_SOURCE_SHA||process.env.WORKERS_CI_COMMIT_SHA||process.env.GITHUB_SHA||"").trim();
 if(!/^[a-f0-9]{40}$/i.test(sourceSha))throw Error("Deployed source SHA unavailable");
 const model=compileFourOrderHighs(acceptance,bom,capacity);
 const ibpe=runFourOrderSimulation(acceptance,bom,capacity);
 const modelHash=hash({sourceSha,model});
 return {sourceSha,modelHash,model,ibpe};
}
export const prepareFourOrderHighs = createServerFn({method:"POST"})
 .middleware([authMiddleware]).validator(consent)
 .handler(async({data,context})=>{
  await requireBusinessActor("view",{userId:context.userId,email:context.userEmail});
  return prepareHighs(data.expectedSourceHash);
 });
export const validateFourOrderHighs = createServerFn({method:"POST"})
 .middleware([authMiddleware])
 .validator(consent.extend({
  modelHash:z.string().regex(/^[a-f0-9]{64}$/),
  raw:z.object({Status:z.string().max(80),ObjectiveValue:z.number().finite(),
   Columns:z.record(z.string().max(80),z.object({Primal:z.number().finite()}).strict())
    .refine(x=>Object.keys(x).length<=5000,"Too many solver columns")}).strict(),
 }))
 .handler(async({data,context})=>{
  await requireBusinessActor("view",{userId:context.userId,email:context.userEmail});
  const current=await prepareHighs(data.expectedSourceHash);
  if(current.modelHash!==data.modelHash)throw Error("Simulation BOM, capacity or deployed source changed. Review and run again.");
  const result=verifyFourOrderHighs(current.model,data.raw);
  if(!result.valid)throw Error("Simulation primal rejected: "+result.issues.slice(0,6).join("; "));
  return {
   ...result,mode:"SIMULATION_ONLY" as const,productionAuthorized:false as const,
   financiallyAuthoritative:false as const,persisted:false as const,
   version:FOUR_ORDER_HIGHS_VERSION,sourceSha:current.sourceSha,
   sourceHash:current.model.sourceHash,inputHash:current.ibpe.inputHash,
   modelHash:current.modelHash,resultHash:hash({modelHash:current.modelHash,result}),
   solverReportedStatus:data.raw.Status,ibpe:current.ibpe,
   assumptions:["Whole orders scheduled in monthly buckets, no splitting or early production.",
    "Every approved work centre constrains every bicycle using its planning standard; no detailed routing or physical release.",
    "Virtual unlimited zero-lead supply exactly equals BOM requirements in the scheduled month. No real supplier, stock, PO or cost.",
    "Weighted lateness objective only. Zero cash, no financing or accounting model.",
    "Result is a memory-only simulation receipt. Server independently validates feasibility, not a proof of solver optimality."],
  };
 });
