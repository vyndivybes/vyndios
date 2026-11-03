/**
 * Narrow, read-only VEDM authority graph export for the signed VAOS bridge.
 * The canonical VEDM seed remains in vedm-authority-graph.ts. This is a
 * repository-reviewed engineering reference, NOT live ERP/PLM release state.
 */
import {compileVedmAuthorityGraph,createVedmR3aSeed} from "./vedm-authority-graph";

function safeAsOf(value: string): string {
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||Number.isNaN(Date.parse(value+"T00:00:00Z"))
    ||new Date(value+"T00:00:00Z").toISOString().slice(0,10)!==value)
  throw new Error("VAOS_VEDM_SNAPSHOT_INVALID_DATE");
 return value;
}
export function projectVedmAuthorityGraphForVaos(asOfDate: string) {
 const date=safeAsOf(asOfDate);
 const graph=compileVedmAuthorityGraph(createVedmR3aSeed(),date);
 const nodes=[...graph.nodeById.values()].slice(0,120).map(n=>({
  id:n.id,kind:n.kind,domain:n.domain,title:n.title,revision:n.revision??null,
  lifecycle:n.lifecycle,sourceRef:n.sourceRef,releaseEffect:n.releaseEffect,
  gateStatus:n.gateStatus??null,evidenceState:n.evidenceState??null,
  effectiveFrom:n.effectiveFrom??null,effectiveTo:n.effectiveTo??null,
 }));
 const allowed=new Set(nodes.map(n=>n.id));
 const edges=graph.edges.filter(e=>allowed.has(e.from)&&allowed.has(e.to)).slice(0,240)
  .map(e=>({from:e.from,to:e.to,relation:e.relation}));
 return {
  schemaVersion:"VYNDI_VEDM_AUTHORITY_READ_V1",
  sourceSchema:graph.schema,
  sourceRepository:graph.sourceRepository,sourceCommit:graph.sourceCommit,asOfDate:date,
  sourceAuthority:"compileVedmAuthorityGraph",
  sourceKind:"reviewed-engineering-reference",
  sourceDataFreshnessCertified:false,
  currentRuntimeAuthorityVerified:false,
  independentSourceVerification:false,
  graphValid:graph.valid,releaseReady:graph.releaseReady,
  blockingGateIds:graph.blockingGateIds.slice(0,40),
  issueCodes:graph.issues.slice(0,40).map(i=>i.code),
  nodes,edges,readOnly:true,actionAuthorized:false,
  businessEffectsExecuted:false,
 };
}
