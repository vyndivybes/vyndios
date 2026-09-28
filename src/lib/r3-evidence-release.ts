import type { CompiledVedmAuthorityGraph } from "./vedm-authority-graph.ts";

export type R3EvidenceReceipt={id:string;sourceCommit:string;gateId:string;state:"sufficient"|"insufficient";fingerprint:string};
export type R3ReleaseBlocker={code:"OPEN_RELEASE_GATE"|"INSUFFICIENT_EVIDENCE"|"PROVENANCE_MISMATCH"|"WORKFLOW_NOT_APPROVED"|"GRAPH_INVALID";message:string};
export function compileEngineeringReleasePacket(input:{graph:CompiledVedmAuthorityGraph;evidenceReceipts:R3EvidenceReceipt[];workflowStatus:string}){
 const blockers:R3ReleaseBlocker[]=[];
 if(!input.graph.valid) blockers.push({code:"GRAPH_INVALID",message:"Authority graph contains structural errors."});
 if(input.workflowStatus!=="approved"&&input.workflowStatus!=="released") blockers.push({code:"WORKFLOW_NOT_APPROVED",message:"Governed engineering workflow has not reached approval."});
 for(const gateId of input.graph.blockingGateIds) blockers.push({code:"OPEN_RELEASE_GATE",message:`Release gate ${gateId} remains open.`});
 for(const issue of input.graph.issues) if(issue.code==="INSUFFICIENT_EVIDENCE") blockers.push({code:"INSUFFICIENT_EVIDENCE",message:issue.message});
 for(const receipt of input.evidenceReceipts){
  if(receipt.sourceCommit!==input.graph.sourceCommit) blockers.push({code:"PROVENANCE_MISMATCH",message:`Evidence receipt ${receipt.id} does not match pinned VEDM commit.`});
 }
 const ready=blockers.length===0&&input.graph.releaseReady;
 return {
  schema:"VYNDI_ENGINEERING_RELEASE_PACKET_V1" as const,
  sourceRepository:input.graph.sourceRepository,
  sourceCommit:input.graph.sourceCommit,
  verdict:ready?"READY_FOR_HUMAN_RELEASE" as const:"BLOCKED" as const,
  releaseAuthority:"HUMAN_CONFIGURATION_AUTHORITY" as const,
  autoReleased:false as const,
  blockers,
  evidenceReceiptIds:input.evidenceReceipts.map(r=>r.id).sort(),
  blockingGateIds:[...input.graph.blockingGateIds],
 };
}
