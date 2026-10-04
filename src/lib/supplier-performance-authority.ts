import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getSql, type Sql } from "@/lib/db";
import { getCommandRole } from "@/lib/command-access";
import { canPerform } from "@/lib/page-access";
import { requireBusinessActor } from "@/lib/business-actor";
import { buildSupplierPerformanceScorecard, type SupplierPerformanceEvidence } from "@/lib/supplier-performance-model";

type SupplierPerformanceResult = ReturnType<typeof buildSupplierPerformanceScorecard>;

export type SupplierOption={id:string;name:string};
type SupplierRow=SupplierOption;
type DeliveryRow={
  purchase_order_id:string;
  supplier_id:string;
  quantity:number|string;
  expected_receipt_on:string;
  actual_receipt_on:string;
  received_quantity:number|string;
};
type ReceiptRow={
  supplier_id:string;
  receipt_count:number|string;
  received_qty:number|string;
  accepted_qty:number|string;
  rejected_qty:number|string;
  traceable_receipt_count:number|string;
};
type QualityRow={
  supplier_id:string;
  ncr_id:string;
  severity:string;
  ncr_status:string;
  capa_id:string|null;
  capa_status:string|null;
  capa_due_on:string|null;
  effectiveness_evidence_ref:string|null;
};
type CostRow={
  supplier_id:string;
  expected_invoice_cost_inr:number|string;
  actual_invoice_cost_inr:number|string;
};
type ResponseRow={supplier_id:string;response_hours:number|string};
type LatestRunRow={
  id:string;
  result_json:SupplierPerformanceResult;
  source_reference:string;
  actor_role:string;
  created_at:string;
};

const clean=(value:unknown)=>String(value??"").trim();
const n=(value:unknown)=>Number(value??0);

async function requireView(){
  const role=await getCommandRole();
  if(!role||!canPerform(role,"view")) throw new Error("Supplier Performance view permission denied.");
  return role;
}

export async function buildSupplierPerformanceFromSql(sql:Sql){
  const [suppliers,deliveries,receipts,quality,costs,responses]=await Promise.all([
    sql.query<SupplierRow>(
      \`select id,name from vyndi_suppliers where active=true order by name,id\`,
    ),
    sql.query<DeliveryRow>(
      \`select p.id as purchase_order_id,p.supplier_id,p.quantity,p.expected_receipt_on::text,
              max(r.received_on)::text as actual_receipt_on,
              coalesce(sum(r.quantity_received),0) as received_quantity
         from vyndi_purchase_orders p
         join vyndi_goods_receipts r on r.purchase_order_id=p.id
        where p.status='received'
        group by p.id,p.supplier_id,p.quantity,p.expected_receipt_on
        order by p.supplier_id,p.id\`,
    ),
    sql.query<ReceiptRow>(
      \`select p.supplier_id,
              count(r.id)::int as receipt_count,
              coalesce(sum(r.quantity_received),0) as received_qty,
              coalesce(sum(r.quantity_accepted),0) as accepted_qty,
              coalesce(sum(r.quantity_rejected),0) as rejected_qty,
              count(r.id) filter (
                where btrim(coalesce(r.supplier_lot,''))<>''
                  and btrim(coalesce(r.source_reference,''))<>''
                  and (r.inventory_movement_id is null or r.identity_uid is not null)
              )::int as traceable_receipt_count
         from vyndi_purchase_orders p
         join vyndi_goods_receipts r on r.purchase_order_id=p.id
        group by p.supplier_id
        order by p.supplier_id\`,
    ),
    sql.query<QualityRow>(
      \`select p.supplier_id,n.id as ncr_id,n.severity,n.status as ncr_status,
              c.id as capa_id,c.status as capa_status,c.due_on::text as capa_due_on,
              c.effectiveness_evidence_ref
         from vyndi_quality_inspections i
         join vyndi_goods_receipts r on r.id=i.goods_receipt_id
         join vyndi_purchase_orders p on p.id=r.purchase_order_id
         join vyndi_quality_ncrs n on n.inspection_id=i.id
         left join vyndi_quality_capas c on c.ncr_id=n.id
        where i.inspection_stage='incoming'
        order by p.supplier_id,n.id,c.id\`,
    ),
    sql.query<CostRow>(
      \`select p.supplier_id,
              coalesce(sum(i.quantity_invoiced*p.unit_price_inr),0) as expected_invoice_cost_inr,
              coalesce(sum(i.amount_ex_gst_inr),0) as actual_invoice_cost_inr
         from vyndi_supplier_invoices i
         join vyndi_purchase_orders p on p.id=i.purchase_order_id
        where i.status<>'void'
        group by p.supplier_id
        order by p.supplier_id\`,
    ),
    sql.query<ResponseRow>(
      \`select supplier_id,
              extract(epoch from (responded_at-requested_at))/3600.0 as response_hours
         from vyndi_current_supplier_response_events
        order by supplier_id,requested_at,id\`,
    ),
  ]);

  const deliveriesBySupplier=new Map<string,DeliveryRow[]>();
  for(const row of deliveries){
    const list=deliveriesBySupplier.get(row.supplier_id)??[];
    list.push(row);deliveriesBySupplier.set(row.supplier_id,list);
  }
  const receiptBySupplier=new Map(receipts.map((row)=>[row.supplier_id,row]));
  const costBySupplier=new Map(costs.map((row)=>[row.supplier_id,row]));
  const responsesBySupplier=new Map<string,number[]>();
  for(const row of responses){
    const list=responsesBySupplier.get(row.supplier_id)??[];
    list.push(n(row.response_hours));responsesBySupplier.set(row.supplier_id,list);
  }
  const qualityBySupplier=new Map<string,QualityRow[]>();
  for(const row of quality){
    const list=qualityBySupplier.get(row.supplier_id)??[];
    list.push(row);qualityBySupplier.set(row.supplier_id,list);
  }

  const evidence:SupplierPerformanceEvidence[]=suppliers.map((supplier)=>{
    const delivery=deliveriesBySupplier.get(supplier.id)??[];
    const receipt=receiptBySupplier.get(supplier.id);
    const cost=costBySupplier.get(supplier.id);
    const qualityRows=qualityBySupplier.get(supplier.id)??[];
    const ncrById=new Map<string,QualityRow>();
    const capaById=new Map<string,QualityRow>();
    for(const row of qualityRows){
      if(row.ncr_id&&!ncrById.has(row.ncr_id)) ncrById.set(row.ncr_id,row);
      if(row.capa_id&&!capaById.has(row.capa_id)) capaById.set(row.capa_id,row);
    }
    const ncrs=[...ncrById.values()];
    const capas=[...capaById.values()];
    const today=new Date().toISOString().slice(0,10);

    return {
      supplierId:supplier.id,
      supplierName:supplier.name,
      completedOrders:delivery.map((row)=>({
        onTime:clean(row.actual_receipt_on)<=clean(row.expected_receipt_on),
        inFull:n(row.received_quantity)+0.0001>=n(row.quantity),
      })),
      receivedQty:n(receipt?.received_qty),
      acceptedQty:n(receipt?.accepted_qty),
      rejectedQty:n(receipt?.rejected_qty),
      ncrCount:ncrs.length,
      openNcrCount:ncrs.filter((row)=>!["closed","rejected"].includes(row.ncr_status)).length,
      majorCriticalNcrCount:ncrs.filter((row)=>["major","critical"].includes(row.severity)).length,
      capaCount:capas.length,
      openCapaCount:capas.filter((row)=>!["closed","rejected"].includes(clean(row.capa_status))).length,
      overdueCapaCount:capas.filter((row)=>row.capa_due_on&&row.capa_due_on<today&&!["closed","rejected"].includes(clean(row.capa_status))).length,
      effectivenessVerifiedCount:capas.filter((row)=>["verified","closed"].includes(clean(row.capa_status))&&clean(row.effectiveness_evidence_ref)).length,
      expectedInvoiceCostInr:n(cost?.expected_invoice_cost_inr),
      actualInvoiceCostInr:n(cost?.actual_invoice_cost_inr),
      receiptCount:n(receipt?.receipt_count),
      traceableReceiptCount:n(receipt?.traceable_receipt_count),
      responseHours:responsesBySupplier.get(supplier.id)??[],
    };
  });

  return buildSupplierPerformanceScorecard({asOf:new Date().toISOString(),suppliers:evidence});
}

export const getSupplierPerformanceState=createServerFn({method:"GET"}).handler(async()=>{
  await requireView();
  const sql=await getSql();
  const [live,suppliers,latestRows]=await Promise.all([
    buildSupplierPerformanceFromSql(sql),
    sql.query<SupplierRow>(\`select id,name from vyndi_suppliers where active=true order by name,id\`),
    sql.query<LatestRunRow>(
      \`select id,result_json,source_reference,actor_role,created_at::text
         from vyndi_supplier_performance_runs
        order by created_at desc,id desc limit 1\`,
    ),
  ]);
  const latest=latestRows[0];
  return {
    live,
    suppliers,
    latest:latest?{
      id:latest.id,
      result:latest.result_json,
      sourceReference:latest.source_reference,
      actorRole:latest.actor_role,
      createdAt:latest.created_at,
    }:null,
  };
});

export type SupplierPerformanceState={
  live:SupplierPerformanceResult;
  suppliers:SupplierOption[];
  latest:{
    id:string;
    result:SupplierPerformanceResult;
    sourceReference:string;
    actorRole:string;
    createdAt:string;
  }|null;
};

const responseEventSchema=z.object({
  supplierId:z.string().trim().min(1).max(160),
  requestReference:z.string().trim().min(1).max(300),
  requestType:z.string().trim().min(1).max(160),
  requestedAt:z.string().datetime(),
  respondedAt:z.string().datetime(),
  supersedesEventId:z.string().trim().max(160).nullable().optional(),
  sourceReference:z.string().trim().min(1).max(500),
});

export const recordSupplierResponseEvent=createServerFn({method:"POST"})
  .validator(responseEventSchema)
  .handler(async({data})=>{
    const actor=await requireBusinessActor("edit");
    if(Date.parse(data.respondedAt)<Date.parse(data.requestedAt)) throw new Error("Supplier response cannot precede the governed request timestamp.");
    const sql=await getSql();
    const supplier=await sql.query<{id:string}>(\`select id from vyndi_suppliers where id=$1 and active=true\`,[data.supplierId]);
    if(!supplier[0]) throw new Error("Active supplier not found.");
    if(data.supersedesEventId){
      const prior=await sql.query<{supplier_id:string}>(\`select supplier_id from vyndi_supplier_response_events where id=$1\`,[data.supersedesEventId]);
      if(!prior[0]||prior[0].supplier_id!==data.supplierId) throw new Error("Superseded response event must belong to the same supplier.");
    }
    const id="SUP-RESP-"+crypto.randomUUID();
    await sql.query(
      \`insert into vyndi_supplier_response_events(
        id,supplier_id,request_reference,request_type,requested_at,responded_at,supersedes_event_id,
        source_reference,recorded_by,recorded_role
      ) values($1,$2,$3,$4,$5::timestamptz,$6::timestamptz,$7,$8,$9,$10)\`,
      [id,data.supplierId,data.requestReference,data.requestType,data.requestedAt,data.respondedAt,data.supersedesEventId??null,data.sourceReference,actor.userId,actor.role],
    );
    await sql.query(
      \`insert into vyndi_audit_events(
        id,entity_type,entity_id,action,actor_user_id,actor_role,source_reference,payload_json,correlation_id
      ) values($1,'supplier_response_event',$2,'SUPPLIER_RESPONSE_RECORDED',$3,$4,$5,$6::jsonb,$7)\`,
      [crypto.randomUUID(),id,actor.userId,actor.role,data.sourceReference,JSON.stringify({
        supplierId:data.supplierId,requestReference:data.requestReference,requestType:data.requestType,
        requestedAt:data.requestedAt,respondedAt:data.respondedAt,supersedesEventId:data.supersedesEventId??null,
      }),"SUPPLIER_RESPONSE|"+data.supplierId],
    );
    return {ok:true,id};
  });

export const captureSupplierPerformanceSnapshot=createServerFn({method:"POST"})
  .validator(z.object({sourceReference:z.string().trim().min(1).max(500)}))
  .handler(async({data})=>{
    const actor=await requireBusinessActor("edit");
    const sql=await getSql();
    const result=await buildSupplierPerformanceFromSql(sql);
    const id="SUP-PERF-"+crypto.randomUUID();
    await sql.query(
      \`insert into vyndi_supplier_performance_runs(id,result_json,source_reference,actor_user_id,actor_role)
       values($1,$2::jsonb,$3,$4,$5)\`,
      [id,JSON.stringify(result),data.sourceReference,actor.userId,actor.role],
    );
    await sql.query(
      \`insert into vyndi_audit_events(
        id,entity_type,entity_id,action,actor_user_id,actor_role,source_reference,payload_json,correlation_id
      ) values($1,'supplier_performance_run',$2,'SUPPLIER_PERFORMANCE_CAPTURED',$3,$4,$5,$6::jsonb,'SUPPLIER_PERFORMANCE')\`,
      [crypto.randomUUID(),id,actor.userId,actor.role,data.sourceReference,JSON.stringify(result.summary)],
    );
    return {ok:true,id,result};
  });
