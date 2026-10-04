import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getSql, type Sql } from "@/lib/db";
import { getCommandRole } from "@/lib/command-access";
import { canPerform } from "@/lib/page-access";
import { requireBusinessActor } from "@/lib/business-actor";
import { compileVedmAuthorityGraph, createVedmR3aSeed } from "@/lib/vedm-authority-graph";
import { classifyVedmIssueDomain } from "@/lib/vyndi-risk-model";
import { buildReadinessAssessment, type ReadinessEvidence, type ReadinessRisk, type ReadinessTask } from "@/lib/readiness-model";
import { buildDecisionIntelligence, type DecisionIntelligenceInput } from "@/lib/decision-intelligence-model";

const PROGRAM_ID="VYNDI-MASTER-PROGRAM";
type Row=Record<string,unknown>;
const clean=(value:unknown)=>String(value??"").trim();
const n=(value:unknown)=>Number(value??0);

async function requireView(){
  const role=await getCommandRole();
  if(!role||!canPerform(role,"view")) throw new Error("Decision Intelligence view permission denied.");
  return role;
}

async function loadDecisionBasis(sql:Sql):Promise<DecisionIntelligenceInput>{
  const [taskRows,evidenceRows,riskRows,mcRows,supplierRows,qualityRows]=await Promise.all([
    sql.query<Row>(`select id,domain,status from vyndi_program_tasks where program_id=$1 order by id`,[PROGRAM_ID]),
    sql.query<Row>(`select * from vyndi_readiness_evidence where program_id=$1 order by domain,id`,[PROGRAM_ID]),
    sql.query<Row>(`select id,risk,domain,exposure_score,status,source_reference from vyndi_risk_intelligence where status<>'closed' order by exposure_score desc nulls last,id`),
    sql.query<Row>(`select id,result_json,source_reference from vyndi_monte_carlo_runs where program_id=$1 order by created_at desc,id desc limit 1`,[PROGRAM_ID]),
    sql.query<Row>(`select id,result_json,source_reference from vyndi_supplier_risk_runs order by created_at desc,id desc limit 1`),
    sql.query<Row>(`select id,result_json,source_reference from vyndi_quality_intelligence_runs order by created_at desc,id desc limit 1`),
  ]);

  const graph=compileVedmAuthorityGraph(createVedmR3aSeed(),new Date().toISOString().slice(0,10));
  const requiredVedmEvidence=new Set(
    [...graph.nodeById.values()]
      .filter((node)=>node.kind==="release_gate")
      .flatMap((node)=>node.requiredEvidenceIds??[]),
  );
  const persistedEvidence:ReadinessEvidence[]=evidenceRows.map((row)=>({
    id:clean(row.id),
    domain:clean(row.domain),
    state:clean(row.evidence_state) as ReadinessEvidence["state"],
    confidence:row.confidence==null?null:Number(row.confidence),
    required:Boolean(row.required),
  }));
  const vedmEvidence:ReadinessEvidence[]=[...graph.nodeById.values()]
    .filter((node)=>node.kind==="evidence"&&requiredVedmEvidence.has(node.id))
    .map((node)=>({
      id:node.id,
      domain:node.domain,
      state:node.evidenceState==="sufficient"?"sufficient":node.evidenceState==="not_applicable"?"not_applicable":"insufficient",
      confidence:null,
      required:true,
    }));
  const tasks:ReadinessTask[]=taskRows.map((row)=>({
    id:clean(row.id),
    domain:clean(row.domain)||"program",
    status:clean(row.status),
    readinessRequired:true,
  }));
  const risks:ReadinessRisk[]=riskRows.map((row)=>({
    id:clean(row.id),
    exposureScore:row.exposure_score==null?null:Number(row.exposure_score),
    status:clean(row.status),
  }));
  const configurationBlockers=graph.issues.filter(
    (issue)=>classifyVedmIssueDomain(issue.code)==="configuration"&&issue.severity!=="warning",
  ).length;
  const readiness=buildReadinessAssessment({
    tasks,
    evidence:[...persistedEvidence,...vedmEvidence],
    activeRisks:risks,
    configurationBlockers,
  });

  const mcRow=mcRows[0];
  const mcResult=(mcRow?.result_json??{}) as Record<string,unknown>;
  const mcSchedule=(mcResult.schedule??{}) as Record<string,unknown>;

  const supplierRow=supplierRows[0];
  const supplierResult=(supplierRow?.result_json??{}) as Record<string,unknown>;
  const supplierSummary=(supplierResult.summary??{}) as Record<string,unknown>;

  const qualityRow=qualityRows[0];
  const qualityResult=(qualityRow?.result_json??{}) as Record<string,unknown>;
  const qualityControl=(qualityResult.qualityControl??{}) as Record<string,unknown>;
  const capabilities=Array.isArray(qualityResult.capabilities)?qualityResult.capabilities:[];
  const capabilityGapCount=capabilities.filter((item)=>{
    if(!item||typeof item!=="object") return true;
    const capability=(item as Record<string,unknown>).capability;
    if(!capability||typeof capability!=="object") return true;
    return (capability as Record<string,unknown>).available!==true;
  }).length;

  return {
    readiness:{
      taskReadinessPct:readiness.taskReadinessPct,
      evidenceCompletenessPct:readiness.evidenceCompletenessPct,
      evidenceConfidencePct:readiness.evidenceConfidencePct,
      configurationBlockers:readiness.configurationBlockers,
      activeRiskCount:readiness.activeRiskCount,
      highestRiskExposureScore:readiness.highestRiskExposureScore,
    },
    risks:riskRows.slice(0,20).map((row)=>({
      id:clean(row.id),
      domain:clean(row.domain)||"operational",
      exposureScore:row.exposure_score==null?null:Number(row.exposure_score),
      title:clean(row.risk),
      sourceReference:clean(row.source_reference)||null,
    })),
    monteCarlo:{
      available:Boolean(mcRow&&mcSchedule.available===true),
      p50Days:mcSchedule.p50Days==null?null:Number(mcSchedule.p50Days),
      p80Days:mcSchedule.p80Days==null?null:Number(mcSchedule.p80Days),
      p95Days:mcSchedule.p95Days==null?null:Number(mcSchedule.p95Days),
      sourceReference:mcRow?clean(mcRow.source_reference)||clean(mcRow.id):null,
    },
    supplier:{
      singleSourceSkuCount:n(supplierSummary.singleSourceSkuCount),
      singleSourceSkus:Array.isArray(supplierSummary.singleSourceSkus)?supplierSummary.singleSourceSkus.map(String):[],
      sourceReference:supplierRow?clean(supplierRow.source_reference)||clean(supplierRow.id):null,
    },
    quality:{
      openCriticalNcr:n(qualityControl.ncrOpenCritical),
      openMajorNcr:n(qualityControl.ncrOpenMajor),
      capabilityGapCount,
      sourceReference:qualityRow?clean(qualityRow.source_reference)||clean(qualityRow.id):null,
    },
  };
}

export async function buildDecisionIntelligenceFromSql(sql:Sql){
  const basis=await loadDecisionBasis(sql);
  return {basis,result:buildDecisionIntelligence(basis)};
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
