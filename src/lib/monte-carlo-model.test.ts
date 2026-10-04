import assert from "node:assert/strict";
import { test } from "node:test";
import { runMonteCarloForecast, sampleTriangular } from "./monte-carlo-model.ts";

test("triangular sampling is deterministic for a supplied uniform draw",()=>{
  assert.equal(sampleTriangular(1,2,3,0),1);
  assert.equal(sampleTriangular(1,2,3,1),3);
  assert.equal(sampleTriangular(1,2,3,0.5),2);
});

test("Monte Carlo is reproducible from a fixed seed",()=>{
  const input={
    tasks:[
      {id:"A",optimisticDays:1,mostLikelyDays:2,pessimisticDays:3,costForecastRequired:true,costOptimisticLakh:1,costMostLikelyLakh:2,costPessimisticLakh:3},
      {id:"B",optimisticDays:2,mostLikelyDays:4,pessimisticDays:8,costForecastRequired:true,costOptimisticLakh:2,costMostLikelyLakh:3,costPessimisticLakh:5},
    ],
    dependencies:[{predecessorId:"A",successorId:"B",lagDays:0}],
    iterations:2000,
    seed:42,
  };
  assert.deepEqual(runMonteCarloForecast(input),runMonteCarloForecast(input));
});

test("Monte Carlo emits schedule and cost quantiles from complete governed distributions",()=>{
  const result=runMonteCarloForecast({
    tasks:[
      {id:"A",optimisticDays:1,mostLikelyDays:2,pessimisticDays:3,costForecastRequired:true,costOptimisticLakh:1,costMostLikelyLakh:2,costPessimisticLakh:3},
      {id:"B",optimisticDays:2,mostLikelyDays:4,pessimisticDays:8,costForecastRequired:true,costOptimisticLakh:2,costMostLikelyLakh:3,costPessimisticLakh:5},
    ],
    dependencies:[{predecessorId:"A",successorId:"B",lagDays:0}],
    iterations:3000,
    seed:7,
  });
  assert.equal(result.available,true);
  assert.ok(result.schedule.p50Days>0);
  assert.ok(result.schedule.p80Days>result.schedule.p50Days);
  assert.ok(result.schedule.p95Days>result.schedule.p80Days);
  assert.ok((result.cost.p50Lakh??0)>0);
  assert.equal(result.iterations,3000);
  assert.equal(result.method,"MONTE_CARLO_TRIANGULAR_V1");
});

test("Monte Carlo recomputes path choice and reports critical-path frequency",()=>{
  const result=runMonteCarloForecast({
    tasks:[
      {id:"START",optimisticDays:1,mostLikelyDays:1,pessimisticDays:1,costForecastRequired:false,costOptimisticLakh:null,costMostLikelyLakh:null,costPessimisticLakh:null},
      {id:"A",optimisticDays:1,mostLikelyDays:2,pessimisticDays:8,costForecastRequired:false,costOptimisticLakh:null,costMostLikelyLakh:null,costPessimisticLakh:null},
      {id:"B",optimisticDays:2,mostLikelyDays:3,pessimisticDays:4,costForecastRequired:false,costOptimisticLakh:null,costMostLikelyLakh:null,costPessimisticLakh:null},
      {id:"END",optimisticDays:1,mostLikelyDays:1,pessimisticDays:1,costForecastRequired:false,costOptimisticLakh:null,costMostLikelyLakh:null,costPessimisticLakh:null},
    ],
    dependencies:[
      {predecessorId:"START",successorId:"A",lagDays:0},
      {predecessorId:"START",successorId:"B",lagDays:0},
      {predecessorId:"A",successorId:"END",lagDays:0},
      {predecessorId:"B",successorId:"END",lagDays:0},
    ],
    iterations:4000,
    seed:11,
  });
  const paths=result.schedule.criticalPathFrequency;
  assert.ok(paths.length>=2);
  assert.ok(paths.some((item)=>item.path.includes("A")));
  assert.ok(paths.some((item)=>item.path.includes("B")));
  assert.ok(Math.abs(paths.reduce((sum,item)=>sum+item.frequencyPct,0)-100)<0.2);
});

test("incomplete governed schedule distributions withhold Monte Carlo",()=>{
  const result=runMonteCarloForecast({
    tasks:[{id:"A",optimisticDays:null,mostLikelyDays:2,pessimisticDays:3,costForecastRequired:false,costOptimisticLakh:null,costMostLikelyLakh:null,costPessimisticLakh:null}],
    dependencies:[],
    iterations:1000,
    seed:1,
  });
  assert.equal(result.available,false);
  assert.deepEqual(result.missingScheduleTaskIds,["A"]);
  assert.equal(result.schedule.p50Days,null);
});

test("model explicitly declares independence and physical-response boundary",()=>{
  const result=runMonteCarloForecast({tasks:[],dependencies:[],iterations:1000,seed:1});
  assert.match(result.limitations.join(" "),/independent/i);
  assert.match(result.limitations.join(" "),/physical engineering response/i);
});
