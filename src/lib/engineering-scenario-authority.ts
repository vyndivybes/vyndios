import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getSql, type SqlRow } from "@/lib/db";
import { getCommandRole } from "@/lib/command-access";
import { canPerform } from "@/lib/page-access";
import { requireBusinessActor } from "@/lib/business-actor";
import { compileVedmAuthorityGraph, createVedmR3aSeed } from "@/lib/vedm-authority-graph";
import { buildEngineeringScenario } from "@/lib/engineering-scenario-model";
import type { ForecastDependency, ForecastTask } from "@/lib/forecast-model";

const PROGRAM_ID="VYNDI-MASTER-PROGRAM";
const array=(value:unknown)=>Array.isArray(value)?value.map(String):[];

async function requireView(){
  const role=await getCommandRole();
  if(!role||!canPerform(role,"view")) throw new Error("Engineering Scenario view permission denied.");
  return role;
}

async function loadScenarioBasis(){
  const sql=await getSql();
  const [taskRows,dependencyRows,riskRows,recent]=await Promise.all([
    sql.query<SqlRow>(
      `select id,title,status,required_inputs,required_evidence,
              optimistic_days,most_likely_days,pessimistic_days,
              cost_forecast_required,cost_optimistic_lakh,cost_most_likely_lakh,cost_pessimistic_lakh
         from vyndi_program_tasks
        where program_id=$1 order by id`,
      [PROGRAM_ID],
    ),
    sql.query<SqlRow>(
      `select predecessor_id,successor_id,lag_days
         from vyndi_program_dependencies
        where program_id=$1 order by predecessor_id,successor_id`,
      [PROGRAM_ID],
    ),
    sql.query<SqlRow>(
      `select id,risk,status,affected_objects,exposure_score
         from vyndi_risk_intelligence
        where status<>'closed'
        order by exposure_score desc nulls last,id`,
    ),
    sql.query<SqlRow>(
      `select id,scenario_name,source_node_id,target_task_id,source_commit,as_of_date::text,
              assumption_json,baseline_json,scenario_json,impact_json,linked_program_tasks,
              linked_risks,source_reference,actor_role,created_at
         from vyndi_engineering_scenario_runs
        order by created_at desc,id desc limit 10`,
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

  return {sql,taskRows:[...taskRows],riskRows:[...riskRows],tasks,dependencies,recent:[...recent]};
}

export const getEngineeringScenarioState=createServerFn({method:"GET"}).handler(async()=>{
  await requireView();
  const basis=await loadScenarioBasis();
  const graph=compileVedmAuthorityGraph(createVedmR3aSeed(),new Date().toISOString().slice(0,10));
  return {
    nodes:[...graph.nodeById.values()].map((node)=>({
      id:node.id,title:node.title,kind:node.kind,domain:node.domain,lifecycle:node.lifecycle,
    })).sort((a,b)=>a.domain.localeCompare(b.domain)||a.id.localeCompare(b.id)),
    tasks:basis.taskRows.map((row)=>({
      id:String(row.id),title:String(row.title),status:String(row.status),
      optimisticDays:row.optimistic_days==null?null:Number(row.optimistic_days),
      mostLikelyDays:row.most_likely_days==null?null:Number(row.most_likely_days),
      pessimisticDays:row.pessimistic_days==null?null:Number(row.pessimistic_days),
      costForecastRequired:Boolean(row.cost_forecast_required),
      costOptimisticLakh:row.cost_optimistic_lakh==null?null:Number(row.cost_optimistic_lakh),
      costMostLikelyLakh:row.cost_most_likely_lakh==null?null:Number(row.cost_most_likely_lakh),
      costPessimisticLakh:row.cost_pessimistic_lakh==null?null:Number(row.cost_pessimistic_lakh),
    })),
    recent:basis.recent,
    source:{repository:graph.sourceRepository,commit:graph.sourceCommit,asOfDate:graph.asOfDate},
  };
});

const nullablePositive=z.number().positive().nullable();
const nullableNonNegative=z.number().min(0).nullable();

const scenarioSchema=z.object({
  scenarioName:z.string().trim().min(2).max(120),
  sourceNodeId:z.string().trim().min(1).max(200),
  targetTaskId:z.string().trim().max(120).nullable().default(null),
  scheduleOptimisticDays:nullablePositive,
  scheduleMostLikelyDays:nullablePositive,
  schedulePessimisticDays:nullablePositive,
  costOptimisticLakh:nullableNonNegative,
  costMostLikelyLakh:nullableNonNegative,
  costPessimisticLakh:nullableNonNegative,
  sourceReference:z.string().trim().min(1).max(800),
}).superRefine((value,ctx)=>{
  const schedule=[value.scheduleOptimisticDays,value.scheduleMostLikelyDays,value.schedulePessimisticDays];
  const scheduleCount=schedule.filter((item)=>item!=null).length;
  if(scheduleCount!==0&&scheduleCount!==3){
    ctx.addIssue({code:"custom",message:"Schedule scenario requires complete O/M/P values or none."});
  }
  if(scheduleCount===3&&!(schedule[0]!<=schedule[1]!&&schedule[1]!<=schedule[2]!)){
    ctx.addIssue({code:"custom",message:"Schedule scenario must satisfy O ≤ M ≤ P."});
  }

  const cost=[value.costOptimisticLakh,value.costMostLikelyLakh,value.costPessimisticLakh];
  const costCount=cost.filter((item)=>item!=null).length;
  if(costCount!==0&&costCount!==3){
    ctx.addIssue({code:"custom",message:"Cost scenario requires complete O/M/P values or none."});
  }
  if(costCount===3&&!(cost[0]!<=cost[1]!&&cost[1]!<=cost[2]!)){
    ctx.addIssue({code:"custom",message:"Cost scenario must satisfy O ≤ M ≤ P."});
  }
  if((scheduleCount||costCount)&&!value.targetTaskId){
    ctx.addIssue({code:"custom",message:"A target program task is required for scenario schedule/cost overrides."});
  }
});

export const runEngineeringScenario=createServerFn({method:"POST"})
  .validator(scenarioSchema)
  .handler(async({data})=>{
    const actor=await requireBusinessActor("edit");
    if(!["admin","engineering","qa"].includes(actor.role)){
      throw new Error("Engineering Scenario execution requires Engineering, QA or Admin authority.");
    }

    const basis=await loadScenarioBasis();
    const graph=compileVedmAuthorityGraph(createVedmR3aSeed(),new Date().toISOString().slice(0,10));
    const scheduleOverride=data.scheduleOptimisticDays==null?null:{
      optimisticDays:data.scheduleOptimisticDays,
      mostLikelyDays:data.scheduleMostLikelyDays!,
      pessimisticDays:data.schedulePessimisticDays!,
    };
    const costOverride=data.costOptimisticLakh==null?null:{
      optimisticLakh:data.costOptimisticLakh,
      mostLikelyLakh:data.costMostLikelyLakh!,
      pessimisticLakh:data.costPessimisticLakh!,
    };

    const result=buildEngineeringScenario({
      graph,
      tasks:basis.tasks,
      dependencies:basis.dependencies,
      request:{
        sourceNodeId:data.sourceNodeId,
        targetTaskId:data.targetTaskId||null,
        scheduleOverride,
        costOverride,
      },
    });
    if(!result.valid) throw new Error(result.issues.join(" "));

    const impactedIds=new Set([
      data.sourceNodeId,
      ...result.impact.affectedNodes.map((node)=>node.id),
    ]);
    const linkedProgramTasks=basis.taskRows
      .filter((row)=>[
        ...array(row.required_inputs),
        ...array(row.required_evidence),
      ].some((id)=>impactedIds.has(id)))
      .map((row)=>({id:String(row.id),title:String(row.title),status:String(row.status)}));
    const linkedRisks=basis.riskRows
      .filter((row)=>array(row.affected_objects).some((id)=>impactedIds.has(id)))
      .map((row)=>({
        id:String(row.id),risk:String(row.risk),status:String(row.status),
        exposureScore:row.exposure_score==null?null:Number(row.exposure_score),
      }));

    const id="ENG-SCENARIO-"+crypto.randomUUID();
    const assumptions={
      targetTaskId:data.targetTaskId||null,
      scheduleOverride,
      costOverride,
      method:"ENGINEERING_GRAPH_PLUS_PERT",
    };
    await basis.sql.query(
      `insert into vyndi_engineering_scenario_runs(
        id,scenario_name,source_node_id,target_task_id,source_repository,source_commit,as_of_date,
        assumption_json,baseline_json,scenario_json,impact_json,linked_program_tasks,linked_risks,
        source_reference,actor_user_id,actor_role
      ) values($1,$2,$3,$4,$5,$6,$7::date,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb,$12::jsonb,$13::jsonb,$14,$15,$16)`,
      [id,data.scenarioName,data.sourceNodeId,data.targetTaskId||null,graph.sourceRepository,graph.sourceCommit,
       graph.asOfDate,JSON.stringify(assumptions),JSON.stringify(result.baseline),JSON.stringify(result.scenario),
       JSON.stringify(result.impact),JSON.stringify(linkedProgramTasks),JSON.stringify(linkedRisks),
       data.sourceReference,actor.userId,actor.role],
    );
    await basis.sql.query(
      `insert into vyndi_audit_events(
        id,entity_type,entity_id,action,actor_user_id,actor_role,source_reference,payload_json,correlation_id
      ) values($1,'engineering_scenario_run',$2,'ENGINEERING_SCENARIO_CAPTURED',$3,$4,$5,$6::jsonb,$7)`,
      [crypto.randomUUID(),id,actor.userId,actor.role,data.sourceReference,
       JSON.stringify({
         scenarioName:data.scenarioName,sourceNodeId:data.sourceNodeId,targetTaskId:data.targetTaskId||null,
         affectedNodeCount:result.impact.affectedNodes.length,
         evidenceSuspectCount:result.impact.evidenceSuspectCount,
         releaseGateReviewCount:result.impact.releaseGateReviewCount,
         scheduleDelta:result.scheduleDelta,costDelta:result.costDelta,
       }),
       `SCENARIO|${data.sourceNodeId}`],
    );

    return {
      ok:true,id,
      result:{...result,linkedProgramTasks,linkedRisks,scenarioName:data.scenarioName,sourceReference:data.sourceReference},
    };
  });
