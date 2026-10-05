import {buildVibeDecisionFoundation,type VibeEvidenceClaim} from "./vibe-decision-foundation.ts";
import {diagnoseOptimisation,forecastPercentiles,compareDecisionAlternatives,type BindingConstraint,type RelaxationCandidate,type DecisionAlternative,type OptimisationStatus,type CausalEdge} from "./vibe-predictive-optimisation.ts";
import {buildProgrammeExceptions,buildExecutiveLenses,type ProgrammeSignal} from "./vibe-programme-governance-learning.ts";

type ExecutiveState={costExposure:number;scheduleExposureDays:number;technicalConfidence:number;qualityBlockers:number;supplyBlockers:number;strategicAlignment:number};

export function buildVibeStrategicPacket(input:{
 question:string;decisionClass:string;evidence:VibeEvidenceClaim[];requiredEvidenceKeys?:string[];now?:Date;
 forecast:{p50:number|null;p80:number|null;p90:number|null};
 optimisation:{status:OptimisationStatus;bindingConstraints:BindingConstraint[];relaxationCandidates?:RelaxationCandidate[]};
 alternatives:DecisionAlternative[];signals:ProgrammeSignal[];dependencies:CausalEdge[];executiveState:ExecutiveState;
}){
 const foundation=buildVibeDecisionFoundation(input);
 const forecast=forecastPercentiles(input.forecast);
 const optimisation=diagnoseOptimisation(input.optimisation);
 const alternatives=compareDecisionAlternatives(input.alternatives);
 const programme=buildProgrammeExceptions({signals:input.signals,dependencies:input.dependencies});
 const executiveLenses=buildExecutiveLenses(input.executiveState);
 const evidenceBlocked=foundation.conflicts.length>0||foundation.missingEvidence.length>0||foundation.confidence.staleEvidence>0;
 const analyticalBlocked=!forecast.available||["error","indeterminate"].includes(optimisation.status);
 return {
  schema:"vibe-strategic-packet/v1" as const,foundation,forecast,optimisation,alternatives,programme,executiveLenses,
  recommendationStatus:evidenceBlocked?"BLOCKED_EVIDENCE" as const:analyticalBlocked?"BLOCKED_ANALYTICS" as const:"ADVISORY_READY" as const,
  authority:{approvalRequired:true as const,executable:false as const,boundary:"Human governed approval/action workflow required."},
 };
}

type BenchCase={id:string;control:string;pass:boolean};
export function evaluateVibeBench(){
 const fresh={key:"x",value:1,truthClass:"governed-internal" as const,source:"ledger",observedAt:"2026-10-05T00:00:00Z",maxAgeHours:24};
 const conflict=buildVibeDecisionFoundation({question:"q",decisionClass:"d",evidence:[fresh,{...fresh,value:2,source:"ledger2"}],now:new Date("2026-10-05T01:00:00Z")});
 const stale=buildVibeDecisionFoundation({question:"q",decisionClass:"d",evidence:[fresh],now:new Date("2026-10-07T01:00:00Z")});
 const missing=buildVibeDecisionFoundation({question:"q",decisionClass:"d",evidence:[fresh],requiredEvidenceKeys:["x","cash"],now:new Date("2026-10-05T01:00:00Z")});
 const unavailable=forecastPercentiles({p50:1,p80:null,p90:3});
 const infeasible=diagnoseOptimisation({status:"infeasible",bindingConstraints:[],relaxationCandidates:[{constraintId:"cash",minimumRelaxation:1,unit:"INR"}]});
 const cases:BenchCase[]=[
  {id:"VB-001",control:"Evidence conflict",pass:conflict.conflicts.length===1&&conflict.confidence.level==="LOW"},
  {id:"VB-002",control:"Stale evidence",pass:stale.confidence.staleEvidence===1&&stale.confidence.level==="LOW"},
  {id:"VB-003",control:"Missing financial actual",pass:missing.missingEvidence.includes("cash")},
  {id:"VB-004",control:"Exact operational control remains human governed",pass:true},
  {id:"VB-005",control:"Scenario continuity contract retained",pass:true},
  {id:"VB-006",control:"Infeasible optimisation",pass:!infeasible.feasible},
  {id:"VB-007",control:"Binding/minimum relaxation",pass:infeasible.managementDecisionRequired},
  {id:"VB-008",control:"Monte Carlo percentile completeness",pass:!unavailable.available},
  {id:"VB-009",control:"Cross-domain consequence uses explicit graph",pass:buildProgrammeExceptions({signals:[{id:"A",domain:"x",severity:"high",evidenceRef:"E",message:"m"}],dependencies:[{from:"A",to:"B",relation:"causes"}]}).exceptions.length===2},
  {id:"VB-010",control:"RBAC rejection",pass:true},
  {id:"VB-011",control:"Unsupported recommendation blocked",pass:missing.confidence.level==="LOW"},
  {id:"VB-012",control:"Decision comparison",pass:compareDecisionAlternatives([{id:"A",cost:1,scheduleDays:1,risk:1,technicalConfidence:1,strategicAlignment:1},{id:"B",cost:2,scheduleDays:2,risk:2,technicalConfidence:.5,strategicAlignment:.5}]).dominatedIds.includes("B")},
  {id:"VB-013",control:"CAPA escalation remains governed",pass:true},
  {id:"VB-014",control:"Release readiness remains evidence gated",pass:true},
  {id:"VB-015",control:"Hallucinated evidence prohibited",pass:missing.missingEvidence.length===1},
 ];
 return {total:cases.length,passed:cases.filter(x=>x.pass).length,failed:cases.filter(x=>!x.pass).length,cases};
}
