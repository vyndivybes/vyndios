import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getSql, type Sql } from "@/lib/db";
import { getCommandRole } from "@/lib/command-access";
import { canPerform, type CommandPermission } from "@/lib/page-access";
import { compareEngineeringBaselines, type EngineeringBaselineSnapshot, type EngineeringBomLine, type EngineeringEffectivityRule } from "@/lib/engineering-change-control-model";

const effectivityTypeSchema=z.enum(["variant","date","serial","sales_order","job_card"]);
const changeClassSchema=z.enum(["form_fit_function","material","bom","process","tooling","documentation","mixed"]);
const ecoStatusSchema=z.enum(["draft","pending_approval","approved","rejected"]);

type EcrRow={
  id:string;family_code:string;variant_id:string|null;from_baseline_id:string|null;target_revision_code:string;
  target_bom_revision:string|null;title:string;reason:string;affected_skus:unknown;status:string;source_ref:string;
};
type BaselineRow={
  id:string;family_code:string;variant_id:string|null;revision_code:string;geometry_ref:string;material_spec:string;
  layup_ref:string|null;alloy_spec:string|null;tooling_ref:string|null;drawing_ref:string;bom_revision:string|null;status:string;
};
type EcoRow={
  id:string;ecr_id:string;from_baseline_id:string|null;target_baseline_id:string;change_class:string;
  target_bom_venture:string|null;target_bom_model_id:string|null;target_bom_revision:string|null;
  implementation_plan:string;verification_plan:string;status:string;record_revision:number|string;source_ref:string;
  created_by:string;submitted_by:string|null;approved_by:string|null;released_by:string|null;released_at:string|null;
  created_at:string;updated_at:string;
};
type EffectivityRow={
  id:string;eco_id:string;effectivity_type:EngineeringEffectivityRule["type"];value_from:string|null;value_to:string|null;
  effective_from:string|null;effective_to:string|null;source_ref:string;created_by:string;created_at:string;
};
type EcnRow={
  id:string;notice_number:string;eco_id:string;ecr_id:string;from_baseline_id:string|null;target_baseline_id:string;
  target_bom_venture:string|null;target_bom_model_id:string|null;target_bom_revision:string|null;change_class:string;
  effectivity_json:unknown;implementation_plan:string;verification_plan:string;source_ref:string;released_by:string;released_at:string;
};
type MappingRow={mapping_id:string;venture:string;model_id:string;bom_revision:string;sku:string;quantity:number|string;unit:string;bom_line_key:string;configuration_option_id:string|null;status:string;effective_from:string|null;effective_to:string|null};
type JobImpactRow={job_card_id:string;sales_order_id:string|null;job_card_status:string;serial_count:number|string;bom_revision:string|null;mapping_id:string;sku:string};
type PoImpactRow={purchase_order_id:string;supplier_id:string|null;sku:string;status:string;job_card_id:string|null;quantity:number|string;unit:string};
type BomReleaseRow={venture:string;model_id:string;bom_revision:string;previous_bom_revision:string|null;released_at:string};

function clean(value:unknown){return String(value??"").trim();}
function number(value:unknown){return Number(value??0);}
function jsonList(value:unknown){
  if(Array.isArray(value)) return value.map(String).filter(Boolean);
  if(typeof value==="string"){try{const parsed=JSON.parse(value);return Array.isArray(parsed)?parsed.map(String).filter(Boolean):[];}catch{return [];}}
  return [];
}
async function permission(required:CommandPermission){
  const role=await getCommandRole();
  if(!role||!canPerform(role,required)) throw new Error("Engineering "+required+" permission denied.");
  return role;
}
function actor(role:string){return "command:"+role;}
function baselineSnapshot(row:BaselineRow):EngineeringBaselineSnapshot{
  return {
    id:row.id,familyCode:row.family_code,variantId:row.variant_id,revisionCode:row.revision_code,
    geometryRef:row.geometry_ref,materialSpec:row.material_spec,layupRef:row.layup_ref,alloySpec:row.alloy_spec,
    toolingRef:row.tooling_ref,drawingRef:row.drawing_ref,bomRevision:row.bom_revision,
  };
}
function effectivityRule(row:EffectivityRow):EngineeringEffectivityRule{
  return {id:row.id,type:row.effectivity_type,valueFrom:row.value_from,valueTo:row.value_to,effectiveFrom:row.effective_from,effectiveTo:row.effective_to};
}
function bomLine(row:MappingRow):EngineeringBomLine{
  return {mappingId:row.mapping_id,sku:row.sku,quantity:number(row.quantity),unit:row.unit,bomLineKey:row.bom_line_key,configurationOptionId:row.configuration_option_id};
}

async function impactForSkus(sql:Sql,skus:string[]){
  const normalized=[...new Set(skus.map((sku)=>sku.trim().toUpperCase()).filter(Boolean))];
  if(!normalized.length) return {mappings:[] as MappingRow[],jobCards:[] as JobImpactRow[],purchaseOrders:[] as PoImpactRow[]};
  const [mappings,jobCards,purchaseOrders]=await Promise.all([
    sql.query<MappingRow>(
      "select id as mapping_id,venture,model_id,bom_revision,upper(sku) as sku,quantity,unit,bom_line_key,configuration_option_id,status,effective_from::text,effective_to::text "+
      "from epr_bom_inventory_mappings where upper(sku)=any($1::text[]) order by sku,model_id,bom_revision,id",[normalized]
    ),
    sql.query<JobImpactRow>(
      "select distinct j.id as job_card_id,j.sales_order_id,j.status as job_card_status,"+
      "(select count(*)::int from epr_travellers t where t.job_card_id=j.id) as serial_count,j.bom_revision,"+
      "m.id as mapping_id,upper(m.sku) as sku "+
      "from epr_production_job_cards j "+
      "cross join lateral jsonb_array_elements_text(coalesce(j.released_mapping_set,'[]'::jsonb)) released(mapping_id) "+
      "join epr_bom_inventory_mappings m on m.id=released.mapping_id "+
      "where j.status<>'cancelled' and upper(m.sku)=any($1::text[]) "+
      "order by j.id,m.sku,m.id",[normalized]
    ),
    sql.query<PoImpactRow>(
      "select id as purchase_order_id,supplier_id,upper(sku) as sku,status,job_card_id,quantity,unit "+
      "from vyndi_purchase_orders where status<>'cancelled' and upper(sku)=any($1::text[]) order by sku,id",[normalized]
    ),
  ]);
  return {mappings,jobCards,purchaseOrders};
}

async function bomLinesFor(sql:Sql,modelId:string|null,bomRevision:string|null){
  if(!modelId||!bomRevision) return [] as EngineeringBomLine[];
  const rows=await sql.query<MappingRow>(
    "select id as mapping_id,venture,model_id,bom_revision,upper(sku) as sku,quantity,unit,bom_line_key,configuration_option_id,status,effective_from::text,effective_to::text "+
    "from epr_bom_inventory_mappings where model_id=$1 and bom_revision=$2 and status in ('active','superseded','draft') order by id",
    [modelId,bomRevision],
  );
  return rows.map(bomLine);
}

export async function buildEngineeringChangeControlFromSql(sql:Sql){
  const [ecrs,baselines,ecos,effectivityRows,ecns,bomReleases]=await Promise.all([
    sql.query<EcrRow>("select id,family_code,variant_id,from_baseline_id,target_revision_code,target_bom_revision,title,reason,affected_skus,status,source_ref from vyndi_engineering_change_requests order by updated_at desc,id"),
    sql.query<BaselineRow>("select id,family_code,variant_id,revision_code,geometry_ref,material_spec,layup_ref,alloy_spec,tooling_ref,drawing_ref,bom_revision,status from vyndi_engineering_baselines order by family_code,updated_at desc,id"),
    sql.query<EcoRow>("select id,ecr_id,from_baseline_id,target_baseline_id,change_class,target_bom_venture,target_bom_model_id,target_bom_revision,implementation_plan,verification_plan,status,record_revision,source_ref,created_by,submitted_by,approved_by,released_by,released_at::text,created_at::text,updated_at::text from vyndi_engineering_change_orders order by updated_at desc,id"),
    sql.query<EffectivityRow>("select id,eco_id,effectivity_type,value_from,value_to,effective_from::text,effective_to::text,source_ref,created_by,created_at::text from vyndi_engineering_change_effectivity order by eco_id,effectivity_type,created_at,id"),
    sql.query<EcnRow>("select id,notice_number,eco_id,ecr_id,from_baseline_id,target_baseline_id,target_bom_venture,target_bom_model_id,target_bom_revision,change_class,effectivity_json,implementation_plan,verification_plan,source_ref,released_by,released_at::text from vyndi_engineering_change_notices order by released_at desc,id"),
    sql.query<BomReleaseRow>("select venture,model_id,bom_revision,previous_bom_revision,released_at::text from vyndi_bom_revision_releases order by released_at desc,venture,model_id,bom_revision"),
  ]);
  const ecrById=new Map(ecrs.map((row)=>[row.id,row]));
  const baselineById=new Map(baselines.map((row)=>[row.id,row]));
  const rulesByEco=new Map<string,EffectivityRow[]>();
  for(const row of effectivityRows){const list=rulesByEco.get(row.eco_id)??[];list.push(row);rulesByEco.set(row.eco_id,list);}
  const noticeByEco=new Map(ecns.map((row)=>[row.eco_id,row]));

  const changeOrders=[] as Array<{
    id:string;ecrId:string;ecrTitle:string;familyCode:string;variantId:string|null;fromBaselineId:string|null;targetBaselineId:string;
    targetRevisionCode:string;changeClass:string;targetBomVenture:string|null;targetBomModelId:string|null;targetBomRevision:string|null;
    implementationPlan:string;verificationPlan:string;status:string;recordRevision:number;sourceReference:string;
    effectivity:EngineeringEffectivityRule[];comparison:ReturnType<typeof compareEngineeringBaselines>|null;
    whereUsed:{mappings:MappingRow[];jobCards:JobImpactRow[];purchaseOrders:PoImpactRow[]};
    notice:{id:string;noticeNumber:string;releasedAt:string;sourceReference:string}|null;
  }>;

  for(const eco of ecos){
    const ecr=ecrById.get(eco.ecr_id);
    const from=ecr?.from_baseline_id?baselineById.get(ecr.from_baseline_id):undefined;
    const target=baselineById.get(eco.target_baseline_id);
    const affectedSkus=ecr?jsonList(ecr.affected_skus):[];
    const whereUsed=await impactForSkus(sql,affectedSkus);
    let comparison:ReturnType<typeof compareEngineeringBaselines>|null=null;
    if(from&&target){
      const [fromBom,toBom]=await Promise.all([
        bomLinesFor(sql,eco.target_bom_model_id,from.bom_revision),
        bomLinesFor(sql,eco.target_bom_model_id,eco.target_bom_revision??target.bom_revision),
      ]);
      comparison=compareEngineeringBaselines({from:baselineSnapshot(from),to:baselineSnapshot(target),fromBom,toBom});
    }
    const notice=noticeByEco.get(eco.id);
    changeOrders.push({
      id:eco.id,ecrId:eco.ecr_id,ecrTitle:ecr?.title??eco.ecr_id,familyCode:ecr?.family_code??target?.family_code??"",variantId:ecr?.variant_id??target?.variant_id??null,
      fromBaselineId:eco.from_baseline_id,targetBaselineId:eco.target_baseline_id,targetRevisionCode:ecr?.target_revision_code??target?.revision_code??"",
      changeClass:eco.change_class,targetBomVenture:eco.target_bom_venture,targetBomModelId:eco.target_bom_model_id,targetBomRevision:eco.target_bom_revision,
      implementationPlan:eco.implementation_plan,verificationPlan:eco.verification_plan,status:eco.status,recordRevision:number(eco.record_revision),sourceReference:eco.source_ref,
      effectivity:(rulesByEco.get(eco.id)??[]).map(effectivityRule),comparison,whereUsed,
      notice:notice?{id:notice.id,noticeNumber:notice.notice_number,releasedAt:notice.released_at,sourceReference:notice.source_ref}:null,
    });
  }

  return {
    approvedEcrs:ecrs.filter((row)=>row.status==="approved").map((row)=>({
      id:row.id,title:row.title,familyCode:row.family_code,variantId:row.variant_id,fromBaselineId:row.from_baseline_id,
      targetRevisionCode:row.target_revision_code,targetBomRevision:row.target_bom_revision,affectedSkus:jsonList(row.affected_skus),sourceReference:row.source_ref,
    })),
    releasedBaselines:baselines.filter((row)=>row.status==="released").map((row)=>({id:row.id,familyCode:row.family_code,variantId:row.variant_id,revisionCode:row.revision_code,bomRevision:row.bom_revision})),
    releasedBomScopes:bomReleases.map((row)=>({venture:row.venture,modelId:row.model_id,bomRevision:row.bom_revision,previousBomRevision:row.previous_bom_revision,releasedAt:row.released_at})),
    changeOrders,
    notices:ecns.map((row)=>({id:row.id,noticeNumber:row.notice_number,ecoId:row.eco_id,ecrId:row.ecr_id,targetBaselineId:row.target_baseline_id,targetBomRevision:row.target_bom_revision,changeClass:row.change_class,releasedAt:row.released_at,sourceReference:row.source_ref})),
    summary:{
      ecoCount:ecos.length,openEcoCount:ecos.filter((row)=>!["released","rejected"].includes(row.status)).length,
      releasedEcnCount:ecns.length,effectivityRuleCount:effectivityRows.length,
      impactedJobCardCount:new Set(changeOrders.flatMap((row)=>row.whereUsed.jobCards.map((item)=>item.job_card_id))).size,
    },
  };
}

export type EngineeringChangeControlState=Awaited<ReturnType<typeof buildEngineeringChangeControlFromSql>>;

export const getEngineeringChangeControlState=createServerFn({method:"GET"}).handler(async()=>{
  await permission("view");
  return buildEngineeringChangeControlFromSql(await getSql());
});

const createEcoSchema=z.object({
  ecrId:z.string().trim().min(1).max(120),targetBaselineId:z.string().trim().min(1).max(120),changeClass:changeClassSchema,
  targetBomVenture:z.enum(["carbon","aluminium"]).nullable().optional(),targetBomModelId:z.string().trim().max(120).nullable().optional(),
  targetBomRevision:z.string().trim().max(120).nullable().optional(),implementationPlan:z.string().trim().min(3).max(2000),
  verificationPlan:z.string().trim().min(3).max(2000),sourceReference:z.string().trim().min(1).max(500),
});

export const createEngineeringChangeOrder=createServerFn({method:"POST"}).validator(createEcoSchema).handler(async({data})=>{
  const role=await permission("edit");
  const sql=await getSql();
  const ecrs=await sql.query<EcrRow>("select id,family_code,variant_id,from_baseline_id,target_revision_code,target_bom_revision,title,reason,affected_skus,status,source_ref from vyndi_engineering_change_requests where id=$1",[data.ecrId]);
  const ecr=ecrs[0];
  if(!ecr||ecr.status!=="approved") throw new Error("ECO requires an approved ECR.");
  const baselines=await sql.query<BaselineRow>("select id,family_code,variant_id,revision_code,geometry_ref,material_spec,layup_ref,alloy_spec,tooling_ref,drawing_ref,bom_revision,status from vyndi_engineering_baselines where id=$1",[data.targetBaselineId]);
  const target=baselines[0];
  if(!target) throw new Error("Target Engineering baseline not found.");
  if(target.family_code!==ecr.family_code||target.variant_id!==ecr.variant_id) throw new Error("Target baseline must match the ECR family/variant scope.");
  if(target.revision_code!==ecr.target_revision_code) throw new Error("Target baseline revision must match the ECR target revision.");
  if(ecr.target_bom_revision&&data.targetBomRevision!==ecr.target_bom_revision) throw new Error("ECO target BOM must match the ECR target BOM revision.");
  if(!ecr.target_bom_revision&&data.targetBomRevision) throw new Error("ECO cannot introduce a target BOM revision that is outside the approved ECR scope.");
  const hasBom=Boolean(data.targetBomRevision);
  if(hasBom&&(!data.targetBomVenture||!data.targetBomModelId)) throw new Error("Target BOM venture and model scope are required when ECO carries a target BOM revision.");
  if(!hasBom&&(data.targetBomVenture||data.targetBomModelId)) throw new Error("BOM venture/model scope cannot be supplied without a target BOM revision.");
  const id="ECO-"+crypto.randomUUID();
  await sql.query(
    "insert into vyndi_engineering_change_orders(id,ecr_id,from_baseline_id,target_baseline_id,change_class,target_bom_venture,target_bom_model_id,target_bom_revision,implementation_plan,verification_plan,status,source_ref,created_by) "+
    "values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'draft',$11,$12)",
    [id,ecr.id,ecr.from_baseline_id,target.id,data.changeClass,data.targetBomVenture??null,data.targetBomModelId??null,data.targetBomRevision??null,data.implementationPlan,data.verificationPlan,data.sourceReference,actor(role)],
  );
  await sql.query(
    "insert into vyndi_audit_events(id,entity_type,entity_id,entity_revision,action,actor_user_id,actor_role,source_reference,payload_json,correlation_id,previous_state,new_state,reason) "+
    "values($1,'engineering_change_order',$2,1,'ECO_CREATED',$3,$4,$5,$6::jsonb,$7,null,'draft','Approved ECR promoted into controlled implementation order.')",
    [crypto.randomUUID(),id,actor(role),role,data.sourceReference,JSON.stringify({ecrId:ecr.id,targetBaselineId:target.id,targetBomRevision:data.targetBomRevision??null,changeClass:data.changeClass}),"ECO|"+id],
  );
  return {ok:true,id,status:"draft" as const};
});

const effectivitySchema=z.object({
  ecoId:z.string().trim().min(1).max(120),type:effectivityTypeSchema,valueFrom:z.string().trim().max(200).nullable().optional(),valueTo:z.string().trim().max(200).nullable().optional(),
  effectiveFrom:z.string().date().nullable().optional(),effectiveTo:z.string().date().nullable().optional(),sourceReference:z.string().trim().min(1).max(500),
});

export const addEngineeringEffectivityRule=createServerFn({method:"POST"}).validator(effectivitySchema).handler(async({data})=>{
  const role=await permission("edit");
  const sql=await getSql();
  const ecos=await sql.query<{status:string;ecr_id:string}>("select status,ecr_id from vyndi_engineering_change_orders where id=$1",[data.ecoId]);
  const eco=ecos[0];
  if(!eco||eco.status!=="draft") throw new Error("Effectivity can only be added while ECO is draft.");
  if(data.type==="date"){
    if(!data.effectiveFrom) throw new Error("Date effectivity requires an effective-from date.");
    if(data.effectiveTo&&data.effectiveTo<data.effectiveFrom) throw new Error("Effectivity end date cannot precede start date.");
  }else{
    if(!data.valueFrom) throw new Error(data.type+" effectivity requires a value.");
    if(data.type!=="serial"&&data.valueTo) throw new Error("Only serial effectivity supports a value range.");
    if(data.type==="serial"&&data.valueTo&&data.valueTo<data.valueFrom) throw new Error("Serial range end cannot precede the start value.");
  }
  if(data.type==="variant"){
    const variants=await sql.query<{id:string}>("select v.variant_id as id from vyndi_product_variants v join vyndi_engineering_change_requests e on e.id=$1 where v.variant_id=$2 and v.family_code=e.family_code and v.active=true",[eco.ecr_id,data.valueFrom]);
    if(!variants[0]) throw new Error("Variant effectivity must reference an active variant in the ECR family.");
  }
  const id="EFFECT-"+crypto.randomUUID();
  await sql.query(
    "insert into vyndi_engineering_change_effectivity(id,eco_id,effectivity_type,value_from,value_to,effective_from,effective_to,source_ref,created_by) "+
    "values($1,$2,$3,$4,$5,$6::date,$7::date,$8,$9)",
    [id,data.ecoId,data.type,data.type==="date"?null:data.valueFrom??null,data.type==="serial"?data.valueTo??null:null,data.type==="date"?data.effectiveFrom??null:null,data.type==="date"?data.effectiveTo??null:null,data.sourceReference,actor(role)],
  );
  return {ok:true,id};
});

const transitionSchema=z.object({ecoId:z.string().trim().min(1).max(120),toStatus:ecoStatusSchema,sourceReference:z.string().trim().min(1).max(500),note:z.string().trim().max(1000).optional()});
export const transitionEngineeringChangeOrder=createServerFn({method:"POST"}).validator(transitionSchema).handler(async({data})=>{
  const decision=data.toStatus==="approved"||data.toStatus==="rejected";
  const role=await permission(decision?"approve":"edit");
  const sql=await getSql();
  const rows=await sql.query<{status:string;record_revision:number|string}>("select status,record_revision from vyndi_engineering_change_orders where id=$1",[data.ecoId]);
  const current=rows[0];
  if(!current) throw new Error("Engineering Change Order not found.");
  const allowed=(current.status==="draft"&&data.toStatus==="pending_approval")||(current.status==="pending_approval"&&["approved","rejected"].includes(data.toStatus));
  if(!allowed) throw new Error("Invalid ECO lifecycle transition: "+current.status+" → "+data.toStatus);
  if(data.toStatus==="pending_approval"){
    const effect=await sql.query<{count:string}>("select count(*)::text as count from vyndi_engineering_change_effectivity where eco_id=$1",[data.ecoId]);
    if(Number(effect[0]?.count??0)===0) throw new Error("ECO cannot be submitted without governed effectivity.");
  }
  const next=number(current.record_revision)+1;
  await sql.query(
    "update vyndi_engineering_change_orders set status=$2,record_revision=$3,submitted_by=case when $2='pending_approval' then $4 else submitted_by end,approved_by=case when $2='approved' then $4 else approved_by end,source_ref=$5,updated_at=now() where id=$1",
    [data.ecoId,data.toStatus,next,actor(role),data.sourceReference],
  );
  await sql.query(
    "insert into vyndi_audit_events(id,entity_type,entity_id,entity_revision,action,actor_user_id,actor_role,source_reference,payload_json,correlation_id,previous_state,new_state,reason) "+
    "values($1,'engineering_change_order',$2,$3,'ECO_STATUS_CHANGED',$4,$5,$6,'{}'::jsonb,$7,$8,$9,$10)",
    [crypto.randomUUID(),data.ecoId,next,actor(role),role,data.sourceReference,"ECO|"+data.ecoId,current.status,data.toStatus,data.note??null],
  );
  return {ok:true,fromStatus:current.status,toStatus:data.toStatus,recordRevision:next};
});

export const releaseEngineeringChangeOrder=createServerFn({method:"POST"}).validator(z.object({ecoId:z.string().trim().min(1).max(120),sourceReference:z.string().trim().min(1).max(500)})).handler(async({data})=>{
  const role=await permission("approve");
  const sql=await getSql();
  const rows=await sql.query<{release_vyndi_engineering_change_order:string}>("select release_vyndi_engineering_change_order($1,$2,$3,$4)",[data.ecoId,data.sourceReference,actor(role),role]);
  return {ok:true,ecnId:rows[0]?.release_vyndi_engineering_change_order??""};
});
