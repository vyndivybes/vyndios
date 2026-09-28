import { createFileRoute } from "@tanstack/react-router";
import { requireBusinessActor } from "@/lib/business-actor";
import { UnauthorizedError } from "@/lib/auth/verify.server";
import { getSql } from "@/lib/db";
import { compileVedmAuthorityGraph, createVedmR3aSeed } from "@/lib/vedm-authority-graph";
import { compileEngineeringReleasePacket, type R3EvidenceReceipt } from "@/lib/r3-evidence-release";
import { reasonWithVedmAuthority, summarizeAuthorityContradictions } from "@/lib/r3-vibpe-authority-reasoning";
import { compileDigitalProductThread } from "@/lib/r3-digital-product-thread";

function json(body:unknown,status=200){
  return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
}
function asObject(value:unknown):Record<string,unknown>{
  if(value&&typeof value==="object"&&!Array.isArray(value)) return value as Record<string,unknown>;
  if(typeof value==="string"){try{const parsed=JSON.parse(value); return asObject(parsed);}catch{return {};}}
  return {};
}
function splitCsv(value:string|null){return (value??"").split(",").map(v=>v.trim()).filter(Boolean);}

export const Route=createFileRoute("/api/engineering/r3")({
  server:{handlers:{
    GET:async({request})=>{
      let actor;
      try{actor=await requireBusinessActor("view");}
      catch(error){
        if(error instanceof UnauthorizedError||(error instanceof Error&&error.message==="Unauthorized")) return json({ok:false,error:"authentication_required"},401);
        throw error;
      }
      const url=new URL(request.url);
      const asOf=url.searchParams.get("asOf")||new Date().toISOString().slice(0,10);
      const graph=compileVedmAuthorityGraph(createVedmR3aSeed(),asOf);
      const sql=await getSql();
      const [receiptRows,changeRows]=await Promise.all([
        sql.query<Record<string,unknown>>(`select id,fingerprint,payload_json,readiness_status from vyndi_engineering_evidence_receipts order by received_at desc limit 100`),
        sql.query<Record<string,unknown>>(`select id,status from vyndi_engineering_change_requests order by updated_at desc limit 1`),
      ]);
      const evidenceReceipts:R3EvidenceReceipt[]=receiptRows.map((row)=>{
        const payload=asObject(row.payload_json);
        const readiness=asObject(payload.readiness);
        const rawState=String(payload.evidenceState??readiness.status??row.readiness_status??"").toLowerCase();
        return {
          id:String(row.id??""),
          fingerprint:String(row.fingerprint??""),
          sourceCommit:String(payload.sourceCommit??payload.vedmSourceCommit??""),
          gateId:String(payload.gateId??""),
          state:rawState==="sufficient"||rawState==="ready"||rawState==="closed"?"sufficient":"insufficient",
        };
      });
      const workflowStatus=String(changeRows[0]?.status??"draft");
      const releasePacket=compileEngineeringReleasePacket({graph,evidenceReceipts,workflowStatus});
      const focus=url.searchParams.get("node")||graph.authorityByDomain.frame_geometry?.id||"";
      const vibpe=reasonWithVedmAuthority(graph,focus);
      const familyCode=url.searchParams.get("familyCode");
      const variantId=url.searchParams.get("variantId");
      const digitalThread=familyCode&&variantId?compileDigitalProductThread({
        graph,
        product:{familyCode,variantId},
        engineeringBaselineId:url.searchParams.get("engineeringBaselineId")||undefined,
        engineeringChangeIds:splitCsv(url.searchParams.get("engineeringChangeIds")),
        evidenceReceiptIds:splitCsv(url.searchParams.get("evidenceReceiptIds")),
        bomRevision:url.searchParams.get("bomRevision")||undefined,
        jobCardIds:splitCsv(url.searchParams.get("jobCardIds")),
        travellerIds:splitCsv(url.searchParams.get("travellerIds")),
        qualityReleaseIds:splitCsv(url.searchParams.get("qualityReleaseIds")),
      }):null;
      return json({
        ok:true,
        actor:{userId:actor.userId,role:actor.role},
        schema:"VYNDI_R3_ENGINEERING_CONTROL_PLANE_V1",
        authority:{sourceRepository:graph.sourceRepository,sourceCommit:graph.sourceCommit,valid:graph.valid,releaseReady:graph.releaseReady,authorityByDomain:graph.authorityByDomain,blockingGateIds:graph.blockingGateIds},
        workflow:{latestStatus:workflowStatus,segregationOfDutiesRequired:true,waiverPolicy:"SAFETY_CRITICAL_GATES_NOT_WAIVABLE"},
        evidence:{receiptCount:evidenceReceipts.length,appendOnly:true},
        release:{...releasePacket,releaseAuthority:"HUMAN_CONFIGURATION_AUTHORITY"},
        vibpe:{...vibpe,contradictions:summarizeAuthorityContradictions(graph),mutationAuthority:"HUMAN_APPROVAL_REQUIRED"},
        digitalThread,
      });
    }
  }}
});
