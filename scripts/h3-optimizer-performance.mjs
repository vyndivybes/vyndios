import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import loadHighs from "highs";
import { createHighsAdvancedPlanningOptimizer } from "../src/lib/advanced-planning-highs-adapter.ts";
import { runGovernedAdvancedOptimizer } from "../src/lib/advanced-planning-optimizer.ts";
import { ADVANCED_PLANNING_MODEL_VERSION } from "../src/lib/advanced-planning-constraints.ts";

const solveCount=Math.max(3,Math.min(10,Number(process.env.H3_OPTIMIZER_SOLVES || 5)));
const p95LimitMs=Number(process.env.H3_OPTIMIZER_P95_LIMIT_MS || 8000);
const hardRuntimeMs=12_000;
const evidencePath=resolve(process.env.H3_OPTIMIZER_EVIDENCE_PATH || ".grok/evidence/h3-performance/optimizer.json");

function percentile(values,p){
  const ordered=[...values].sort((a,b)=>a-b);
  return ordered[Math.min(ordered.length-1,Math.max(0,Math.ceil((p/100)*ordered.length)-1))];
}

function model(){
  const horizon=12;
  return {
    modelVersion:ADVANCED_PLANNING_MODEL_VERSION,
    horizonPeriods:horizon,
    demands:Array.from({length:horizon},(_,i)=>({
      id:`H3-D-${i+1}`,productId:"latitude",period:i+1,quantity:2+(i%3),priority:100-i,truth:i<6 ? "committed" : "forecast",
    })),
    bom:[{id:"H3-BOM",productId:"latitude",sku:"FRAME-LAT-M",quantityPerUnit:1,scrapPct:0.02}],
    materials:[{sku:"FRAME-LAT-M",onHandQty:100,reservedQty:2,safetyStockQty:5}],
    committedReceipts:[],
    resources:[
      {id:"H3-WC-A",name:"Layup A",type:"work_center",capabilities:["LAYUP"],efficiency:0.9,capacity:Array.from({length:horizon},(_,i)=>({period:i+1,availableHours:20}))},
      {id:"H3-WC-B",name:"Layup B",type:"work_center",capabilities:["LAYUP"],efficiency:0.95,capacity:Array.from({length:horizon},(_,i)=>({period:i+1,availableHours:18}))},
    ],
    routingOperations:[{
      id:"H3-OP",productId:"latitude",operationCode:"LAYUP",sequence:10,
      eligibleResourceIds:["H3-WC-A","H3-WC-B"],runHoursPerUnit:1,setupHours:0.25,yieldPct:0.98,
    }],
    supplierLanes:[],
    objectiveWeights:{
      unmetCommittedDemand:100,unmetForecastDemand:30,lateness:50,resourceOverload:100,
      supplierOverload:100,procurementCost:5,workingCapital:3,scheduleChange:2,
    },
  };
}

const evidence={
  test:"VYNDI H3 published HiGHS optimizer performance qualification",
  solveCount,
  hardRuntimeMs,
  p95LimitMs,
  startedAt:new Date().toISOString(),
  loadRuntimeMs:null,
  solves:[],
  summary:null,
  result:"RUNNING",
};

try{
  const loadStarted=Date.now();
  const runtime=await loadHighs();
  evidence.loadRuntimeMs=Date.now()-loadStarted;
  const optimizer=createHighsAdvancedPlanningOptimizer(runtime);
  const durations=[];

  for(let i=0;i<solveCount;i+=1){
    const started=Date.now();
    const run=await runGovernedAdvancedOptimizer(model(),optimizer,{
      requestId:`H3-OPT-${i+1}`,maxRuntimeMs:hardRuntimeMs,mipGap:0.02,
    });
    const durationMs=Date.now()-started;
    durations.push(durationMs);
    evidence.solves.push({
      index:i+1,durationMs,accepted:run.accepted,status:run.result?.status ?? "none",
      objectiveValue:run.result?.objectiveValue ?? null,issues:run.issues.map((row)=>row.code),
    });
    assert.equal(run.accepted,true,`Optimizer solve ${i+1} was rejected: ${run.issues.map((row)=>row.code).join(", ")}`);
    assert.ok(["optimal","feasible"].includes(run.result?.status ?? ""),`Optimizer solve ${i+1} returned ${run.result?.status}`);
    assert.ok(durationMs<hardRuntimeMs,`Optimizer solve ${i+1} exceeded hard runtime ceiling: ${durationMs}ms`);
  }

  evidence.summary={
    p50Ms:percentile(durations,50),
    p95Ms:percentile(durations,95),
    p99Ms:percentile(durations,99),
    maxMs:Math.max(...durations),
    minMs:Math.min(...durations),
    errorRate:0,
  };
  assert.ok(evidence.summary.p95Ms<=p95LimitMs,`Optimizer p95 ${evidence.summary.p95Ms}ms exceeds H3 limit ${p95LimitMs}ms.`);

  evidence.result="PASS";
  evidence.completedAt=new Date().toISOString();
  console.log(JSON.stringify({event:"vyndi.h3.optimizer-performance",...evidence},null,2));
}catch(error){
  evidence.result="FAIL";
  evidence.completedAt=new Date().toISOString();
  evidence.error=error instanceof Error ? error.stack || error.message : String(error);
  throw error;
}finally{
  await mkdir(dirname(evidencePath),{recursive:true});
  await writeFile(evidencePath,`${JSON.stringify(evidence,null,2)}\n`,"utf8");
}
