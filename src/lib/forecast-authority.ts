import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getSql } from "@/lib/db";
import { getCommandRole } from "@/lib/command-access";
import { canPerform } from "@/lib/page-access";
import { requireBusinessActor } from "@/lib/business-actor";
import { buildProgramForecast, type ForecastTask, type ForecastDependency } from "@/lib/forecast-model";

const PROGRAM_ID="VYNDI-MASTER-PROGRAM";

async function requireView(){
  const role=await getCommandRole();
  if(!role||!canPerform(role,"view")) throw new Error("Forecast view permission denied.");
  return role;
}

async function loadForecastInputs(){
  const sql=await getSql();
  const [tasks,deps,latest]=await Promise.all([
    sql.query<Record<string,unknown>>(
      `select id,title,planned_start,planned_finish,
              optimistic_days,most_likely_days,pessimistic_days,
              cost_forecast_required,cost_optimistic_lakh,cost_most_likely_lakh,cost_pessimistic_lakh,
              source_reference,record_revision
         from vyndi_program_tasks
        where program_id=$1 order by id`,
      [PROGRAM_ID],
    ),
    sql.query<Record<string,unknown>>(
      `select predecessor_id,successor_id,lag_days
         from vyndi_program_dependencies
        where program_id=$1 order by predecessor_id,successor_id`,
      [PROGRAM_ID],
    ),
    sql.query<Record<string,unknown>>(
      `select id,method,input_json,result_json,source_reference,actor_user_id,actor_role,created_at
         from vyndi_program_forecast_runs
        where program_id=$1 order by created_at desc,id desc limit 1`,
      [PROGRAM_ID],
    ),
  ]);
  const modelTasks:ForecastTask[]=tasks.map((row)=>({
    id:String(row.id),
    optimisticDays:row.optimistic_days==null?null:Number(row.optimistic_days),
    mostLikelyDays:row.most_likely_days==null?null:Number(row.most_likely_days),
    pessimisticDays:row.pessimistic_days==null?null:Number(row.pessimistic_days),
    costForecastRequired:Boolean(row.cost_forecast_required),
    costOptimisticLakh:row.cost_optimistic_lakh==null?null:Number(row.cost_optimistic_lakh),
    costMostLikelyLakh:row.cost_most_likely_lakh==null?null:Number(row.cost_most_likely_lakh),
    costPessimisticLakh:row.cost_pessimistic_lakh==null?null:Number(row.cost_pessimistic_lakh),
  }));
  const modelDeps:ForecastDependency[]=deps.map((row)=>({
    predecessorId:String(row.predecessor_id),
    successorId:String(row.successor_id),
    lagDays:Number(row.lag_days??0),
  }));
  return {sql,tasks:[...tasks],dependencies:[...deps],modelTasks,modelDeps,latest:latest[0]??null};
}

export const getProgramForecastState=createServerFn({method:"GET"}).handler(async()=>{
  await requireView();
  const data=await loadForecastInputs();
  const live=buildProgramForecast({tasks:data.modelTasks,dependencies:data.modelDeps});
  const latest=data.latest ? {
    id:String(data.latest.id),
    method:String(data.latest.method),
    sourceReference:String(data.latest.source_reference),
    createdAt:String(data.latest.created_at),
    result:data.latest.result_json as ReturnType<typeof buildProgramForecast>,
  } : null;
  return {
    tasks:data.tasks,
    dependencies:data.dependencies,
    live,
    latest,
  };
});

export const updateProgramForecastInputs=createServerFn({method:"POST"})
  .validator(z.object({
    taskId:z.string().trim().min(1).max(120),
    optimisticDays:z.number().positive().nullable(),
    mostLikelyDays:z.number().positive().nullable(),
    pessimisticDays:z.number().positive().nullable(),
    costForecastRequired:z.boolean(),
    costOptimisticLakh:z.number().min(0).nullable(),
    costMostLikelyLakh:z.number().min(0).nullable(),
    costPessimisticLakh:z.number().min(0).nullable(),
    sourceReference:z.string().trim().min(1).max(500),
  }).superRefine((value,ctx)=>{
    const s=[value.optimisticDays,value.mostLikelyDays,value.pessimisticDays];
    if(s.every((x)=>x!=null) && !(s[0]!<=s[1]!&&s[1]!<=s[2]!)){
      ctx.addIssue({code:"custom",message:"Schedule estimates must satisfy O ≤ M ≤ P."});
    }
    const cost=[value.costOptimisticLakh,value.costMostLikelyLakh,value.costPessimisticLakh];
    if(cost.every((x)=>x!=null) && !(cost[0]!<=cost[1]!&&cost[1]!<=cost[2]!)){
      ctx.addIssue({code:"custom",message:"Cost estimates must satisfy O ≤ M ≤ P."});
    }
  }))
  .handler(async({data})=>{
    const actor=await requireBusinessActor("edit");
    const sql=await getSql();
    const current=await sql.query<{record_revision:number|string}>(
      `select record_revision from vyndi_program_tasks where id=$1 and program_id=$2 limit 1`,
      [data.taskId,PROGRAM_ID],
    );
    if(!current[0]) throw new Error("Program task not found.");
    const revision=Number(current[0].record_revision)+1;
    await sql.query(
      `update vyndi_program_tasks
          set optimistic_days=$1,most_likely_days=$2,pessimistic_days=$3,
              cost_forecast_required=$4,cost_optimistic_lakh=$5,cost_most_likely_lakh=$6,
              cost_pessimistic_lakh=$7,source_reference=$8,record_revision=$9,
              updated_by=$10,updated_at=now()
        where id=$11 and program_id=$12`,
      [data.optimisticDays,data.mostLikelyDays,data.pessimisticDays,data.costForecastRequired,
       data.costOptimisticLakh,data.costMostLikelyLakh,data.costPessimisticLakh,
       data.sourceReference,revision,actor.userId,data.taskId,PROGRAM_ID],
    );
    await sql.query(
      `insert into vyndi_audit_events(
        id,entity_type,entity_id,entity_revision,action,actor_user_id,actor_role,
        source_reference,payload_json,correlation_id
      ) values($1,'program_task',$2,$3,'PROGRAM_FORECAST_INPUTS_UPDATED',$4,$5,$6,$7::jsonb,$8)`,
      [crypto.randomUUID(),data.taskId,revision,actor.userId,actor.role,data.sourceReference,
       JSON.stringify({
         optimisticDays:data.optimisticDays,mostLikelyDays:data.mostLikelyDays,pessimisticDays:data.pessimisticDays,
         costForecastRequired:data.costForecastRequired,costOptimisticLakh:data.costOptimisticLakh,
         costMostLikelyLakh:data.costMostLikelyLakh,costPessimisticLakh:data.costPessimisticLakh,
       }),
       `FORECAST_INPUT|${data.taskId}`],
    );
    return {ok:true,taskId:data.taskId,revision};
  });

export const runProgramForecast=createServerFn({method:"POST"})
  .validator(z.object({
    sourceReference:z.string().trim().min(1).max(500),
  }))
  .handler(async({data})=>{
    const actor=await requireBusinessActor("edit");
    const loaded=await loadForecastInputs();
    const result=buildProgramForecast({tasks:loaded.modelTasks,dependencies:loaded.modelDeps});
    if(!result.schedule.available && !result.cost.available){
      throw new Error("Forecast withheld: complete governed three-point inputs are not available for schedule or cost.");
    }
    const id="FORECAST-"+crypto.randomUUID();
    const input={
      tasks:loaded.modelTasks,
      dependencies:loaded.modelDeps,
    };
    await loaded.sql.query(
      `insert into vyndi_program_forecast_runs(
        id,program_id,method,input_json,result_json,source_reference,actor_user_id,actor_role
      ) values($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,$8)`,
      [id,PROGRAM_ID,result.method,JSON.stringify(input),JSON.stringify(result),
       data.sourceReference,actor.userId,actor.role],
    );
    await loaded.sql.query(
      `insert into vyndi_audit_events(
        id,entity_type,entity_id,action,actor_user_id,actor_role,source_reference,payload_json,correlation_id
      ) values($1,'program_forecast_run',$2,'PROGRAM_FORECAST_RUN_CAPTURED',$3,$4,$5,$6::jsonb,$7)`,
      [crypto.randomUUID(),id,actor.userId,actor.role,data.sourceReference,
       JSON.stringify({
         method:result.method,
         scheduleAvailable:result.schedule.available,
         scheduleCoveragePct:result.schedule.coveragePct,
         costAvailable:result.cost.available,
         costCoveragePct:result.cost.coveragePct,
       }),
       `FORECAST|${PROGRAM_ID}`],
    );
    return {ok:true,id,result};
  });
