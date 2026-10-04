import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getSql, type SqlRow } from "@/lib/db";
import { requireBusinessActor } from "@/lib/business-actor";
import { getCommandRole } from "@/lib/command-access";
import { canPerform } from "@/lib/page-access";
import { compileVedmAuthorityGraph, createVedmR3aSeed } from "@/lib/vedm-authority-graph";
import { analyzeEngineeringImpact } from "@/lib/impact-propagation-model";

async function requireView() {
  const role = await getCommandRole();
  if (!role || !canPerform(role, "view")) throw new Error("Engineering impact view permission denied.");
  return role;
}

const list = (value: unknown) => Array.isArray(value) ? value.map(String) : [];

export const getEngineeringImpactState = createServerFn({ method:"GET" }).handler(async () => {
  await requireView();
  const sql=await getSql();
  const graph=compileVedmAuthorityGraph(createVedmR3aSeed(),new Date().toISOString().slice(0,10));
  const recent=await sql.query<SqlRow>(
    `select id,source_node_id,source_repository,source_commit,as_of_date::text,change_reference,
            result_json,actor_user_id,actor_role,created_at
       from vyndi_impact_assessments
      order by created_at desc,id desc
      limit 12`,
  );
  return {
    nodes:[...graph.nodeById.values()].map((node)=>({
      id:node.id,title:node.title,kind:node.kind,domain:node.domain,lifecycle:node.lifecycle,sourceRef:node.sourceRef,
    })).sort((a,b)=>a.domain.localeCompare(b.domain)||a.id.localeCompare(b.id)),
    recent:[...recent],
    source:{repository:graph.sourceRepository,commit:graph.sourceCommit,asOfDate:graph.asOfDate},
  };
});

export const assessEngineeringImpact = createServerFn({ method:"POST" })
  .validator(z.object({
    sourceNodeId:z.string().trim().min(1).max(200),
    changeReference:z.string().trim().min(1).max(800),
  }))
  .handler(async({data})=>{
    const actor=await requireBusinessActor("edit");
    if (!["admin","engineering","qa"].includes(actor.role)) {
      throw new Error("Engineering impact assessment requires Engineering, QA or Admin authority.");
    }
    const sql=await getSql();
    const graph=compileVedmAuthorityGraph(createVedmR3aSeed(),new Date().toISOString().slice(0,10));
    const impact=analyzeEngineeringImpact(graph,data.sourceNodeId);
    if (!impact.valid) throw new Error(impact.issues.join(" "));

    const [taskRows,riskRows]=await Promise.all([
      sql.query<SqlRow>(
        `select id,title,status,required_inputs,required_evidence,risk_ids
           from vyndi_program_tasks
          where program_id='VYNDI-MASTER-PROGRAM'
          order by id`,
      ),
      sql.query<SqlRow>(
        `select id,risk,status,affected_objects,exposure_score
           from vyndi_risk_intelligence
          where status<>'closed'
          order by exposure_score desc nulls last,id`,
      ),
    ]);

    const impactedIds=new Set([
      data.sourceNodeId,
      ...impact.affectedNodes.map((node)=>node.id),
    ]);
    const affectedProgramTasks=taskRows
      .filter((row)=>[
        ...list(row.required_inputs),
        ...list(row.required_evidence),
      ].some((id)=>impactedIds.has(id)))
      .map((row)=>({
        id:String(row.id),title:String(row.title),status:String(row.status),
      }));
    const affectedRisks=riskRows
      .filter((row)=>list(row.affected_objects).some((id)=>impactedIds.has(id)))
      .map((row)=>({
        id:String(row.id),risk:String(row.risk),status:String(row.status),
        exposureScore:row.exposure_score==null?null:Number(row.exposure_score),
      }));

    const result={
      ...impact,
      affectedProgramTasks,
      affectedRisks,
      sourceRepository:graph.sourceRepository,
      sourceCommit:graph.sourceCommit,
      asOfDate:graph.asOfDate,
      changeReference:data.changeReference,
      advisoryOnly:true,
    };
    const id="IMPACT-"+crypto.randomUUID();
    await sql.query(
      `insert into vyndi_impact_assessments(
        id,source_node_id,source_repository,source_commit,as_of_date,change_reference,
        result_json,actor_user_id,actor_role
      ) values($1,$2,$3,$4,$5::date,$6,$7::jsonb,$8,$9)`,
      [id,data.sourceNodeId,graph.sourceRepository,graph.sourceCommit,graph.asOfDate,
       data.changeReference,JSON.stringify(result),actor.userId,actor.role],
    );
    await sql.query(
      `insert into vyndi_audit_events(
        id,entity_type,entity_id,action,actor_user_id,actor_role,source_reference,payload_json,correlation_id
      ) values($1,'engineering_impact_assessment',$2,'ENGINEERING_IMPACT_ASSESSED',$3,$4,$5,$6::jsonb,$7)`,
      [crypto.randomUUID(),id,actor.userId,actor.role,data.changeReference,
       JSON.stringify({
         sourceNodeId:data.sourceNodeId,
         affectedNodeCount:impact.affectedNodes.length,
         evidenceSuspectCount:impact.evidenceSuspectCount,
         releaseGateReviewCount:impact.releaseGateReviewCount,
         affectedProgramTaskIds:affectedProgramTasks.map((item)=>item.id),
         affectedRiskIds:affectedRisks.map((item)=>item.id),
       }),
       `IMPACT|${data.sourceNodeId}`],
    );
    return {ok:true,id,result};
  });
