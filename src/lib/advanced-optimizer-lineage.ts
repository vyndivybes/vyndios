/**
 * Fail-closed, read-only readiness assessment used by the optimizer UI.
 * The execution endpoint also rechecks every value independently.
 */
export type OptimizerLineagePacket = {
 id:string;
 parent_ibpe_run_id:string;
 source_sha:string;
};
export type OptimizerLineageIbpe = {
 id:string;
 source_sha:string;
};
export type OptimizerLineageIssue = {
 severity:"error";
 code:string;
 message:string;
};
export function assessAdvancedOptimizerLineage(
 packet:OptimizerLineagePacket,
 latestIbpe:OptimizerLineageIbpe|null,
 deployedSourceSha:string,
):{ready:boolean;issues:OptimizerLineageIssue[]} {
 const issues:OptimizerLineageIssue[]=[];
 if(!latestIbpe)issues.push({
  severity:"error",code:"MISSING_LATEST_IBPE",
  message:"No completed governed IBPE run exists. Resolve real production authority or use the separate simulation-only workflow.",
 });
 if(!deployedSourceSha?.trim())issues.push({
  severity:"error",code:"MISSING_DEPLOYED_SOURCE_SHA",
  message:"Current deployed source SHA is unavailable. Optimizer execution is blocked until release provenance is qualified.",
 });
 if(!packet.source_sha?.trim())issues.push({
  severity:"error",code:"MISSING_PACKET_SOURCE_SHA",
  message:"Advanced packet has no source SHA; generate a new governed IBPE snapshot on the current deployment.",
 });
 if(latestIbpe&&packet.parent_ibpe_run_id!==latestIbpe.id)issues.push({
  severity:"error",code:"STALE_OPTIMIZER_IBPE_PARENT",
  message:"Advanced packet does not belong to the latest completed IBPE run. Run governed IBPE and refresh the advanced packet.",
 });
 if(latestIbpe && latestIbpe.source_sha!==packet.source_sha)issues.push({
  severity:"error",code:"STALE_OPTIMIZER_IBPE_SOURCE",
  message:"Advanced packet source SHA differs from latest IBPE run. Run governed IBPE and refresh the advanced packet.",
 });
 if(packet.source_sha?.trim() && deployedSourceSha?.trim() && packet.source_sha!==deployedSourceSha)issues.push({
  severity:"error",code:"STALE_OPTIMIZER_PACKET_SOURCE",
  message:"This advanced packet was built on an older software version. Run governed IBPE and refresh the advanced packet on the current deployment. If the committed-order production gate blocks you, use the separate four-order simulation workflow without changing physical approvals.",
 });
 return {ready:issues.length===0,issues};
}
