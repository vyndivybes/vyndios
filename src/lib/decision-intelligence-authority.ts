import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getSql } from "@/lib/db";
import { getCommandRole } from "@/lib/command-access";
import { canPerform } from "@/lib/page-access";
import { requireBusinessActor } from "@/lib/business-actor";
import { buildDecisionIntelligence } from "@/lib/decision-intelligence-model";
import { buildDecisionIntelligenceFromSql } from "@/lib/decision-intelligence-data";
export { buildDecisionIntelligenceFromSql } from "@/lib/decision-intelligence-data";

type Row=Record<string,unknown>;
const clean=(value:unknown)=>String(value??"").trim();

async function requireView(){
  const role=await getCommandRole();
  if(!role||!canPerform(role,"view")) throw new Error("Decision Intelligence view permission denied.");
  return role;
}
export const getDecisionIntelligenceState=createServerFn({method:"GET"}).handler(async()=>{
  await requireView();
  const sql=await getSql();
  const [live,latestRows]=await Promise.all([
    buildDecisionIntelligenceFromSql(sql),
    sql.query<Row>(`select id,result_json,source_reference,actor_role,created_at from vyndi_decision_intelligence_runs order by created_at desc,id desc limit 1`),
  ]);
  const latest=latestRows[0];
  return {
    live:live.result,
    latest:latest?{
      id:clean(latest.id),
      result:latest.result_json as ReturnType<typeof buildDecisionIntelligence>,
      sourceReference:clean(latest.source_reference),
      actorRole:clean(latest.actor_role),
      createdAt:clean(latest.created_at),
    }:null,
  };
});

export const captureDecisionIntelligence=createServerFn({method:"POST"})
  .validator(z.object({sourceReference:z.string().trim().min(1).max(500)}))
  .handler(async({data})=>{
    const actor=await requireBusinessActor("edit");
    const sql=await getSql();
    const {result}=await buildDecisionIntelligenceFromSql(sql);
    const id="DECISION-INTEL-"+crypto.randomUUID();
    await sql.query(
      `insert into vyndi_decision_intelligence_runs(id,result_json,source_reference,actor_user_id,actor_role)
       values($1,$2::jsonb,$3,$4,$5)`,
      [id,JSON.stringify(result),data.sourceReference,actor.userId,actor.role],
    );
    await sql.query(
      `insert into vyndi_audit_events(
        id,entity_type,entity_id,action,actor_user_id,actor_role,source_reference,payload_json,correlation_id
      ) values($1,'decision_intelligence_run',$2,'DECISION_INTELLIGENCE_CAPTURED',$3,$4,$5,$6::jsonb,$7)`,
      [crypto.randomUUID(),id,actor.userId,actor.role,data.sourceReference,
       JSON.stringify({
         primaryAdvisoryOptionId:result.primaryAdvisoryOptionId,
         optionCount:result.options.length,
         rankingMethod:result.rankingMethod,
       }),
       "DECISION_INTELLIGENCE"],
    );
    return {ok:true,id,result};
  });
