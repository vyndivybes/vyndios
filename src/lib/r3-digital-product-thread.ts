import type { CompiledVedmAuthorityGraph } from "./vedm-authority-graph.ts";
export type R3ThreadLinkType="ENGINEERING_BASELINE"|"ENGINEERING_CHANGE"|"EVIDENCE_RECEIPT"|"BOM_REVISION"|"JOB_CARD"|"TRAVELLER"|"QUALITY_RELEASE";
export function compileDigitalProductThread(input:{
 graph:CompiledVedmAuthorityGraph;
 product:{familyCode:string;variantId:string};
 engineeringBaselineId?:string;
 engineeringChangeIds?:string[];
 evidenceReceiptIds?:string[];
 bomRevision?:string;
 jobCardIds?:string[];
 travellerIds?:string[];
 qualityReleaseIds?:string[];
}){
 const links:Array<{type:R3ThreadLinkType;id:string}>=[];
 const add=(type:R3ThreadLinkType,ids:(string|undefined)[])=>ids.filter((id):id is string=>Boolean(id?.trim())).forEach(id=>links.push({type,id}));
 add("ENGINEERING_BASELINE",[input.engineeringBaselineId]); add("ENGINEERING_CHANGE",input.engineeringChangeIds??[]);
 add("EVIDENCE_RECEIPT",input.evidenceReceiptIds??[]); add("BOM_REVISION",[input.bomRevision]);
 add("JOB_CARD",input.jobCardIds??[]); add("TRAVELLER",input.travellerIds??[]); add("QUALITY_RELEASE",input.qualityReleaseIds??[]);
 const gaps:string[]=[];
 if(!input.engineeringBaselineId) gaps.push("ENGINEERING_BASELINE");
 if(!(input.evidenceReceiptIds??[]).length) gaps.push("EVIDENCE_RECEIPT");
 if(!(input.qualityReleaseIds??[]).length) gaps.push("QUALITY_RELEASE");
 const authority=input.graph.authorityByDomain.frame_geometry;
 return {
  schema:"VYNDI_DIGITAL_PRODUCT_THREAD_V1" as const,
  authorityNodeId:authority?.id??null,
  authoritySourceCommit:input.graph.sourceCommit,
  lineage:{product:input.product,engineering:{baselineId:input.engineeringBaselineId??null,bomRevision:input.bomRevision??null}},
  links:links.sort((a,b)=>a.type.localeCompare(b.type)||a.id.localeCompare(b.id)),
  gaps,
  complete:Boolean(authority)&&gaps.length===0,
 };
}
