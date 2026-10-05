export type OptimisationStatus="optimal"|"feasible"|"infeasible"|"indeterminate"|"error";
export type BindingConstraint={code:string;entityType:string;entityId:string;slack:number;message:string};
export type RelaxationCandidate={constraintId:string;minimumRelaxation:number;unit:string};

export function diagnoseOptimisation(input:{
  status:OptimisationStatus;
  bindingConstraints:BindingConstraint[];
  relaxationCandidates?:RelaxationCandidate[];
}){
  const minimumRelaxations=[...(input.relaxationCandidates??[])]
    .filter((row)=>Number.isFinite(row.minimumRelaxation)&&row.minimumRelaxation>=0)
    .sort((a,b)=>a.minimumRelaxation-b.minimumRelaxation||a.constraintId.localeCompare(b.constraintId));
  return {
    feasible:input.status==="optimal"||input.status==="feasible",
    status:input.status,
    bindingConstraints:[...input.bindingConstraints],
    minimumRelaxations,
    managementDecisionRequired:input.status==="infeasible"&&minimumRelaxations.length>0,
  };
}

export function forecastPercentiles(input:{p50:number|null;p80:number|null;p90:number|null}){
  const valid=(value:number|null)=>value!==null&&Number.isFinite(value);
  return {...input,available:valid(input.p50)&&valid(input.p80)&&valid(input.p90)};
}

export type SensitivityInput={
  variable:string;
  baseline:number;
  changed:number;
  outcomeDelta:number;
};

export function rankSensitivity(rows:SensitivityInput[]){
  return rows
    .map((row)=>({
      ...row,
      magnitude:Math.abs(row.outcomeDelta),
      direction:row.outcomeDelta>0?"worsens" as const:row.outcomeDelta<0?"improves" as const:"neutral" as const,
    }))
    .sort((a,b)=>b.magnitude-a.magnitude||a.variable.localeCompare(b.variable));
}

export type DecisionAlternative={
  id:string;
  cost:number;
  scheduleDays:number;
  risk:number;
  technicalConfidence:number;
  strategicAlignment:number;
};

function noWorse(a:DecisionAlternative,b:DecisionAlternative){
  return a.cost<=b.cost&&a.scheduleDays<=b.scheduleDays&&a.risk<=b.risk&&
    a.technicalConfidence>=b.technicalConfidence&&a.strategicAlignment>=b.strategicAlignment;
}
function strictlyBetter(a:DecisionAlternative,b:DecisionAlternative){
  return a.cost<b.cost||a.scheduleDays<b.scheduleDays||a.risk<b.risk||
    a.technicalConfidence>b.technicalConfidence||a.strategicAlignment>b.strategicAlignment;
}

export function compareDecisionAlternatives(alternatives:DecisionAlternative[]){
  const ordered=[...alternatives].sort((a,b)=>a.id.localeCompare(b.id));
  const dominatedIds=ordered
    .filter((candidate)=>ordered.some((other)=>other.id!==candidate.id&&noWorse(other,candidate)&&strictlyBetter(other,candidate)))
    .map((row)=>row.id);
  const dominated=new Set(dominatedIds);
  return {
    alternatives:ordered,
    paretoEfficientIds:ordered.filter((row)=>!dominated.has(row.id)).map((row)=>row.id),
    dominatedIds,
  };
}

export type CausalEdge={from:string;to:string;relation:string};

export function traceCausalConsequences(root:string,edges:CausalEdge[]){
  const ordered=[...edges].sort((a,b)=>a.from.localeCompare(b.from)||a.to.localeCompare(b.to)||a.relation.localeCompare(b.relation));
  const visited=new Set<string>([root]);
  const queue=[root];
  const result:CausalEdge[]=[];
  while(queue.length){
    const current=queue.shift()!;
    for(const edge of ordered.filter((candidate)=>candidate.from===current)){
      if(visited.has(edge.to)) continue;
      visited.add(edge.to);
      result.push(edge);
      queue.push(edge.to);
    }
  }
  return result;
}
