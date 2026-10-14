import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "@/lib/auth/middleware";
import { withSqlTransaction, type Sql } from "@/lib/db";
import { requireBusinessActor } from "@/lib/business-actor";
import { activeReleasedMappings, stageFor, type OrderRow } from "@/lib/production-job-card";
import { evaluateEngineeringChangeEffectivity, type EngineeringEffectivityRule } from "@/lib/engineering-change-control-model";

const requestSchema=z.object({
  salesOrderId:z.string().trim().min(1).max(120),
  reason:z.string().trim().min(12).max(2000),
  ecnId:z.string().trim().max(120).optional(),
});
const applySchema=z.object({changeId:z.string().trim().min(1).max(120)});

type JobCard = {
  id:string; sales_order_id:string; sales_order_revision:number|string;
  product_id:string; product_label:string; units:number|string; due_month:number|string;
  status:string; model_tier:string|null; variant_id:string|null; configuration:unknown;
  bom_revision:string|null; approved_at:string|null; current_for_order:boolean;
};
type ChangeRow = {
  id:string; sales_order_id:string; source_job_card_id:string;
  target_sales_revision:number|string; ecn_id:string|null; reason:string;
  status:string;
};

async function currentState(sql:Sql, salesOrderId:string) {
  const orders=await sql.query<OrderRow>(
    "select id,revision,plan_month,product_id,units,status,model_tier,variant_id,variant_name,configuration from vyndi_sales_orders where id=$1 for update",
    [salesOrderId],
  );
  const cards=await sql.query<JobCard>(
    "select id,sales_order_id,sales_order_revision,product_id,product_label,units,due_month,status,model_tier,variant_id,configuration,bom_revision,approved_at::text,current_for_order from epr_production_job_cards where sales_order_id=$1 and current_for_order=true for update",
    [salesOrderId],
  );
  return {order:orders[0],card:cards[0]};
}

function assertStaleApproved(order:OrderRow|undefined,card:JobCard|undefined) {
  if (!order || order.status!=="confirmed") throw new Error("Controlled production change requires a confirmed Commercial order.");
  if (!card || !card.approved_at) throw new Error("Only an already approved Job Card can use this successor workflow.");
  if (!["released","hold"].includes(card.status)) throw new Error("An active, completed or cancelled Job Card cannot be superseded using this release path.");
  if (Number(card.sales_order_revision)>=Number(order.revision)) throw new Error("The approved Job Card is not behind the current Commercial revision.");
}

/** Records a change intent without modifying any current or historic production record. */
export const requestProductionChange=createServerFn({method:"POST"})
  .validator(requestSchema)
  .middleware([authMiddleware])
  .handler(async({data,context})=>{
    const actor=await requireBusinessActor("edit",{userId:context.userId,email:context.userEmail});
    return withSqlTransaction(async(sql)=>{
      const {order,card}=await currentState(sql,data.salesOrderId);
      assertStaleApproved(order,card);
      const existing=await sql.query<{id:string}>(
        "select id from vyndi_production_change_requests where sales_order_id=$1 and status='requested' for update",
        [order!.id],
      );
      if(existing.length) throw new Error("A production change request already exists for this order; review it before issuing another.");
      const id="PCR-"+crypto.randomUUID();
      const snapshot=JSON.stringify({card,orderRevision:card!.sales_order_revision});
      await sql.query(
        "insert into vyndi_production_change_requests(id,sales_order_id,source_job_card_id,target_sales_revision,reason,ecn_id,source_snapshot,created_by) values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)",
        [id,order!.id,card!.id,Number(order!.revision),data.reason.trim(),data.ecnId?.trim()||null,snapshot,actor.userId],
      );
      await sql.query(
        "insert into vyndi_audit_events(id,entity_type,entity_id,entity_revision,action,actor_user_id,actor_role,source_reference,payload_json) values($1,'production_change_request',$2,1,'CONTROLLED_CHANGE_REQUESTED',$3,$4,$5,$6::jsonb)",
        ["AUD-PCR-"+crypto.randomUUID(),id,actor.userId,actor.role,card!.id,
          JSON.stringify({sourceJobCardId:card!.id,sourceRevision:Number(card!.sales_order_revision),targetRevision:Number(order!.revision),ecnId:data.ecnId||null,reason:data.reason})],
      );
      return {id,status:"requested" as const,sourceJobCardId:card!.id,targetRevision:Number(order!.revision)};
    });
  });

async function assertNoExecution(sql:Sql,old:JobCard) {
  const lines=await sql.query<{id:string}>(
    "select id from epr_production_job_card_lines where job_card_id=$1 and issue_status in ('issued','complete') limit 1",
    [old.id],
  );
  if(lines.length) throw new Error("Material has been issued or consumed; put the build through Engineering/Quality disposition before a successor release.");
  const reservations=await sql.query<{id:string}>(
    "select id from epr_inventory_reservations where job_card_id=$1 and status='consumed' limit 1",[old.id],
  );
  if(reservations.length) throw new Error("Consumed inventory reservations prohibit automatic production supersession.");
  const travellers=await sql.query<{id:string}>(
    "select id from epr_travellers where job_card_id=$1 and status not in ('draft','released','rejected') limit 1",
    [old.id],
  );
  if(travellers.length) throw new Error("A traveller is in build or already completed; Production/Quality must disposition the existing serial first.");
  const productionEvidence=await sql.query<{id:string}>(
    "select ev.id from epr_evidence ev join epr_travellers tr on tr.id=ev.traveller_id where tr.job_card_id=$1 and ev.gate_id<>'EPR-04' limit 1",
    [old.id],
  );
  if(productionEvidence.length) throw new Error("Physical build or Quality evidence exists beyond initial batch release; successor release is withheld.");
  const gateProgress=await sql.query<{id:string}>(
    "select ge.id from epr_gate_events ge join epr_travellers tr on tr.id=ge.traveller_id where tr.job_card_id=$1 and ge.gate_id<>'EPR-04' and ge.status in ('passed','failed','hold') limit 1",
    [old.id],
  );
  if(gateProgress.length) throw new Error("Traveller has progressed through Production/Quality gates; disposition is required.");
  const purchaseCommitments=await sql.query<{id:string}>(
    "select id from vyndi_purchase_orders where job_card_id=$1 and status not in ('draft','cancelled') limit 1",[old.id],
  );
  if(purchaseCommitments.length) throw new Error("Issued or approved supplier commitments exist on the earlier Job Card; reconcile Purchasing before supersession.");
  const allocations=await sql.query<{id:string}>(
    "select id from vyndi_shipment_serial_allocations where job_card_id=$1 limit 1",[old.id],
  );
  if(allocations.length) throw new Error("The earlier Job Card has serial shipment allocations; shipment/disposition must be handled before change.");
}

async function verifyEngineeringNotice(
  sql:Sql,ecnId:string|null,old:JobCard,order:OrderRow,bomRevision:string,
){
  const oldConfig=JSON.stringify(old.configuration||{});
  const newConfig=JSON.stringify(order.configuration||{});
  const engineeringChange=old.variant_id!==order.variant_id
    ||old.model_tier!==order.model_tier
    ||old.bom_revision!==bomRevision
    ||oldConfig!==newConfig;
  if(!engineeringChange) return {required:false,ecnId:null};
  if(!ecnId) throw new Error("Model, configuration or BOM changed: select a released Engineering Change Notice (ECN) before production supersession.");
  const notices=await sql.query<{id:string;target_bom_revision:string|null;effectivity_json:unknown}>(
    "select id,target_bom_revision,effectivity_json from vyndi_engineering_change_notices where id=$1",
    [ecnId],
  );
  const notice=notices[0];
  if(!notice) throw new Error("No released Engineering Change Notice matches the selected ECN ID.");
  if(old.bom_revision!==bomRevision && notice.target_bom_revision!==bomRevision)
    throw new Error("ECN target BOM does not match the newly released production BOM.");
  const rules=Array.isArray(notice.effectivity_json)
    ?notice.effectivity_json as EngineeringEffectivityRule[]
    :[];
  const effect=evaluateEngineeringChangeEffectivity(rules,{
    date:new Date().toISOString().slice(0,10),
    variantId:order.variant_id,serialNumber:null,salesOrderId:order.id,jobCardId:old.id,
  });
  if(!effect.effective) throw new Error("Released ECN is not effective for this Sales Order / Job Card / variant: "+effect.reason);
  return {required:true,ecnId};
}

/** Explicit production approval atomically retires current eligibility, preserves
    the approved predecessor and builds the unapproved successor for batch review. */
export const approveAndApplyProductionChange=createServerFn({method:"POST"})
  .validator(applySchema)
  .middleware([authMiddleware])
  .handler(async({data,context})=>{
    const actor=await requireBusinessActor("approve",{userId:context.userId,email:context.userEmail});
    return withSqlTransaction(async(sql)=>{
      const rows=await sql.query<ChangeRow>(
        "select id,sales_order_id,source_job_card_id,target_sales_revision,ecn_id,reason,status from vyndi_production_change_requests where id=$1 for update",
        [data.changeId],
      );
      const request=rows[0];
      if(!request||request.status!=="requested") throw new Error("No pending Production Change Request exists.");
      const {order,card}=await currentState(sql,request.sales_order_id);
      assertStaleApproved(order,card);
      if(card!.id!==request.source_job_card_id||Number(order!.revision)!==Number(request.target_sales_revision))
        throw new Error("Change request is stale: Commercial or Production revision has changed. Start a new assessment.");
      await assertNoExecution(sql,card!);
      const release=await activeReleasedMappings(sql,order!);
      const engineering=await verifyEngineeringNotice(sql,request.ecn_id,card!,order!,release.bomRevision);
      // All preflight checks above are fail-closed. The rest executes inside one
      // database transaction: no partial predecessor/successor link is possible.
      await sql.query("select release_epr_job_card_reservations($1,$2,$3)",[card!.id,actor.userId,actor.role]);
      await sql.query(
        "update vyndi_purchase_orders set status='cancelled' where job_card_id=$1 and status='draft' and auto_generated=true",
        [card!.id],
      );
      await sql.query(
        "update epr_production_job_cards set current_for_order=false,status='hold',updated_at=now(),updated_by=$2 where id=$1 and current_for_order=true",
        [card!.id,actor.userId],
      );
      const nextId="JBC-"+crypto.randomUUID();
      await sql.query(
        "insert into epr_production_job_cards(id,sales_order_id,product_id,product_label,units,bom_tier,due_month,status,production_owner,created_by,model_tier,variant_id,configuration,sales_order_revision,bom_revision,released_mapping_set,updated_by,current_for_order,supersedes_job_card_id,production_change_id) values ($1,$2,$3,$4,$5,$6,$7,'released','operations',$8,$6,$9,$10::jsonb,$11,$12,$13::jsonb,$8,true,$14,$15)",
        [nextId,order!.id,order!.product_id,order!.variant_name??order!.variant_id,Number(order!.units),order!.model_tier,Number(order!.plan_month),actor.userId,order!.variant_id,JSON.stringify(order!.configuration??{}),Number(order!.revision),release.bomRevision,JSON.stringify(release.rows.map(m=>m.id)),card!.id,request.id],
      );
      for(const [index,mapping] of release.rows.entries()){
        const stage=stageFor(mapping.configuration_category,mapping.bom_line_key);
        const lineId=nextId+"-"+(index+1);
        const quantity=Number(order!.units)*Number(mapping.quantity);
        await sql.query(
          "insert into epr_production_job_card_lines(id,job_card_id,stage_no,stage_code,stage_name,line_type,item,quantity,unit,source_bom_line,sku,category,available_quantity,shortage_quantity,issue_status,bom_mapping_id,requirement_revision) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,0,$8,'pending',$13,$14)",
          [lineId,nextId,stage.no,stage.code,stage.name,stage.type,mapping.bom_line_key,quantity,mapping.unit,mapping.bom_line_key,mapping.sku,mapping.configuration_category,mapping.id,Number(order!.revision)],
        );
        await sql.query("select * from reserve_epr_inventory_for_job_line($1,$2,$3,$4,$5)",[
          "RES-"+crypto.randomUUID(),nextId,lineId,actor.userId,actor.role,
        ]);
      }
      const steps=[{no:4,code:"FA",name:"Final assembly"},{no:5,code:"QC",name:"QC, release & packaging"}];
      for(const [index,step] of steps.entries()){
        await sql.query(
          "insert into epr_production_job_card_lines(id,job_card_id,stage_no,stage_code,stage_name,line_type,item,quantity,unit,source_bom_line,issue_status,requirement_revision) values($1,$2,$3,$4,$5,'operation',$6,$7,'operation',$6,'pending',$8)",
          [nextId+"-OP-"+(index+1),nextId,step.no,step.code,step.name,step.name,Number(order!.units),Number(order!.revision)],
        );
      }
      await sql.query(
        "update vyndi_production_change_requests set status='applied',approved_by=$2,successor_job_card_id=$3,applied_at=now(),updated_at=now() where id=$1",
        [request.id,actor.userId,nextId],
      );
      await sql.query(
        "insert into vyndi_audit_events(id,entity_type,entity_id,entity_revision,action,actor_user_id,actor_role,source_reference,payload_json) values($1,'production_job_card',$2,$3,'CONTROLLED_PRODUCTION_SUCCESSOR_RELEASED',$4,$5,$6,$7::jsonb)",
        ["AUD-PCR-"+crypto.randomUUID(),nextId,Number(order!.revision),actor.userId,actor.role,request.id,
          JSON.stringify({previousJobCardId:card!.id,previousRevision:Number(card!.sales_order_revision),newRevision:Number(order!.revision),bomRevision:release.bomRevision,ecnId:engineering.ecnId,reason:request.reason,approvedBy:actor.userId})],
      );
      return {changeId:request.id,sourceJobCardId:card!.id,successorJobCardId:nextId,salesOrderRevision:Number(order!.revision),state:"released" as const,awaitingBatchApproval:true};
    });
  });
