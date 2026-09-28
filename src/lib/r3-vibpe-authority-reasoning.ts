import type { CompiledVedmAuthorityGraph, VedmAuthorityNode } from "./vedm-authority-graph.ts";

export type VibpeAuthorityClassification="CURRENT_AUTHORITY"|"SUPERSEDED"|"DEVELOPMENT_NOT_RELEASED"|"INSUFFICIENT_EVIDENCE"|"EVIDENCE"|"UNKNOWN";
export function reasonWithVedmAuthority(graph:CompiledVedmAuthorityGraph,nodeId:string){
 const node=graph.nodeById.get(nodeId);
 let classification:VibpeAuthorityClassification="UNKNOWN";
 if(node){
  if(node.kind==="document_revision"&&node.lifecycle==="controlling") classification="CURRENT_AUTHORITY";
  else if(node.lifecycle==="superseded"||node.lifecycle==="historical") classification="SUPERSEDED";
  else if(node.lifecycle==="development") classification="DEVELOPMENT_NOT_RELEASED";
  else if(node.kind==="evidence"&&node.evidenceState==="insufficient") classification="INSUFFICIENT_EVIDENCE";
  else if(node.kind==="evidence") classification="EVIDENCE";
 }
 return {classification,nodeId,sources:node?[node.sourceRef]:[],mayApproveOrRelease:false as const,authorityMutation:"HUMAN_APPROVAL_REQUIRED" as const};
}
export function assessAuthorityImpact(graph:CompiledVedmAuthorityGraph,startNodeId:string){
 const seen=new Set<string>([startNodeId]); const queue=[startNodeId]; const affected:string[]=[];
 while(queue.length){
  const cur=queue.shift()!;
  for(const edge of graph.edges.filter(e=>e.from===cur)){
   if(seen.has(edge.to)) continue;
   seen.add(edge.to); affected.push(edge.to); queue.push(edge.to);
  }
 }
 return {startNodeId,affectedNodeIds:affected.sort(),mutationPerformed:false as const};
}
export function summarizeAuthorityContradictions(graph:CompiledVedmAuthorityGraph){
 return graph.issues.filter(i=>i.code==="MULTIPLE_CONTROLLING_AUTHORITIES"||i.code==="BROKEN_AUTHORITY_EDGE"||i.code==="NO_CONTROLLING_AUTHORITY").map(i=>({code:i.code,message:i.message}));
}
