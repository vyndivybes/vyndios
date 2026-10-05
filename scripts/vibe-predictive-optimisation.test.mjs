import assert from "node:assert/strict";
import test from "node:test";

import {
  diagnoseOptimisation,
  compareDecisionAlternatives,
  forecastPercentiles,
  rankSensitivity,
  traceCausalConsequences,
} from "../src/lib/vibe-predictive-optimisation.ts";

test("infeasible optimisation is translated into governed relaxation options", () => {
  const result=diagnoseOptimisation({
    status:"infeasible",
    bindingConstraints:[
      {code:"MATERIAL",entityType:"material",entityId:"MATERIAL__T700__1",slack:0,message:"T700 availability"},
      {code:"CAPITAL",entityType:"cash",entityId:"CAPITAL__1",slack:0,message:"Period 1 cash"},
    ],
    relaxationCandidates:[
      {constraintId:"MATERIAL__T700__1",minimumRelaxation:12,unit:"kg"},
      {constraintId:"CAPITAL__1",minimumRelaxation:3.5,unit:"lakh"},
    ],
  });
  assert.equal(result.feasible,false);
  assert.equal(result.bindingConstraints.length,2);
  assert.equal(result.minimumRelaxations[0].constraintId,"CAPITAL__1");
  assert.equal(result.managementDecisionRequired,true);
});

test("forecast abstraction exposes P50 P80 P90 without inventing missing percentiles", () => {
  assert.deepEqual(forecastPercentiles({p50:42,p80:51,p90:58}),{p50:42,p80:51,p90:58,available:true});
  assert.equal(forecastPercentiles({p50:42,p80:51,p90:null}).available,false);
});

test("sensitivity ranks absolute outcome movement and preserves direction", () => {
  const rows=rankSensitivity([
    {variable:"material lead time",baseline:6,changed:8,outcomeDelta:14},
    {variable:"prototype cost",baseline:10,changed:12,outcomeDelta:-4},
  ]);
  assert.equal(rows[0].variable,"material lead time");
  assert.equal(rows[0].direction,"worsens");
  assert.equal(rows[1].direction,"improves");
});

test("decision comparator is deterministic and keeps Pareto-efficient alternatives", () => {
  const result=compareDecisionAlternatives([
    {id:"A",cost:10,scheduleDays:60,risk:0.4,technicalConfidence:0.8,strategicAlignment:0.8},
    {id:"B",cost:12,scheduleDays:55,risk:0.3,technicalConfidence:0.9,strategicAlignment:0.9},
    {id:"C",cost:14,scheduleDays:70,risk:0.5,technicalConfidence:0.7,strategicAlignment:0.6},
  ]);
  assert.deepEqual(result.paretoEfficientIds,["A","B"]);
  assert.equal(result.dominatedIds.includes("C"),true);
});

test("causal trace follows only declared governed dependencies", () => {
  const trace=traceCausalConsequences("material-delay",[
    {from:"material-delay",to:"prototype-delay",relation:"causes"},
    {from:"prototype-delay",to:"validation-delay",relation:"causes"},
    {from:"validation-delay",to:"cash-shift",relation:"affects"},
    {from:"unrelated",to:"release-risk",relation:"affects"},
  ]);
  assert.deepEqual(trace.map((x)=>x.to),["prototype-delay","validation-delay","cash-shift"]);
});
