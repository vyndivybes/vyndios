import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getSql } from "@/lib/db";
import { getCommandRole } from "@/lib/command-access";
import { canPerform } from "@/lib/page-access";
import { requireBusinessActor } from "@/lib/business-actor";
import { calculateProcessCapability, forecastDefectProbability } from "@/lib/manufacturing-quality-model";

async function requireView(){
  const role=await getCommandRole();
  if(!role||!canPerform(role,"view")) throw new Error("Manufacturing & Quality Intelligence view permission denied.");
  return role;
}

type Sql=Awaited<ReturnType<typeof getSql>>;
type Row=Record<string,unknown>;

function n(value:unknown){return Number(value??0);}
function clean(value:unknown){return String(value??"").trim();}

async function buildQualityIntelligence(sql:Sql){
  const [inspectionRows,ncrRows,capaRows,releaseRows,measurementRows,costRows]=await Promise.all([
    sql.query<Row>(
      `select inspection_stage,
              coalesce(sum(sample_size),0) as sample_size,
              coalesce(sum(defect_quantity),0) as defect_quantity,
              count(*)::int as inspection_records
         from vyndi_quality_inspections
        group by inspection_stage
        order by inspection_stage`,
    ),
    sql.query<Row>(
      `select count(*)::int as total,
              count(*) filter(where status not in ('closed','rejected'))::int as open,
              count(*) filter(where severity='critical' and status not in ('closed','rejected'))::int as open_critical,
              count(*) filter(where severity='major' and status not in ('closed','rejected'))::int as open_major
         from vyndi_quality_ncrs`,
    ),
    sql.query<Row>(
      `select count(*)::int as total,
              count(*) filter(where status not in ('closed','rejected'))::int as open,
              count(*) filter(where status='verified')::int as verified
         from vyndi_quality_capas`,
    ),
    sql.query<Row>(
      `select count(*) filter(where decision='released' and superseded_at is null)::int as released,
              count(*) filter(where decision='blocked' and superseded_at is null)::int as blocked
         from vyndi_quality_releases`,
    ),
    sql.query<Row>(
      `select id,inspection_id,traveller_id,job_card_id,characteristic_code,characteristic_name,
              unit,measured_value,nominal_value,lower_spec_limit,upper_spec_limit,
              measurement_method,equipment_ref,source_reference,recorded_at
         from vyndi_quality_measurements
        order by characteristic_code,recorded_at,id
        limit 10000`,
    ),
    sql.query<Row>(
      `select count(*)::int as completed_jobs,
              coalesce(sum(completed_quantity),0) as completed_quantity,
              coalesce(sum(scrap_inr),0) as scrap_inr,
              coalesce(sum(rework_inr),0) as rework_inr,
              coalesce(sum(total_actual_cost_inr),0) as total_actual_cost_inr
         from epr_job_cost_snapshots`,
    ),
  ]);

  const stageForecasts=inspectionRows.map((row)=>{
    const forecast=forecastDefectProbability({
      sampleSize:n(row.sample_size),
      defectQuantity:n(row.defect_quantity),
      minSampleSize:20,
    });
    return {
      stage:clean(row.inspection_stage),
      inspectionRecords:n(row.inspection_records),
      sampleSize:n(row.sample_size),
      defectQuantity:n(row.defect_quantity),
      forecast,
    };
  });

  const groups=new Map<string,Row[]>();
  for(const row of measurementRows){
    const key=clean(row.characteristic_code);
    const current=groups.get(key)??[];
    current.push(row);
    groups.set(key,current);
  }
  const capabilities=[...groups.entries()].map(([characteristicCode,rows])=>{
    const lslValues=[...new Set(rows.map((row)=>row.lower_spec_limit==null?null:Number(row.lower_spec_limit)).filter((value):value is number=>value!=null&&Number.isFinite(value)))];
    const uslValues=[...new Set(rows.map((row)=>row.upper_spec_limit==null?null:Number(row.upper_spec_limit)).filter((value):value is number=>value!=null&&Number.isFinite(value)))];
    const specConflict=lslValues.length>1||uslValues.length>1;
    const capability=calculateProcessCapability({
      values:rows.map((row)=>Number(row.measured_value)),
      lowerSpecLimit:specConflict||lslValues.length!==1?null:lslValues[0]!,
      upperSpecLimit:specConflict||uslValues.length!==1?null:uslValues[0]!,
      minSampleSize:30,
    });
    return {
      characteristicCode,
      characteristicName:clean(rows[0]?.characteristic_name),
      unit:clean(rows[0]?.unit),
      specConflict,
      capability:specConflict
        ? {...capability,reason:"Conflicting specification limits exist for this characteristic; capability is withheld until configuration is reconciled."}
        : capability,
      latestSourceReference:clean(rows.at(-1)?.source_reference),
    };
  }).sort((a,b)=>a.characteristicCode.localeCompare(b.characteristicCode));

  const ncr=ncrRows[0]??{};
  const capa=capaRows[0]??{};
  const releases=releaseRows[0]??{};
  const costs=costRows[0]??{};
  const totalCost=n(costs.total_actual_cost_inr);
  const scrap=n(costs.scrap_inr);
  const rework=n(costs.rework_inr);

  return {
    generatedAt:new Date().toISOString(),
    stageForecasts,
    capabilities,
    qualityControl:{
      ncrTotal:n(ncr.total),
      ncrOpen:n(ncr.open),
      ncrOpenCritical:n(ncr.open_critical),
      ncrOpenMajor:n(ncr.open_major),
      capaTotal:n(capa.total),
      capaOpen:n(capa.open),
      capaVerified:n(capa.verified),
      releasedSerials:n(releases.released),
      blockedSerials:n(releases.blocked),
    },
    manufacturingActuals:{
      completedJobs:n(costs.completed_jobs),
      completedQuantity:n(costs.completed_quantity),
      scrapInr:scrap,
      reworkInr:rework,
      totalActualCostInr:totalCost,
      scrapReworkCostPct:totalCost>0?Math.round(((scrap+rework)/totalCost)*1000)/10:null,
    },
    boundaries:[
      "Defect/yield probability is withheld until each inspection stage has at least 20 inspected units.",
      "Cp/Cpk is withheld until a characteristic has at least 30 actual measurements with one consistent lower and upper specification limit.",
      "Observed scrap/rework cost is an actual-cost signal, not a future scrap-rate prediction.",
      "No physical quality probability is inferred from planning assumptions or static control requirements.",
    ],
  };
}

export const getManufacturingQualityIntelligence=createServerFn({method:"GET"}).handler(async()=>{
  await requireView();
  const sql=await getSql();
  const [live,latest]=await Promise.all([
    buildQualityIntelligence(sql),
    sql.query<Row>(
      `select id,result_json,source_reference,actor_role,created_at
         from vyndi_quality_intelligence_runs
        order by created_at desc,id desc limit 1`,
    ),
  ]);
  return {
    live,
    latest:latest[0]?{
      id:clean(latest[0].id),
      result:latest[0].result_json as Awaited<ReturnType<typeof buildQualityIntelligence>>,
      sourceReference:clean(latest[0].source_reference),
      actorRole:clean(latest[0].actor_role),
      createdAt:clean(latest[0].created_at),
    }:null,
  };
});

export const recordQualityMeasurement=createServerFn({method:"POST"})
  .validator(z.object({
    id:z.string().trim().min(2).max(120),
    inspectionId:z.string().trim().max(120).nullable().default(null),
    travellerId:z.string().trim().max(120).nullable().default(null),
    jobCardId:z.string().trim().max(120).nullable().default(null),
    characteristicCode:z.string().trim().min(1).max(120),
    characteristicName:z.string().trim().min(1).max(300),
    unit:z.string().trim().min(1).max(40),
    measuredValue:z.number().finite(),
    nominalValue:z.number().finite().nullable().default(null),
    lowerSpecLimit:z.number().finite().nullable().default(null),
    upperSpecLimit:z.number().finite().nullable().default(null),
    measurementMethod:z.string().trim().min(1).max(300),
    equipmentRef:z.string().trim().max(200).nullable().default(null),
    sourceReference:z.string().trim().min(1).max(500),
  }).superRefine((value,ctx)=>{
    if(value.lowerSpecLimit!=null&&value.upperSpecLimit!=null&&value.lowerSpecLimit>=value.upperSpecLimit){
      ctx.addIssue({code:"custom",message:"Lower specification limit must be below upper specification limit."});
    }
  }))
  .handler(async({data})=>{
    const actor=await requireBusinessActor("edit");
    const sql=await getSql();
    await sql.query(
      `insert into vyndi_quality_measurements(
        id,inspection_id,traveller_id,job_card_id,characteristic_code,characteristic_name,unit,
        measured_value,nominal_value,lower_spec_limit,upper_spec_limit,measurement_method,
        equipment_ref,source_reference,recorded_by,recorded_role
      ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [data.id,data.inspectionId,data.travellerId,data.jobCardId,data.characteristicCode,
       data.characteristicName,data.unit,data.measuredValue,data.nominalValue,data.lowerSpecLimit,
       data.upperSpecLimit,data.measurementMethod,data.equipmentRef,data.sourceReference,
       actor.userId,actor.role],
    );
    await sql.query(
      `insert into vyndi_audit_events(
        id,entity_type,entity_id,entity_revision,action,actor_user_id,actor_role,
        source_reference,payload_json,correlation_id,gate_id
      ) values($1,'quality_measurement',$2,1,'QUALITY_MEASUREMENT_RECORDED',$3,$4,$5,$6::jsonb,$7,'G10-QUALITY')`,
      [crypto.randomUUID(),data.id,actor.userId,actor.role,data.sourceReference,
       JSON.stringify({
         characteristicCode:data.characteristicCode,measuredValue:data.measuredValue,unit:data.unit,
         nominalValue:data.nominalValue,lowerSpecLimit:data.lowerSpecLimit,upperSpecLimit:data.upperSpecLimit,
         inspectionId:data.inspectionId,travellerId:data.travellerId,jobCardId:data.jobCardId,
       }),
       `QUALITY_MEASUREMENT|${data.characteristicCode}`],
    );
    return {ok:true,id:data.id};
  });

export const captureManufacturingQualityIntelligence=createServerFn({method:"POST"})
  .validator(z.object({
    sourceReference:z.string().trim().min(1).max(500),
  }))
  .handler(async({data})=>{
    const actor=await requireBusinessActor("edit");
    const sql=await getSql();
    const result=await buildQualityIntelligence(sql);
    const id="QUALITY-INTEL-"+crypto.randomUUID();
    await sql.query(
      `insert into vyndi_quality_intelligence_runs(
        id,result_json,source_reference,actor_user_id,actor_role
      ) values($1,$2::jsonb,$3,$4,$5)`,
      [id,JSON.stringify(result),data.sourceReference,actor.userId,actor.role],
    );
    await sql.query(
      `insert into vyndi_audit_events(
        id,entity_type,entity_id,action,actor_user_id,actor_role,source_reference,payload_json,correlation_id
      ) values($1,'quality_intelligence_run',$2,'QUALITY_INTELLIGENCE_CAPTURED',$3,$4,$5,$6::jsonb,$7)`,
      [crypto.randomUUID(),id,actor.userId,actor.role,data.sourceReference,
       JSON.stringify({
         stageForecastCount:result.stageForecasts.length,
         capabilityCharacteristicCount:result.capabilities.length,
         ncrOpen:result.qualityControl.ncrOpen,
         capaOpen:result.qualityControl.capaOpen,
       }),
       "QUALITY_INTELLIGENCE"],
    );
    return {ok:true,id,result};
  });
