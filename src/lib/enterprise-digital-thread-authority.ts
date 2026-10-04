import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getSql, type Sql } from "@/lib/db";
import { requireBusinessActor } from "@/lib/business-actor";
import { canAccessRoute } from "@/lib/page-access";
import { compileVedmAuthorityGraph, createVedmR3aSeed } from "@/lib/vedm-authority-graph";
import { assessDigitalThreadImpact, compileDigitalProductThread, extendEnterpriseDigitalThread, type DigitalThreadEdge, type DigitalThreadGap, type DigitalThreadNode } from "@/lib/digital-product-thread";

type Row = Record<string, unknown>;
const clean=(value:unknown)=>String(value??"").trim();
const unique=(values:string[])=>[...new Set(values.filter(Boolean))];
const jsonList=(value:unknown)=>{ if(Array.isArray(value)) return value.map(String); if(typeof value==="string"){ try{ const parsed=JSON.parse(value); return Array.isArray(parsed)?parsed.map(String):[]; }catch{return [];} } return []; };
const makeNode=(id:string,kind:DigitalThreadNode["kind"],title:string,sourceRef:string)=>({id,kind,title,sourceRef,current:true});
const makeEdge=(from:string,to:string,relation:DigitalThreadEdge["relation"])=>({from,to,relation});

function referenceCandidate(query:string){
  const tokens=query.trim().split(/\s+/).map((token)=>token.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9._\/-]+$/g,"")).filter(Boolean);
  return tokens.filter((token)=>/\d/.test(token)&&token.length>=4).sort((a,b)=>b.length-a.length)[0] ?? query.trim();
}

async function resolveJobCards(sql:Sql, query:string) {
  const pattern="%"+referenceCandidate(query)+"%";
  const statement =
    "select distinct job_card_id from (" +
    " select c.id as job_card_id from epr_production_job_cards c where c.id ilike $1 or c.sales_order_id ilike $1 or coalesce(c.batch_code,\'\') ilike $1" +
    " union all select t.job_card_id from epr_travellers t where t.job_card_id is not null and (t.id ilike $1 or t.serial_number ilike $1 or coalesce(t.engineering_revision,\'\') ilike $1)" +
    " union all select p.job_card_id from vyndi_purchase_orders p left join vyndi_suppliers s on s.id=p.supplier_id where p.job_card_id is not null and (p.id ilike $1 or p.sku ilike $1 or coalesce(p.supplier_id,\'\') ilike $1 or coalesce(s.name,\'\') ilike $1)" +
    " union all select p.job_card_id from vyndi_goods_receipts g join vyndi_purchase_orders p on p.id=g.purchase_order_id where p.job_card_id is not null and g.id ilike $1" +
    " union all select q.job_card_id from vyndi_quality_releases q where q.job_card_id is not null and (q.id ilike $1 or q.serial_number ilike $1)" +
    " union all select s.job_card_id from vyndi_shipments s where s.job_card_id is not null and s.id ilike $1" +
    " union all select s.job_card_id from vyndi_invoices i join vyndi_shipments s on s.id=i.shipment_id where s.job_card_id is not null and i.id ilike $1" +
    " union all select t.job_card_id from epr_operation_controls oc join epr_travellers t on t.id=oc.traveller_id left join epr_equipment e on e.id=oc.equipment_id left join epr_operators o on o.id=oc.operator_id where t.job_card_id is not null and (coalesce(oc.equipment_id,\'\') ilike $1 or coalesce(e.asset_tag,\'\') ilike $1 or coalesce(oc.operator_id,\'\') ilike $1 or coalesce(o.display_name,\'\') ilike $1)" +
    ") x where job_card_id is not null order by job_card_id limit 12";
  const rows=await sql.query<{job_card_id:string}>(statement,[pattern]);
  return unique(rows.map((row)=>clean(row.job_card_id)));
}

export async function buildEnterpriseDigitalThreadFromSql(sql:Sql,query:string){
  const jobCardIds=await resolveJobCards(sql,query);
  if(!jobCardIds.length){
    return { query, matched:false, rootNodeIds:[] as string[], nodes:[] as DigitalThreadNode[], edges:[] as DigitalThreadEdge[], gaps:[{code:"JOB_CARD_MISSING",message:"No governed job-card lineage matched this reference."}] as DigitalThreadGap[], impact:{changedNodeId:"",affectedNodeIds:[] as string[]}, summary:{jobCards:0,travellers:0,suppliers:0,goodsReceipts:0,qualityReleases:0,shipments:0,risks:0,serialShipmentExact:false} };
  }

  const [jobCards,travellers,purchaseOrders,materialLots,operations,qualityInspections,qualityNcrs,qualityCapas,qualityReleases,shipments,jobCosts]=await Promise.all([
    sql.query<Row>("select c.*,o.variant_name,o.variant_id,o.status as sales_order_status from epr_production_job_cards c left join vyndi_sales_orders o on o.id=c.sales_order_id where c.id=any($1::text[]) order by c.id",[jobCardIds]),
    sql.query<Row>("select * from epr_travellers where job_card_id=any($1::text[]) order by job_card_id,id",[jobCardIds]),
    sql.query<Row>("select p.*,s.name as supplier_name from vyndi_purchase_orders p left join vyndi_suppliers s on s.id=p.supplier_id where p.job_card_id=any($1::text[]) and p.status<>\'cancelled\' order by p.id",[jobCardIds]),
    sql.query<Row>("select l.* from epr_material_lots l join epr_travellers t on t.id=l.traveller_id where t.job_card_id=any($1::text[]) order by l.id",[jobCardIds]),
    sql.query<Row>("select oc.*,e.asset_tag,e.equipment_type,o.display_name as operator_name from epr_operation_controls oc join epr_travellers t on t.id=oc.traveller_id left join epr_equipment e on e.id=oc.equipment_id left join epr_operators o on o.id=oc.operator_id where t.job_card_id=any($1::text[]) order by oc.traveller_id,oc.started_at,oc.id",[jobCardIds]),
    sql.query<Row>("select q.* from vyndi_quality_inspections q where q.job_card_id=any($1::text[]) order by q.recorded_at,q.id",[jobCardIds]),
    sql.query<Row>("select n.* from vyndi_quality_ncrs n where n.job_card_id=any($1::text[]) order by n.created_at,n.id",[jobCardIds]),
    sql.query<Row>("select c.* from vyndi_quality_capas c join vyndi_quality_ncrs n on n.id=c.ncr_id where n.job_card_id=any($1::text[]) order by c.created_at,c.id",[jobCardIds]),
    sql.query<Row>("select * from vyndi_quality_releases where job_card_id=any($1::text[]) and superseded_at is null order by decided_at,id",[jobCardIds]),
    sql.query<Row>("select * from vyndi_shipments where job_card_id=any($1::text[]) and status=\'posted\' order by posted_at,id",[jobCardIds]),
    sql.query<Row>("select * from epr_job_cost_snapshots where job_card_id=any($1::text[]) order by captured_at,id",[jobCardIds]),
  ]);

  const travellerIds=unique(travellers.map((row)=>clean(row.id)));
  const poIds=unique(purchaseOrders.map((row)=>clean(row.id)));
  const supplierIds=unique(purchaseOrders.map((row)=>clean(row.supplier_id)));
  const salesOrderIds=unique(jobCards.map((row)=>clean(row.sales_order_id)));

  const [suppliers,goodsReceipts,fifoLinks,invoices,risks]=await Promise.all([
    supplierIds.length?sql.query<Row>("select * from vyndi_suppliers where id=any($1::text[]) order by id",[supplierIds]):Promise.resolve([] as Row[]),
    poIds.length?sql.query<Row>("select * from vyndi_goods_receipts where purchase_order_id=any($1::text[]) order by created_at,id",[poIds]):Promise.resolve([] as Row[]),
    travellerIds.length&&poIds.length?sql.query<Row>(
      "select distinct g.id as grn_id,fl.id as fifo_layer_id,issue_ledger.movement_id as issue_movement_id,issue_ledger.traveller_id,issue_ledger.sku,a.quantity,a.extended_cost_inr " +
      "from vyndi_goods_receipts g join epr_inventory_ledger receipt_ledger on receipt_ledger.movement_id=g.inventory_movement_id " +
      "join epr_inventory_fifo_layers fl on fl.source_ledger_id=receipt_ledger.id join epr_inventory_fifo_allocations a on a.layer_id=fl.id " +
      "join epr_inventory_ledger issue_ledger on issue_ledger.id=a.issue_ledger_id where g.purchase_order_id=any($1::text[]) and issue_ledger.traveller_id=any($2::text[]) " +
      "order by g.id,fl.id,issue_ledger.movement_id,issue_ledger.traveller_id",[poIds,travellerIds]):Promise.resolve([] as Row[]),
    salesOrderIds.length?sql.query<Row>("select i.* from vyndi_invoices i where i.sales_order_id=any($1::text[]) order by i.plan_month,i.id",[salesOrderIds]):Promise.resolve([] as Row[]),
    sql.query<Row>("select * from vyndi_risk_intelligence where status<>\'closed\' order by exposure_score desc nulls last,id"),
  ]);

  const vedm=compileVedmAuthorityGraph(createVedmR3aSeed(),new Date().toISOString().slice(0,10));
  const firstTraveller=travellers[0];
  const firstJob=jobCards[0];
  let thread=compileDigitalProductThread(vedm,{ engineeringBaselineId:firstTraveller?clean(firstTraveller.engineering_revision)||null:null, bomRevisionId:firstJob?clean(firstJob.bom_revision)||null:null, jobCardIds, qualityReleaseIds:[], shipmentIds:[] });

  const nodes:ReturnType<typeof makeNode>[]=[];
  const edges:ReturnType<typeof makeEdge>[]=[];
  const gaps:DigitalThreadGap[]=[];
  const addNode=(value:ReturnType<typeof makeNode>)=>nodes.push(value);
  const addEdge=(from:string,to:string,relation:DigitalThreadEdge["relation"])=>{if(from&&to)edges.push(makeEdge(from,to,relation));};

  for(const row of jobCards){ const jc=clean(row.id),so=clean(row.sales_order_id); if(so){ addNode(makeNode(so,"sales_order","Sales Order "+so,"VYNDI:sales_order:"+so)); addEdge(so,jc,"EXECUTED_BY"); } }
  for(const row of suppliers) addNode(makeNode(clean(row.id),"supplier",clean(row.name)||clean(row.id),"VYNDI:supplier:"+clean(row.id)));
  for(const row of purchaseOrders){ const id=clean(row.id),supplierId=clean(row.supplier_id),jc=clean(row.job_card_id); addNode(makeNode(id,"purchase_order","Purchase Order "+id,"VYNDI:purchase_order:"+id)); addEdge(supplierId,id,"SUPPLIES"); addEdge(id,jc,"REQUIRES"); }
  for(const row of goodsReceipts){ const id=clean(row.id),po=clean(row.purchase_order_id); addNode(makeNode(id,"goods_receipt","Goods Receipt "+id,"VYNDI:goods_receipt:"+id)); addEdge(po,id,"RECEIVED_AS"); }
  for(const row of fifoLinks){ const grn=clean(row.grn_id),layer=clean(row.fifo_layer_id),movement=clean(row.issue_movement_id),traveller=clean(row.traveller_id); addNode(makeNode(layer,"inventory_lot","FIFO Layer "+layer,"VYNDI:fifo_layer:"+layer)); addNode(makeNode(movement,"inventory_movement","Material Issue "+movement,"VYNDI:inventory_movement:"+movement)); addEdge(grn,layer,"STOCKED_AS"); addEdge(layer,movement,"ALLOCATED_TO"); addEdge(movement,traveller,"CONSUMED_BY"); }
  for(const row of travellers){ const id=clean(row.id),jc=clean(row.job_card_id); addNode(makeNode(id,"traveller","Serial "+clean(row.serial_number)+" · "+id,"VYNDI:traveller:"+id)); addEdge(jc,id,"BUILT_AS"); }
  for(const row of materialLots){ const id=clean(row.id),traveller=clean(row.traveller_id); addNode(makeNode(id,"material_lot","Material lot "+clean(row.lot_number),"VYNDI:material_lot:"+id)); addEdge(id,traveller,"CONSUMED_BY"); }
  for(const row of operations){ const traveller=clean(row.traveller_id),equipment=clean(row.equipment_id),operator=clean(row.operator_id); if(equipment){ addNode(makeNode(equipment,"equipment",clean(row.asset_tag)||equipment,"VYNDI:equipment:"+equipment)); addEdge(equipment,traveller,"USED_BY"); } if(operator){ addNode(makeNode(operator,"operator",clean(row.operator_name)||operator,"VYNDI:operator:"+operator)); addEdge(operator,traveller,"WORKED_ON"); } }
  for(const row of qualityInspections){ const id=clean(row.id),traveller=clean(row.traveller_id); addNode(makeNode(id,"quality_inspection","Quality Inspection "+id,"VYNDI:quality_inspection:"+id)); addEdge(traveller,id,"INSPECTED_BY"); }
  for(const row of qualityNcrs){ const id=clean(row.id),inspection=clean(row.inspection_id); addNode(makeNode(id,"ncr","NCR "+id,"VYNDI:ncr:"+id)); addEdge(inspection,id,"NONCONFORMITY"); }
  for(const row of qualityCapas){ const id=clean(row.id),ncr=clean(row.ncr_id); addNode(makeNode(id,"capa","CAPA "+id,"VYNDI:capa:"+id)); addEdge(ncr,id,"CORRECTED_BY"); }
  for(const row of qualityReleases){ const id=clean(row.id),traveller=clean(row.traveller_id); addNode(makeNode(id,"quality_release","Quality Release "+id,"VYNDI:quality_release:"+id)); addEdge(traveller,id,"RELEASED_BY"); }
  for(const row of shipments){ const id=clean(row.id),jc=clean(row.job_card_id); addNode(makeNode(id,"shipment","Shipment "+id,"VYNDI:shipment:"+id)); addEdge(jc,id,"FULFILLED_BY"); }
  if(shipments.length&&qualityReleases.length){ gaps.push({ code:"SERIAL_SHIPMENT_ALLOCATION_MISSING", message:"Serial → shipment identity is not represented by canonical dispatch authority. Shipment posting proves released quantity at Job Card level, not which released serial was packed into a specific shipment." }); }
  for(const row of invoices){ const id=clean(row.id),shipment=clean(row.shipment_id); addNode(makeNode(id,"invoice","Invoice "+id,"VYNDI:invoice:"+id)); addEdge(shipment,id,"BILLED_BY"); }
  for(const row of jobCosts){ const id=clean(row.id),jc=clean(row.job_card_id); addNode(makeNode(id,"job_cost","Actual Job Cost "+id,"VYNDI:job_cost:"+id)); addEdge(jc,id,"COSTED_BY"); }

  const representedIds=new Set<string>([...jobCardIds,...travellerIds,...poIds,...supplierIds,...salesOrderIds,...nodes.map((item)=>item.id)]);
  for(const row of risks){ const affected=jsonList(row.affected_objects); const matches=affected.filter((id)=>representedIds.has(id)); if(!matches.length) continue; const id=clean(row.id); addNode(makeNode(id,"risk",clean(row.risk)||id,"VYNDI:risk:"+id)); for(const source of matches) addEdge(source,id,"EXPOSES_RISK"); }

  thread=extendEnterpriseDigitalThread(thread,{nodes,edges,gaps});
  const normalized=referenceCandidate(query).toLowerCase();
  const matchedNodes=[...thread.nodeById.values()].filter((item)=>item.id.toLowerCase().includes(normalized)||item.title.toLowerCase().includes(normalized)||item.sourceRef.toLowerCase().includes(normalized));
  const rootNodeIds=matchedNodes.length?matchedNodes.map((item)=>item.id):jobCardIds;
  const root=rootNodeIds[0]??jobCardIds[0]??"";
  const impact=root?assessDigitalThreadImpact(thread,root):{changedNodeId:"",affectedNodeIds:[] as string[]};
  return { query, matched:true, rootNodeIds, nodes:[...thread.nodeById.values()].sort((a,b)=>a.kind.localeCompare(b.kind)||a.id.localeCompare(b.id)), edges:[...thread.edges].sort((a,b)=>a.from.localeCompare(b.from)||a.to.localeCompare(b.to)||a.relation.localeCompare(b.relation)), gaps:thread.gaps, impact, summary:{ jobCards:jobCardIds.length, travellers:travellerIds.length, suppliers:supplierIds.length, goodsReceipts:goodsReceipts.length, qualityReleases:qualityReleases.length, shipments:shipments.length, risks:nodes.filter((item)=>item.kind==="risk").length, serialShipmentExact:false } };
}

export const traceEnterpriseDigitalThread=createServerFn({method:"POST"})
  .validator(z.object({query:z.string().trim().min(1).max(300)}))
  .handler(async({data})=>{ const actor=await requireBusinessActor("view"); if(!canAccessRoute(actor.role,"/command/intelligence")) throw new Error("Enterprise Digital Thread access denied."); const sql=await getSql(); return buildEnterpriseDigitalThreadFromSql(sql,data.query); });
