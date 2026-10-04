import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getSql } from "@/lib/db";
import { getCommandRole } from "@/lib/command-access";
import { canPerform } from "@/lib/page-access";
import { requireBusinessActor } from "@/lib/business-actor";
import { runMonteCarloForecast } from "@/lib/monte-carlo-model";
import type { ForecastDependency, ForecastTask } from "@/lib/forecast-model";

const PROGRAM_ID="VYNDI-MASTER-PROGRAM";

async function requireView(){
  const role=await getCommandRole();
  if(!role||!canPerform(role,"view")) throw new Error("Monte Carlo view permission denied.");
  return role;
}

async function loadBasis(){
  const sql=await getSql();
  const [taskRows,dependencyRows,latestRows]=await Promise.all([
    sql.query<Record<string,unknown>>(
      `select id,title,optimistic_days,most_likely_days,pessimistic_days,
              cost_forecast_required,cost_optimistic_lakh,cost_most_likely_lakh,cost_pessimistic_lakh,
              source_reference
         from vyndi_program_tasks where program_id=$1 order by id`,
      [PROGRAM_ID],
    ),
    sql.query<Record<string,unknown>>(
      `select predecessor_id,successor_id,lag_days
         from vyndi_program_dependencies where program_id=$1
         order by predecessor_id,successor_id`,
      [PROGRAM_ID],
    ),
    sql.query<Record<string,unknown>>(
      `select id,method,iterations,seed,input_json,result_json,source_reference,
              actor_role,created_at
         from vyndi_monte_carlo_runs where program_id=$1
         order by created_at desc,id desc limit 1`,
      [PROGRAM_ID],
    ),
  ]);
  const tasks:ForecastTask[]=taskRows.map((row)=>({
    id:String(row.id),
    optimisticDays:row.optimistic_days==null?null:Number(row.optimistic_days),
    mostLikelyDays:row.most_likely_days==null?null:Number(row.most_likely_days),
    pessimisticDays:row.pessimistic_days==null?null:Number(row.pessimistic_days),
    costForecastRequired:Boolean(row.cost_forecast_required),
    costOptimisticLakh:row.cost_optimistic_lakh==null?null:Number(row.cost_optimistic_lakh),
    costMostLikelyLakh:row.cost_most_likely_lakh==null?null:Number(row.cost_most_likely_lakh),
    costPessimisticLakh:row.cost_pessimistic_lakh==null?null:Number(row.cost_pessimistic_lakh),
  }));
  const dependencies:ForecastDependency[]=dependencyRows.map((row)=>({
    predecessorId:String(row.predecessor_id),
    successorId:String(row.successor_id),
    lagDays:Number(row.lag_days??0),
  }));
  return {sql,taskRows:[...taskRows],dependenciesRows:[...dependencyRows],tasks,dependencies,latest:latestRows[0]??null};
}

export const getMonteCarloState=createServerFn({method:"GET"}).handler(async()=>{
  await requireView();
  const basis=await loadBasis();
  return {
    taskCount:basis.tasks.length,
    scheduleInputCoveragePct:basis.tasks.length
      ? Math.round((basis.tasks.filter((task)=>task.optimisticDays!=null&&task.mostLikelyDays!=null&&task.pessimisticDays!=null).length/basis.tasks.length)*1000)/10
      : 0,
    costRequiredCount:basis.tasks.filter((task)=>task.costForecastRequired).length,
    latest:basis.latest?{
      id:String(basis.latest.id),
      method:String(basis.latest.method),
      iterations:Number(basis.latest.iterations),
      seed:Number(basis.latest.seed),
      result:basis.latest.result_json as ReturnType<typeof runMonteCarloForecast>,
      sourceReference:String(basis.latest.source_reference),
      createdAt:String(basis.latest.created_at),
    }:null,
  };
});

export const runMonteCarloProgramForecast=createServerFn({method:"POST"})
  .validator(z.object({
    iterations:z.number().int().min(1000).max(50000).default(5000),
    seed:z.number().int().min(1).max(2147483647).default(4210),
    sourceReference:z.string().trim().min(1).max(500),
  }))
  .handler(async({data})=>{
    const actor=await requireBusinessActor("edit");
    const basis=await loadBasis();
    const result=runMonteCarloForecast({
      tasks:basis.tasks,
      dependencies:basis.dependencies,
      iterations:data.iterations,
      seed:data.seed,
    });
    if(!result.available){
      throw new Error(`Monte Carlo withheld: ${result.issues.join(" ")}`);
    }
    const id="MC-"+crypto.randomUUID();
    const input={
      tasks:basis.tasks,
      dependencies:basis.dependencies,
      iterations:data.iterations,
      seed:data.seed,
    };
    await basis.sql.query(
      `insert into vyndi_monte_carlo_runs(
        id,program_id,method,iterations,seed,input_json,result_json,source_reference,actor_user_id,actor_role
      ) values($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10)`,
      [id,PROGRAM_ID,result.method,result.iterations,result.seed,JSON.stringify(input),JSON.stringify(result),
       data.sourceReference,actor.userId,actor.role],
    );
    await basis.sql.query(
      `insert into vyndi_audit_events(
        id,entity_type,entity_id,action,actor_user_id,actor_role,source_reference,payload_json,correlation_id
      ) values($1,'monte_carlo_run',$2,'MONTE_CARLO_RUN_CAPTURED',$3,$4,$5,$6::jsonb,$7)`,
      [crypto.randomUUID(),id,actor.userId,actor.role,data.sourceReference,
       JSON.stringify({
         method:result.method,iterations:result.iterations,seed:result.seed,
         scheduleP50Days:result.schedule.p50Days,scheduleP80Days:result.schedule.p80Days,
         scheduleP95Days:result.schedule.p95Days,costAvailable:result.cost.available,
         costP50Lakh:result.cost.p50Lakh,
       }),
       `MONTE_CARLO|${PROGRAM_ID}`],
    );
    return {ok:true,id,result};
  });
