import type { ForecastDependency, ForecastTask } from "./forecast-model.ts";

type MonteCarloInput={
  tasks:ForecastTask[];
  dependencies:ForecastDependency[];
  iterations:number;
  seed:number;
};

type PathFrequency={path:string[];frequencyPct:number;count:number};

const round1=(value:number)=>Math.round(value*10)/10;

export function sampleTriangular(
  min:number,
  mode:number,
  max:number,
  uniform:number,
){
  if(min===max) return min;
  const u=Math.max(0,Math.min(1,uniform));
  if(u===0) return min;
  if(u===1) return max;
  const span=max-min;
  const c=(mode-min)/span;
  if(u<=c){
    return min+Math.sqrt(u*span*(mode-min));
  }
  return max-Math.sqrt((1-u)*span*(max-mode));
}

function rngFromSeed(seed:number){
  let a=(Math.trunc(seed)>>>0)||1;
  return ()=>{
    a|=0;
    a=(a+0x6D2B79F5)|0;
    let t=Math.imul(a^(a>>>15),1|a);
    t=(t+Math.imul(t^(t>>>7),61|t))^t;
    return ((t^(t>>>14))>>>0)/4294967296;
  };
}

function validTriple(a:number|null,b:number|null,c:number|null,allowZero=false){
  if(a==null||b==null||c==null) return false;
  if(!Number.isFinite(a)||!Number.isFinite(b)||!Number.isFinite(c)) return false;
  if(allowZero ? a<0 : a<=0) return false;
  return a<=b&&b<=c;
}

function network(tasks:ForecastTask[],dependencies:ForecastDependency[]){
  const ids=new Set(tasks.map((task)=>task.id));
  if(ids.size!==tasks.length){
    return {valid:false as const,order:[] as string[],predecessors:new Map<string,ForecastDependency[]>(),reason:"Duplicate task IDs prevent Monte Carlo scheduling."};
  }
  const indegree=new Map<string,number>();
  const successors=new Map<string,ForecastDependency[]>();
  const predecessors=new Map<string,ForecastDependency[]>();
  for(const id of ids){
    indegree.set(id,0);
    successors.set(id,[]);
    predecessors.set(id,[]);
  }
  for(const dep of dependencies){
    if(!ids.has(dep.predecessorId)||!ids.has(dep.successorId)){
      return {valid:false as const,order:[] as string[],predecessors,reason:`Broken dependency ${dep.predecessorId} → ${dep.successorId}.`};
    }
    if(dep.predecessorId===dep.successorId||!Number.isFinite(dep.lagDays)||dep.lagDays<0){
      return {valid:false as const,order:[] as string[],predecessors,reason:`Invalid dependency ${dep.predecessorId} → ${dep.successorId}.`};
    }
    successors.get(dep.predecessorId)!.push(dep);
    predecessors.get(dep.successorId)!.push(dep);
    indegree.set(dep.successorId,(indegree.get(dep.successorId)??0)+1);
  }
  const queue=[...ids].filter((id)=>indegree.get(id)===0).sort();
  const order:string[]=[];
  while(queue.length){
    const id=queue.shift()!;
    order.push(id);
    for(const dep of successors.get(id)??[]){
      const remaining=(indegree.get(dep.successorId)??0)-1;
      indegree.set(dep.successorId,remaining);
      if(remaining===0){
        queue.push(dep.successorId);
        queue.sort();
      }
    }
  }
  if(order.length!==ids.size){
    return {valid:false as const,order,predecessors,reason:"Dependency cycle prevents Monte Carlo scheduling."};
  }
  return {valid:true as const,order,predecessors,reason:null};
}

function quantile(values:number[],q:number){
  if(!values.length) return null;
  const sorted=[...values].sort((a,b)=>a-b);
  const position=(sorted.length-1)*q;
  const low=Math.floor(position);
  const high=Math.ceil(position);
  if(low===high) return round1(sorted[low]!);
  const weight=position-low;
  return round1(sorted[low]!*(1-weight)+sorted[high]!*weight);
}

function sampledSchedule(
  order:string[],
  predecessors:Map<string,ForecastDependency[]>,
  durations:Map<string,number>,
){
  const finish=new Map<string,number>();
  const parent=new Map<string,string>();
  for(const id of order){
    let start=0;
    let selected:string|undefined;
    for(const dep of predecessors.get(id)??[]){
      const candidate=(finish.get(dep.predecessorId)??0)+dep.lagDays;
      if(candidate>start||(candidate===start&&(!selected||dep.predecessorId<selected))){
        start=candidate;
        selected=dep.predecessorId;
      }
    }
    finish.set(id,start+(durations.get(id)??0));
    if(selected) parent.set(id,selected);
  }
  let terminal=order[0]??"";
  for(const id of order){
    const current=finish.get(id)??0;
    const best=finish.get(terminal)??0;
    if(current>best||(current===best&&id<terminal)) terminal=id;
  }
  const path:string[]=[];
  let cursor:string|undefined=terminal||undefined;
  while(cursor){
    path.push(cursor);
    cursor=parent.get(cursor);
  }
  path.reverse();
  return {duration:terminal?(finish.get(terminal)??0):0,path};
}

export function runMonteCarloForecast(input:MonteCarloInput){
  const limitations=[
    "Task duration distributions are sampled independently; cross-task correlation is not yet modeled.",
    "Cost distributions are sampled independently from schedule and from one another.",
    "This engine recomputes the critical path on every iteration, so path switching is represented.",
    "Physical engineering response probabilities require explicit governed response models; task O/M/P alone must not be repurposed as material, FEA, fatigue or validation physics.",
  ];

  const missingScheduleTaskIds=input.tasks
    .filter((task)=>!validTriple(task.optimisticDays,task.mostLikelyDays,task.pessimisticDays))
    .map((task)=>task.id)
    .sort();

  const costRequired=input.tasks.filter((task)=>task.costForecastRequired);
  const missingCostTaskIds=costRequired
    .filter((task)=>!validTriple(task.costOptimisticLakh,task.costMostLikelyLakh,task.costPessimisticLakh,true))
    .map((task)=>task.id)
    .sort();

  const graph=network(input.tasks,input.dependencies);
  const iterations=Math.trunc(input.iterations);
  const iterationValid=Number.isFinite(iterations)&&iterations>=100&&iterations<=100000;

  const unavailable=(reason:string)=>({
    method:"MONTE_CARLO_TRIANGULAR_V1" as const,
    available:false,
    iterations:iterationValid?iterations:0,
    seed:Math.trunc(input.seed),
    missingScheduleTaskIds,
    missingCostTaskIds,
    schedule:{
      p50Days:null as number|null,p80Days:null as number|null,p95Days:null as number|null,
      minDays:null as number|null,maxDays:null as number|null,
      criticalPathFrequency:[] as PathFrequency[],
    },
    cost:{
      available:false,p50Lakh:null as number|null,p80Lakh:null as number|null,p95Lakh:null as number|null,
      minLakh:null as number|null,maxLakh:null as number|null,
    },
    issues:[reason],
    limitations,
  });

  if(!input.tasks.length) return unavailable("No governed program tasks exist.");
  if(missingScheduleTaskIds.length) return unavailable("Complete governed schedule O/M/P inputs are required for every program task.");
  if(!graph.valid) return unavailable(graph.reason);
  if(!iterationValid) return unavailable("Monte Carlo iterations must be an integer between 100 and 100000.");

  const rng=rngFromSeed(input.seed);
  const durations:number[]=[];
  const costs:number[]=[];
  const pathCounts=new Map<string,{path:string[];count:number}>();
  const costAvailable=costRequired.length>0&&missingCostTaskIds.length===0;

  for(let i=0;i<iterations;i++){
    const sampledDurations=new Map<string,number>();
    let sampledCost=0;
    for(const task of input.tasks){
      const duration=sampleTriangular(
        task.optimisticDays!,
        task.mostLikelyDays!,
        task.pessimisticDays!,
        rng(),
      );
      sampledDurations.set(task.id,duration);

      if(costAvailable&&task.costForecastRequired){
        sampledCost+=sampleTriangular(
          task.costOptimisticLakh!,
          task.costMostLikelyLakh!,
          task.costPessimisticLakh!,
          rng(),
        );
      }
    }

    const schedule=sampledSchedule(graph.order,graph.predecessors,sampledDurations);
    durations.push(schedule.duration);
    if(costAvailable) costs.push(sampledCost);
    const key=schedule.path.join("→");
    const current=pathCounts.get(key)??{path:schedule.path,count:0};
    current.count++;
    pathCounts.set(key,current);
  }

  const criticalPathFrequency=[...pathCounts.values()]
    .map((item)=>({
      path:item.path,
      count:item.count,
      frequencyPct:Math.round((item.count/iterations)*1000)/10,
    }))
    .sort((a,b)=>b.count-a.count||a.path.join("→").localeCompare(b.path.join("→")));

  return {
    method:"MONTE_CARLO_TRIANGULAR_V1" as const,
    available:true,
    iterations,
    seed:Math.trunc(input.seed),
    missingScheduleTaskIds,
    missingCostTaskIds,
    schedule:{
      p50Days:quantile(durations,0.5),
      p80Days:quantile(durations,0.8),
      p95Days:quantile(durations,0.95),
      minDays:round1(Math.min(...durations)),
      maxDays:round1(Math.max(...durations)),
      criticalPathFrequency,
    },
    cost:{
      available:costAvailable,
      p50Lakh:costAvailable?quantile(costs,0.5):null,
      p80Lakh:costAvailable?quantile(costs,0.8):null,
      p95Lakh:costAvailable?quantile(costs,0.95):null,
      minLakh:costAvailable?round1(Math.min(...costs)):null,
      maxLakh:costAvailable?round1(Math.max(...costs)):null,
    },
    issues:costRequired.length&&missingCostTaskIds.length
      ?["Cost Monte Carlo is withheld because one or more cost-required tasks lack complete governed cost O/M/P inputs."]
      :[],
    limitations,
  };
}
