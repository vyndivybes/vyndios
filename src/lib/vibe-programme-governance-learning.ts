import {traceCausalConsequences,type CausalEdge} from "./vibe-predictive-optimisation.ts";

export type ProgrammeSignal={id:string;domain:string;severity:"low"|"medium"|"high"|"critical";evidenceRef:string;message:string};

export function buildProgrammeExceptions(input:{signals:ProgrammeSignal[];dependencies:CausalEdge[]}){
 const exceptions:Array<{nodeId:string;depth:number;severity:ProgrammeSignal["severity"];message:string;evidenceRefs:string[]}>= [];
 for(const signal of [...input.signals].sort((a,b)=>a.id.localeCompare(b.id))){
  exceptions.push({nodeId:signal.id,depth:0,severity:signal.severity,message:signal.message,evidenceRefs:[signal.evidenceRef]});
  for(const [index,edge] of traceCausalConsequences(signal.id,input.dependencies).entries()){
   if(exceptions.some(row=>row.nodeId===edge.to)) continue;
   exceptions.push({nodeId:edge.to,depth:index+1,severity:signal.severity,message:`${edge.relation} from ${edge.from}`,evidenceRefs:[signal.evidenceRef]});
  }
 }
 return {exceptions,boundary:"Only declared governed dependencies are propagated."};
}

export type DecisionStatus="recommended"|"approved"|"rejected"|"executed";
export type DecisionLedgerEntry={
 id:string;problem:string;recommendation:string;evidenceRefs:string[];
 expectedOutcome:Record<string,number>;status:DecisionStatus;executable:boolean;
 history:Array<{action:string;actorRole:string}>;
};

export function createDecisionLedgerEntry(input:{id:string;problem:string;recommendation:string;evidenceRefs:string[];expectedOutcome:Record<string,number>}):DecisionLedgerEntry{
 return {...input,evidenceRefs:[...new Set(input.evidenceRefs)],status:"recommended",executable:false,history:[]};
}

export function transitionDecision(entry:DecisionLedgerEntry,input:{action:"approve"|"reject"|"execute";actorRole:string;allowedRoles:string[]}):DecisionLedgerEntry{
 if(!input.allowedRoles.includes(input.actorRole)) throw new Error("Decision authority denied for actor role.");
 if(input.action==="approve"){
  if(entry.status!=="recommended") throw new Error("Only a recommended decision may be approved.");
  return {...entry,status:"approved",executable:true,history:[...entry.history,{action:"approved",actorRole:input.actorRole}]};
 }
 if(input.action==="reject"){
  if(entry.status!=="recommended") throw new Error("Only a recommended decision may be rejected.");
  return {...entry,status:"rejected",executable:false,history:[...entry.history,{action:"rejected",actorRole:input.actorRole}]};
 }
 if(entry.status!=="approved"||!entry.executable) throw new Error("Decision must be explicitly approved before execution.");
 return {...entry,status:"executed",executable:false,history:[...entry.history,{action:"executed",actorRole:input.actorRole}]};
}

export function measureDecisionOutcome(input:{expected:Record<string,number>;actual:Record<string,number>;accepted:boolean}){
 const keys=[...new Set([...Object.keys(input.expected),...Object.keys(input.actual)])].sort();
 const variance:Record<string,number|null>={};
 for(const key of keys){
  const expected=input.expected[key],actual=input.actual[key];
  variance[key]=Number.isFinite(expected)&&Number.isFinite(actual)?actual-expected:null;
 }
 return {variance,recommendationAccepted:input.accepted,policyMutationPermitted:false,learningMode:"MEASURE_ONLY" as const};
}

type ExecutiveState={costExposure:number;scheduleExposureDays:number;technicalConfidence:number;qualityBlockers:number;supplyBlockers:number;strategicAlignment:number};
function canonicalStateId(state:ExecutiveState){
 return ["costExposure","scheduleExposureDays","technicalConfidence","qualityBlockers","supplyBlockers","strategicAlignment"]
  .map(key=>`${key}:${state[key as keyof ExecutiveState]}`).join("|");
}
export function buildExecutiveLenses(state:ExecutiveState){
 const sourceStateId=canonicalStateId(state);
 return [
  {role:"CFO",objective:"cash and cost exposure",metric:state.costExposure,sourceStateId},
  {role:"COO",objective:"delivery reliability",metric:state.scheduleExposureDays,sourceStateId},
  {role:"Chief Engineer",objective:"technical confidence",metric:state.technicalConfidence,sourceStateId},
  {role:"Quality",objective:"quality blockers",metric:state.qualityBlockers,sourceStateId},
  {role:"Supply Chain",objective:"supply blockers",metric:state.supplyBlockers,sourceStateId},
  {role:"CEO",objective:"strategic alignment",metric:state.strategicAlignment,sourceStateId},
 ] as const;
}
