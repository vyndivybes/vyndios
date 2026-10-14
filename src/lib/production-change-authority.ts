import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "@/lib/auth/middleware";
import { requireBusinessActor } from "@/lib/business-actor";
import { withSqlTransaction, type Sql } from "@/lib/db";
import { evaluateEngineeringChangeEffectivity, type EngineeringEffectivityRule } from "@/lib/engineering-change-control-model";
import { createControlledSuccessorJobCard, resolveProductionBom } from "@/lib/production-job-card";
import { assertControlledEcnBom, assertSafeProductionSupersession } from "@/lib/production-change-policy";

const changeIdSchema = z.object({ changeId:z.string().trim().min(1).max(120) });
const requestSchema = z.object({
  salesOrderId:z.string().trim().min(1).max(120),
  reason:z.string().trim().min(5).max(1000),
});
const approveSchema = changeIdSchema.extend({ ecnId:z.string().trim().min(1).max(120) });

type SalesOrder = {
  id:string;revision:number|string;plan_month:number|string;product_id:"aluminium"|"carbon"|"premiumCarbon";
  units:number|string;status:"lead"|"confirmed"|"delivered"|"cancelled";
  model_tier:"core"|"pro"|"apex"|null;variant_id:string|null;variant_name:string|null;
  configuration:Record<string,string>;
};
type JobCard = {
  id:string;sales_order_id:string;sales_order_revision:number|string;status:string;
  approved_at:string|null;model_tier:string|null;variant_id:string|null;bom_revision:string|null;
  superseded_at:string|null;batch_code:string|null;units:number|string;
};
type Change = {
  id:string;sales_order_id:string;previous_job_card_id:string;requested_sales_revision:number|string;
  reason:string;status:"requested"|"approved"|"applied"|"rejected";
  ecn_id:string|null;successor_job_card_id:string|null;
};
type Ecn = {id:string;effectivity_json:unknown;target_bom_revision:string|null;change_class:string;};
type GuardCounts = {
  issued_lines:number|string;consumed_reservations:number|string;progressed_travellers:number|string;
  progressed_gates:number|string;progressed_evidence:number|string;committed_purchase_orders:number|string;
};

async function currentOrderAndCard(sql:Sql, orderId:string) {
  const [order] = await sql.query<SalesOrder>(
    "select id,revision,plan_month,product_id,units,status,model_tier,variant_id,variant_name,configuration from vyndi_sales_orders where id=$1 for update",
    [orderId],
  );
  if(!order || order.status!=="confirmed") throw new Error("Controlled change requires a confirmed Commercial order.");
  const [card] = await sql.query<JobCard>(
    "select id,sales_order_id,sales_order_revision,status,approved_at::text,model_tier,variant_id,bom_revision,superseded_at::text,batch_code,units from epr_production_job_cards where sales_order_id=$1 and superseded_at is null for update",
    [orderId],
  );
  if(!card || !card.approved_at) throw new Error("No current approved Job Card is available for controlled change.");
  if(Number(card.sales_order_revision)>=Number(order.revision)) throw new Error("This Job Card already matches the current Commercial order revision.");
  return {order,card};
}

async function guardPhysicalCommitments(sql:Sql, card:JobCard) {
  const [c]=await sql.query<GuardCounts>(`
    select
      (select count(*)::int from epr_production_job_card_lines where job_card_id=$1 and issue_status in ('issued','complete')) as issued_lines,
      (select count(*)::int from epr_inventory_reservations where job_card_id=$1 and status='consumed') as consumed_reservations,
      (select count(*)::int from epr_travellers where job_card_id=$1 and status not in ('draft','released','rejected')) as progressed_travellers,
      (select count(*)::int from epr_gate_events g join epr_travellers t on t.id=g.traveller_id where t.job_card_id=$1 and g.gate_id<>'EPR-04' and g.status='passed') as progressed_gates,
      (select count(*)::int from epr_evidence e join epr_travellers t on t.id=e.traveller_id where t.job_card_id=$1 and e.gate_id<>'EPR-04' and e.disposition='accepted') as progressed_evidence,
      (select count(*)::int from vyndi_purchase_orders where job_card_id=$1 and status not in ('draft','cancelled')) as committed_purchase_orders
  `,[card.id]);
  if(!c) throw new Error("Could not qualify the existing production/stock history.");
  assertSafeProductionSupersession({
    jobCardStatus:card.status,issuedLines:Number(c.issued_lines),consumedReservations:Number(c.consumed_reservations),
    progressedTravellers:Number(c.progressed_travellers),progressedGates:Number(c.progressed_gates),
    progressedEvidence:Number(c.progressed_evidence),committedPurchaseOrders:Number(c.committed_purchase_orders),
  });
}

async function requireMatchingReleasedEcn(sql:Sql, ecnId:string, order:SalesOrder, card:JobCard) {
  const [ecn]=await sql.query<Ecn>(
    "select id,effectivity_json,target_bom_revision,change_class from vyndi_engineering_change_notices where id=$1",
    [ecnId],
  );
  if(!ecn) throw new Error("Select a released Engineering Change Notice (ECN). Approving an ECR or ECO alone is insufficient.");
  const payload=typeof ecn.effectivity_json==="string"?JSON.parse(ecn.effectivity_json):ecn.effectivity_json;
  const parsed=z.array(z.object({
    id:z.string(),type:z.enum(["variant","date","serial","sales_order","job_card"]),
    valueFrom:z.string().nullable().optional(),valueTo:z.string().nullable().optional(),
    effectiveFrom:z.string().nullable().optional(),effectiveTo:z.string().nullable().optional(),
  })).min(1).parse(payload);
  const rules:EngineeringEffectivityRule[]=parsed.map((rule)=>({
    id:rule.id,type:rule.type,valueFrom:rule.valueFrom??null,valueTo:rule.valueTo??null,
    effectiveFrom:rule.effectiveFrom??null,effectiveTo:rule.effectiveTo??null,
  }));
  if(!rules.some((rule)=>
    (rule.type==="job_card" && rule.valueFrom===card.id) ||
    (rule.type==="sales_order" && rule.valueFrom===order.id)))
    throw new Error("ECN needs explicit Job Card or Sales Order effectivity for this controlled replacement.");
  const applicability=evaluateEngineeringChangeEffectivity(rules,{
    date:new Date().toISOString().slice(0,10),variantId:order.variant_id,
    serialNumber:null,salesOrderId:order.id,jobCardId:card.id,
  });
  if(!applicability.effective) throw new Error("Released ECN effectivity does not cover this Job Card: "+applicability.reason);
  const resolved=await resolveProductionBom(sql,order);
  assertControlledEcnBom(card.bom_revision,resolved.bomRevision,ecn.target_bom_revision);
  return {ecn,resolved};
}

async function audit(sql:Sql, change:Change, actor:{userId:string;role:string},action:string,payload:object) {
  await sql.query(
    `insert into vyndi_audit_events
      (id,entity_type,entity_id,entity_revision,action,actor_user_id,actor_role,source_reference,payload_json)
      values ($1,'production_change',$2,$3,$4,$5,$6,$7,$8::jsonb)`,
    ["AUD-PC-"+crypto.randomUUID(),change.id,Number(change.requested_sales_revision),
      action,actor.userId,actor.role,change.previous_job_card_id,JSON.stringify(payload)],
  );
}

export const requestProductionChange=createServerFn({method:"POST"})
  .validator(requestSchema).middleware([authMiddleware])
  .handler(async({data,context})=>{
    const actor=await requireBusinessActor("edit",{userId:context.userId,email:context.userEmail});
    return withSqlTransaction(async(sql)=>{
      const {order,card}=await currentOrderAndCard(sql,data.salesOrderId);
      const [already]=await sql.query<Change>(
        "select * from vyndi_production_changes where previous_job_card_id=$1 and requested_sales_revision=$2 and status<>'rejected' for update",
        [card.id,Number(order.revision)],
      );
      if(already) return {id:already.id,status:already.status,existing:true};
      const id="PCH-"+crypto.randomUUID();
      const [created]=await sql.query<Change>(
        `insert into vyndi_production_changes
          (id,sales_order_id,previous_job_card_id,requested_sales_revision,reason,requested_by,requested_role)
          values($1,$2,$3,$4,$5,$6,$7) returning *`,
        [id,order.id,card.id,Number(order.revision),data.reason,actor.userId,actor.role],
      );
      await audit(sql,created,actor,"REQUESTED",{reason:data.reason,previousRevision:card.sales_order_revision,targetRevision:order.revision});
      return {id,status:"requested" as const,existing:false};
    },{isolationLevel:"serializable"});
  });

export const approveProductionChange=createServerFn({method:"POST"})
  .validator(approveSchema).middleware([authMiddleware])
  .handler(async({data,context})=>{
    const actor=await requireBusinessActor("approve",{userId:context.userId,email:context.userEmail});
    return withSqlTransaction(async(sql)=>{
      const [change]=await sql.query<Change>("select * from vyndi_production_changes where id=$1 for update",[data.changeId]);
      if(!change) throw new Error("Production Change Request not found.");
      if(change.status==="approved" && change.ecn_id===data.ecnId) return {id:change.id,status:"approved" as const,existing:true};
      if(change.status!=="requested") throw new Error("Only requested production changes can be approved.");
      const {order,card}=await currentOrderAndCard(sql,change.sales_order_id);
      if(card.id!==change.previous_job_card_id || Number(order.revision)!==Number(change.requested_sales_revision))
        throw new Error("Order or Job Card revision moved since the production change was requested.");
      await guardPhysicalCommitments(sql,card);
      await requireMatchingReleasedEcn(sql,data.ecnId,order,card);
      await sql.query(
        "update vyndi_production_changes set status='approved',ecn_id=$2,approved_by=$3,approved_at=now(),updated_at=now() where id=$1",
        [change.id,data.ecnId,actor.userId],
      );
      await audit(sql,change,actor,"APPROVED",{ecnId:data.ecnId,approvedSalesRevision:order.revision});
      return {id:change.id,status:"approved" as const,existing:false};
    },{isolationLevel:"serializable"});
  });

export const rejectProductionChange=createServerFn({method:"POST"})
  .validator(changeIdSchema).middleware([authMiddleware])
  .handler(async({data,context})=>{
    const actor=await requireBusinessActor("approve",{userId:context.userId,email:context.userEmail});
    return withSqlTransaction(async(sql)=>{
      const [change]=await sql.query<Change>("select * from vyndi_production_changes where id=$1 for update",[data.changeId]);
      if(!change || change.status!=="requested") throw new Error("Only pending requests can be rejected.");
      await sql.query("update vyndi_production_changes set status='rejected',approved_by=$2,updated_at=now() where id=$1",[change.id,actor.userId]);
      await audit(sql,change,actor,"REJECTED",{reason:change.reason});
      return {id:change.id,status:"rejected" as const};
    },{isolationLevel:"serializable"});
  });

export const applyProductionChange=createServerFn({method:"POST"})
  .validator(changeIdSchema).middleware([authMiddleware])
  .handler(async({data,context})=>{
    const actor=await requireBusinessActor("approve",{userId:context.userId,email:context.userEmail});
    return withSqlTransaction(async(sql)=>{
      const [change]=await sql.query<Change>("select * from vyndi_production_changes where id=$1 for update",[data.changeId]);
      if(!change) throw new Error("Production Change Request not found.");
      if(change.status==="applied" && change.successor_job_card_id)
        return {id:change.id,status:"applied" as const,newJobCardId:change.successor_job_card_id,existing:true};
      if(change.status!=="approved" || !change.ecn_id)
        throw new Error("A released ECN and approved Production Change Request are required.");
      const {order,card}=await currentOrderAndCard(sql,change.sales_order_id);
      if(card.id!==change.previous_job_card_id || Number(order.revision)!==Number(change.requested_sales_revision))
        throw new Error("Order or Job Card revision changed after production approval. Requalify the request.");
      await guardPhysicalCommitments(sql,card);
      await requireMatchingReleasedEcn(sql,change.ecn_id,order,card);
      // Release only unconsumed material; all irreversible stock postings
      // and supplier commitments were guarded above. Execute in ONE transaction.
      await sql.query("select release_epr_job_card_reservations($1,$2,$3)",[card.id,actor.userId,actor.role]);
      await sql.query(
        "update vyndi_purchase_orders set status='cancelled',updated_by=$2,updated_at=now() where job_card_id=$1 and auto_generated=true and status='draft'",
        [card.id,actor.userId],
      );
      const [retired]=await sql.query<{id:string}>(
        "update epr_production_job_cards set status='cancelled',superseded_at=now(),updated_by=$2,updated_at=now() where id=$1 and superseded_at is null returning id",
        [card.id,actor.userId],
      );
      if(!retired) throw new Error("Approved predecessor changed during supersession.");
      const successor=await createControlledSuccessorJobCard(sql,order,actor);
      await sql.query(
        "update epr_production_job_cards set supersedes_job_card_id=$2,production_change_id=$3 where id=$1",
        [successor.id,card.id,change.id],
      );
      const [newCard]=await sql.query<Record<string,unknown>>(
        "select id,sales_order_id,sales_order_revision,status,variant_id,bom_revision,units from epr_production_job_cards where id=$1",
        [successor.id],
      );
      await sql.query(
        `update vyndi_production_changes
         set status='applied',applied_by=$2,applied_at=now(),successor_job_card_id=$3,
             previous_snapshot=$4::jsonb,successor_snapshot=$5::jsonb,updated_at=now()
         where id=$1`,
        [change.id,actor.userId,successor.id,JSON.stringify(card),JSON.stringify(newCard)],
      );
      await audit(sql,change,actor,"APPLIED",{
        predecessor:card.id,predecessorBatch:card.batch_code,
        historicalApprovalPreserved:true,newJobCardId:successor.id,
        ecnId:change.ecn_id,fromSalesRevision:card.sales_order_revision,
        toSalesRevision:order.revision,fromBom:card.bom_revision,toBom:successor.bomRevision,
      });
      return {id:change.id,status:"applied" as const,newJobCardId:successor.id,existing:false};
    },{isolationLevel:"serializable"});
  });
