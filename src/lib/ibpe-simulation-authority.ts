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
   return runFourOrderSimulation(current,bom,capacity);
 });
