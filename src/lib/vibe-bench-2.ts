import {buildVibeDecisionFoundation} from "./vibe-decision-foundation.ts";
import {diagnoseOptimisation,forecastPercentiles,rankSensitivity,compareDecisionAlternatives,traceCausalConsequences} from "./vibe-predictive-optimisation.ts";
import {buildProgrammeExceptions,createDecisionLedgerEntry,transitionDecision,measureDecisionOutcome,buildExecutiveLenses} from "./vibe-programme-governance-learning.ts";

export type VibeBench2Category="evidence-integrity"|"factual-correctness"|"forecasting"|"optimisation"|"causal-reasoning"|"decision-intelligence"|"governance"|"hallucination-resistance"|"cross-domain-reasoning";
export type VibeBench2Case={id:string;category:VibeBench2Category;criticality:"standard"|"critical";description:string;execute:()=>boolean};

const now=new Date("2026-10-05T12:00:00Z");
const governed=(key:string,value:unknown,source="authority",observedAt="2026-10-05T11:00:00Z")=>({key,value,truthClass:"governed-internal" as const,source,observedAt,maxAgeHours:24});

const cases:VibeBench2Case[]=[];
function add(category:VibeBench2Category,description:string,criticality:"standard"|"critical",execute:()=>boolean){
 cases.push({id:`VB2-${String(cases.length+1).padStart(3,"0")}`,category,criticality,description,execute});
}

for(let i=0;i<15;i++) add("evidence-integrity",`evidence conflict/freshness case ${i+1}`,"critical",()=>{
 const key=`k${i}`; const evidence=i%3===0?[governed(key,i,"A"),governed(key,i+1,"B")]:[governed(key,i)];
 const r=buildVibeDecisionFoundation({question:"q",decisionClass:"audit",evidence,requiredEvidenceKeys:[key],now});
 return i%3===0?r.conflicts.length===1&&r.confidence.level==="LOW":r.conflicts.length===0&&r.missingEvidence.length===0;
});
for(let i=0;i<10;i++) add("factual-correctness",`required governed fact case ${i+1}`,"critical",()=>{
 const key=`fact${i}`; const missing=i%2===1;
 const r=buildVibeDecisionFoundation({question:"q",decisionClass:"fact",evidence:missing?[]:[governed(key,i)],requiredEvidenceKeys:[key],now});
 return missing?r.missingEvidence[0]===key:r.facts[0]?.value===i;
});
for(let i=0;i<12;i++) add("forecasting",`forecast percentile completeness case ${i+1}`,"standard",()=>{
 const complete=i%3!==0; const r=forecastPercentiles({p50:10+i,p80:complete?20+i:null,p90:30+i});
 return r.available===complete&&r.p50===10+i;
});
for(let i=0;i<15;i++) add("optimisation",`optimisation feasibility/relaxation case ${i+1}`,"critical",()=>{
 const infeasible=i%2===0; const r=diagnoseOptimisation({status:infeasible?"infeasible":"optimal",bindingConstraints:[],relaxationCandidates:infeasible?[{constraintId:`C${i}`,minimumRelaxation:i+1,unit:"days"}]:[]});
 return infeasible?(!r.feasible&&r.managementDecisionRequired&&r.minimumRelaxations[0].minimumRelaxation===i+1):(r.feasible&&!r.managementDecisionRequired);
});
for(let i=0;i<12;i++) add("causal-reasoning",`explicit causal graph case ${i+1}`,"critical",()=>{
 const edges=[{from:"A",to:"B",relation:"drives"},{from:"B",to:"C",relation:"delays"},{from:"X",to:"Y",relation:"unrelated"}];
 const r=traceCausalConsequences("A",edges); return r.length===2&&r.every(x=>x.from!=="X");
});
for(let i=0;i<14;i++) add("decision-intelligence",`decision trade-off/sensitivity case ${i+1}`,"standard",()=>{
 if(i%2===0){const r=rankSensitivity([{variable:"a",baseline:1,changed:2,outcomeDelta:2+i},{variable:"b",baseline:1,changed:2,outcomeDelta:-1}]);return r[0].variable==="a"&&r[1].direction==="improves";}
 const r=compareDecisionAlternatives([{id:"A",cost:1,scheduleDays:1,risk:1,technicalConfidence:1,strategicAlignment:1},{id:"B",cost:2,scheduleDays:2,risk:2,technicalConfidence:.5,strategicAlignment:.5}]);return r.dominatedIds[0]==="B";
});
for(let i=0;i<15;i++) add("governance",`approval/RBAC/learning boundary case ${i+1}`,"critical",()=>{
 const d=createDecisionLedgerEntry({id:`D${i}`,problem:"p",recommendation:"r",evidenceRefs:["E"],expectedOutcome:{cost:10}});
 if(i%3===0){try{transitionDecision(d,{action:"approve",actorRole:"viewer",allowedRoles:["approver"]});return false}catch{return !d.executable}}
 if(i%3===1){const a=transitionDecision(d,{action:"approve",actorRole:"approver",allowedRoles:["approver"]});return a.status==="approved"&&a.executable&&d.status==="recommended";}
 const l=measureDecisionOutcome({expected:{cost:10},actual:{cost:12},accepted:true});return l.variance.cost===2&&!l.policyMutationPermitted;
});
for(let i=0;i<15;i++) add("hallucination-resistance",`unsupported evidence case ${i+1}`,"critical",()=>{
 const key=`required${i}`;const r=buildVibeDecisionFoundation({question:"q",decisionClass:"claim",evidence:[],requiredEvidenceKeys:[key],now});return r.missingEvidence.includes(key)&&r.authority.executable===false;
});
for(let i=0;i<12;i++) add("cross-domain-reasoning",`programme propagation/executive reconciliation case ${i+1}`,"standard",()=>{
 if(i%2===0){const r=buildProgrammeExceptions({signals:[{id:"SUPPLY",domain:"supply",severity:"high",evidenceRef:"EV",message:"late"}],dependencies:[{from:"SUPPLY",to:"BUILD",relation:"delays"},{from:"BUILD",to:"RELEASE",relation:"delays"}]});return r.exceptions.length===3&&r.exceptions.every(x=>x.evidenceRefs[0]==="EV");}
 const lenses=buildExecutiveLenses({costExposure:i,scheduleExposureDays:i+1,technicalConfidence:.8,qualityBlockers:0,supplyBlockers:1,strategicAlignment:.9});return lenses.length===6&&new Set(lenses.map(x=>x.sourceStateId)).size===1;
});

export const VIBE_BENCH_2_CASES=Object.freeze(cases);

export function runVibeBench2(){
 const results=VIBE_BENCH_2_CASES.map(test=>{try{return {...test,pass:test.execute()}}catch{return {...test,pass:false}}});
 const categoryScores=Object.fromEntries([...new Set(results.map(x=>x.category))].map(category=>{
  const rows=results.filter(x=>x.category===category);return [category,Math.round(rows.filter(x=>x.pass).length/rows.length*10000)/100];
 }));
 const passed=results.filter(x=>x.pass).length,failed=results.length-passed,criticalFailures=results.filter(x=>!x.pass&&x.criticality==="critical").length;
 const overallScore=Math.round(passed/results.length*10000)/100;
 return {schema:"vibe-bench-2/v1" as const,total:results.length,executed:results.length,passed,failed,criticalFailures,overallScore,categoryScores,certification:criticalFailures===0&&overallScore>=95?"CERTIFIED" as const:"NOT_CERTIFIED" as const,results};
}
