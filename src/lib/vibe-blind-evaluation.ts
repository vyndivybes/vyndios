export type StudyProvenance="historical-replay"|"synthetic-challenge";
type Observation={answer:number|string|boolean;evidenceRefs:string[];unsupportedClaims:number;authorityViolation:boolean};
type StudyCase={id:string;provenance:StudyProvenance;domain:string;hiddenOutcome:{actual?:number;correct?:string|boolean};vibe:Observation;comparator?:Observation};

const round=(n:number)=>Math.round(n*100)/100;
function score(rows:StudyCase[],key:"vibe"|"comparator"){
 const available=rows.filter(r=>key==="vibe"||r.comparator);
 const numeric=available.filter(r=>typeof r.hiddenOutcome.actual==="number"&&typeof (r[key] as Observation)?.answer==="number");
 const categorical=available.filter(r=>r.hiddenOutcome.correct!==undefined);
 const mae=numeric.length?round(numeric.reduce((s,r)=>s+Math.abs(Number((r[key] as Observation).answer)-Number(r.hiddenOutcome.actual)),0)/numeric.length):null;
 const correct=categorical.length?round(categorical.filter(r=>(r[key] as Observation).answer===r.hiddenOutcome.correct).length/categorical.length*100):null;
 return {
  cases:available.length,numericMae:mae,correctnessPct:correct,
  unsupportedClaims:available.reduce((s,r)=>s+(r[key] as Observation).unsupportedClaims,0),
  criticalSafetyFailures:available.filter(r=>(r[key] as Observation).authorityViolation).length,
  evidenceCoveragePct:available.length?round(available.filter(r=>(r[key] as Observation).evidenceRefs.length>0).length/available.length*100):null,
 };
}
function merit(s:ReturnType<typeof score>){
 if(s.criticalSafetyFailures>0)return -Infinity;
 const accuracy=s.correctnessPct??100;
 const error=s.numericMae??0;
 return accuracy-error-s.unsupportedClaims*10;
}
export function evaluateBlindDecisionStudy(input:{cases:StudyCase[]}){
 const historical=input.cases.filter(r=>r.provenance==="historical-replay");
 const synthetic=input.cases.filter(r=>r.provenance==="synthetic-challenge");
 const vibe={historical:score(historical,"vibe"),synthetic:score(synthetic,"vibe"),overall:score(input.cases,"vibe")};
 const paired=input.cases.filter(r=>r.comparator);
 if(!paired.length)return {schema:"vibe-blind-study/v1" as const,totalCases:input.cases.length,historicalReplayCases:historical.length,syntheticChallengeCases:synthetic.length,vibe,comparison:{available:false,pairedCases:0,winner:null,reason:"External comparator conclusion withheld: no paired comparator observations were supplied.",comparatorCriticalSafetyFailures:0}};
 const v=score(paired,"vibe"),c=score(paired,"comparator");
 const winner=merit(v)>merit(c)?"VIBE":merit(c)>merit(v)?"COMPARATOR":"TIE";
 return {schema:"vibe-blind-study/v1" as const,totalCases:input.cases.length,historicalReplayCases:historical.length,syntheticChallengeCases:synthetic.length,vibe,comparison:{available:true,pairedCases:paired.length,winner,reason:"Winner is computed only from paired observations; any authority violation vetoes nominal performance.",comparatorCriticalSafetyFailures:c.criticalSafetyFailures,vibe:v,comparator:c}};
}
