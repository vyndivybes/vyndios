import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getSql } from "@/lib/db";
import { getCommandRole } from "@/lib/command-access";
import { canPerform } from "@/lib/page-access";
import { requireBusinessActor } from "@/lib/business-actor";
import { analyzeSupplierRiskEvidence } from "@/lib/supplier-risk-model";

type Row=Record<string,unknown>;
type Sql=Awaited<ReturnType<typeof getSql>>;
const clean=(value:unknown)=>String(value??"").trim();
const n=(value:unknown)=>Number(value??0);
const key=(supplier:string,sku:string)=>`${supplier}|${sku}`;

async function requireView(){
  const role=await getCommandRole();
  if(!role||!canPerform(role,"view")) throw new Error("Supplier Risk view permission denied.");
  return role;
}

async function buildSupplierRisk(sql:Sql){
  const [lanes,deliveryEvents,qualityRows]=await Promise.all([
    sql.query<Row>(
      `select lane_revision_id,supplier_id,sku,revision_code,effective_from::text,effective_to::text,
              lead_time_days,moq,order_multiple,alternate_rank,landed_unit_cost_inr,
              reliability,reliability_method,reliability_source_ref,policy_source_ref,source_ref,
              supplier_currency,quality_rating,delivery_rating,supplier_source_ref,capacity_json
         from vyndi_approved_supplier_lanes
        where supplier_approval_status='approved'
          and supplier_active=true
          and effective_from<=current_date
          and (effective_to is null or effective_to>=current_date)
        order by sku,alternate_rank,supplier_id,effective_from desc`,
    ),
    sql.query<Row>(
      `select p.id as purchase_order_id,p.supplier_id,p.sku,p.order_date::text,
              p.expected_receipt_on::text,max(r.received_on)::text as actual_receipt_on,
              (max(r.received_on)-p.expected_receipt_on)::int as delivery_delay_days,
              (max(r.received_on)-p.order_date)::int as actual_lead_time_days
         from vyndi_purchase_orders p
         join vyndi_goods_receipts r on r.purchase_order_id=p.id
        where p.status='received'
        group by p.id,p.supplier_id,p.sku,p.order_date,p.expected_receipt_on
        order by p.supplier_id,p.sku,p.order_date,p.id`,
    ),
    sql.query<Row>(
      `select p.supplier_id,p.sku,
              coalesce(sum(r.quantity_received),0) as received_quantity,
              coalesce(sum(r.quantity_rejected),0) as rejected_quantity
         from vyndi_purchase_orders p
         join vyndi_goods_receipts r on r.purchase_order_id=p.id
        group by p.supplier_id,p.sku
        order by p.supplier_id,p.sku`,
    ),
  ]);

  const suppliersBySku=new Map<string,Set<string>>();
  for(const lane of lanes){
    const sku=clean(lane.sku);
    const suppliers=suppliersBySku.get(sku)??new Set<string>();
    suppliers.add(clean(lane.supplier_id));
    suppliersBySku.set(sku,suppliers);
  }

  const eventsByKey=new Map<string,Row[]>();
  for(const event of deliveryEvents){
    const k=key(clean(event.supplier_id),clean(event.sku));
    const list=eventsByKey.get(k)??[];
    list.push(event);
    eventsByKey.set(k,list);
  }
  const qualityByKey=new Map<string,Row>();
  for(const row of qualityRows){
    qualityByKey.set(key(clean(row.supplier_id),clean(row.sku)),row);
  }

  const laneRisks=lanes.map((lane)=>{
    const supplierId=clean(lane.supplier_id);
    const sku=clean(lane.sku);
    const events=eventsByKey.get(key(supplierId,sku))??[];
    const quality=qualityByKey.get(key(supplierId,sku))??{};
    const risk=analyzeSupplierRiskEvidence({
      approvedLaneCount:suppliersBySku.get(sku)?.size??0,
      governedLeadTimeDays:lane.lead_time_days==null?null:n(lane.lead_time_days),
      governedReliability:lane.reliability==null?null:n(lane.reliability),
      qualityRating:lane.quality_rating==null?null:n(lane.quality_rating),
      deliveryRating:lane.delivery_rating==null?null:n(lane.delivery_rating),
      deliveryDelaysDays:events.map((event)=>n(event.delivery_delay_days)),
      actualLeadTimeDays:events.map((event)=>n(event.actual_lead_time_days)),
      receivedQuantity:n(quality.received_quantity),
      rejectedQuantity:n(quality.rejected_quantity),
    });
    return {
      laneRevisionId:clean(lane.lane_revision_id),
      supplierId,
      sku,
      revisionCode:clean(lane.revision_code),
      alternateRank:n(lane.alternate_rank),
      currency:clean(lane.supplier_currency),
      landedUnitCostInr:n(lane.landed_unit_cost_inr),
      moq:n(lane.moq),
      orderMultiple:n(lane.order_multiple),
      reliabilityMethod:clean(lane.reliability_method),
      reliabilitySourceRef:clean(lane.reliability_source_ref),
      policySourceRef:clean(lane.policy_source_ref),
      sourceRef:clean(lane.source_ref),
      capacity:lane.capacity_json,
      completedDeliveryEvents:events.length,
      receivedQuantity:n(quality.received_quantity),
      rejectedQuantity:n(quality.rejected_quantity),
      risk,
    };
  });

  laneRisks.sort((a,b)=>
    Number(b.risk.singleSource)-Number(a.risk.singleSource)
    || (b.risk.deliveryForecast.expectedLatePct??-1)-(a.risk.deliveryForecast.expectedLatePct??-1)
    || (b.risk.actualLeadTime.meanDriftDays??-Infinity)-(a.risk.actualLeadTime.meanDriftDays??-Infinity)
    || a.sku.localeCompare(b.sku)
    || a.alternateRank-b.alternateRank
  );

  const skuCount=suppliersBySku.size;
  const singleSourceSkus=[...suppliersBySku.entries()]
    .filter(([,suppliers])=>suppliers.size===1)
    .map(([sku])=>sku)
    .sort();
  const deliveryRated=laneRisks.filter((row)=>row.risk.deliveryForecast.available).length;
  const qualityRated=laneRisks.filter((row)=>row.risk.incomingQuality.available).length;
  const driftRated=laneRisks.filter((row)=>row.risk.actualLeadTime.available).length;

  return {
    generatedAt:new Date().toISOString(),
    laneRisks,
    summary:{
      activeApprovedLaneRevisions:laneRisks.length,
      coveredSkus:skuCount,
      singleSourceSkuCount:singleSourceSkus.length,
      singleSourceSkus,
      deliveryForecastRatedLanes:deliveryRated,
      incomingQualityRatedLanes:qualityRated,
      actualLeadTimeRatedLanes:driftRated,
    },
    boundaries:[
      "Single-source exposure is reported as a configuration fact and is never converted into a probability.",
      "Approved lane reliability and supplier quality/delivery ratings remain governed supplier evidence; they are not overwritten by empirical PO/GRN statistics.",
      "Empirical late-delivery probability requires at least five completed PO/GRN events for that supplier and SKU.",
      "Incoming reject probability requires at least twenty received units.",
      "Geographic/geopolitical supplier risk is not inferred because no controlled geographic-risk evidence is currently present in this authority.",
    ],
  };
}

export const getSupplierRiskIntelligence=createServerFn({method:"GET"}).handler(async()=>{
  await requireView();
  const sql=await getSql();
  const [live,latestRows]=await Promise.all([
    buildSupplierRisk(sql),
    sql.query<Row>(
      `select id,result_json,source_reference,actor_role,created_at
         from vyndi_supplier_risk_runs order by created_at desc,id desc limit 1`,
    ),
  ]);
  const latest=latestRows[0];
  return {
    live,
    latest:latest?{
      id:clean(latest.id),
      result:latest.result_json as Awaited<ReturnType<typeof buildSupplierRisk>>,
      sourceReference:clean(latest.source_reference),
      actorRole:clean(latest.actor_role),
      createdAt:clean(latest.created_at),
    }:null,
  };
});

export const captureSupplierRiskIntelligence=createServerFn({method:"POST"})
  .validator(z.object({
    sourceReference:z.string().trim().min(1).max(500),
  }))
  .handler(async({data})=>{
    const actor=await requireBusinessActor("edit");
    const sql=await getSql();
    const result=await buildSupplierRisk(sql);
    const id="SUP-RISK-"+crypto.randomUUID();
    await sql.query(
      `insert into vyndi_supplier_risk_runs(
        id,result_json,source_reference,actor_user_id,actor_role
      ) values($1,$2::jsonb,$3,$4,$5)`,
      [id,JSON.stringify(result),data.sourceReference,actor.userId,actor.role],
    );
    await sql.query(
      `insert into vyndi_audit_events(
        id,entity_type,entity_id,action,actor_user_id,actor_role,source_reference,payload_json,correlation_id
      ) values($1,'supplier_risk_run',$2,'SUPPLIER_RISK_CAPTURED',$3,$4,$5,$6::jsonb,$7)`,
      [crypto.randomUUID(),id,actor.userId,actor.role,data.sourceReference,
       JSON.stringify({
         activeApprovedLaneRevisions:result.summary.activeApprovedLaneRevisions,
         coveredSkus:result.summary.coveredSkus,
         singleSourceSkuCount:result.summary.singleSourceSkuCount,
         deliveryForecastRatedLanes:result.summary.deliveryForecastRatedLanes,
         incomingQualityRatedLanes:result.summary.incomingQualityRatedLanes,
       }),
       "SUPPLIER_RISK"],
    );
    return {ok:true,id,result};
  });
