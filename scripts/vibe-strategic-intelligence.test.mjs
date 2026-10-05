import assert from "node:assert/strict";
import test from "node:test";
import {buildVibeStrategicPacket,evaluateVibeBench} from "../src/lib/vibe-strategic-intelligence.ts";

const base={
 question:"What should the programme do next?",decisionClass:"programme-priority",
 evidence:[
  {key:"cash",value:20,truthClass:"governed-internal",source:"finance",observedAt:"2026-10-05T00:00:00Z",maxAgeHours:24},
  {key:"release",value:"blocked",truthClass:"governed-internal",source:"engineering",observedAt:"2026-10-05T00:00:00Z",maxAgeHours:24},
 ],
 requiredEvidenceKeys:["cash","release"],
 now:new Date("2026-10-05T06:00:00Z"),
 forecast:{p50:50,p80:60,p90:70},
 optimisation:{status:"infeasible",bindingConstraints:[{code:"MAT",entityType:"material",entityId:"T700",slack:0,message:"Material gate"}],relaxationCandidates:[{constraintId:"MAT",minimumRelaxation:6,unit:"weeks"}]},
 alternatives:[
  {id:"A",cost:10,scheduleDays:60,risk:3,technicalConfidence:.8,strategicAlignment:.9},
  {id:"B",cost:12,scheduleDays:55,risk:2,technicalConfidence:.85,strategicAlignment:.85},
 ],
 signals:[{id:"MAT",domain:"supply",severity:"high",evidenceRef:"EV-MAT",message:"Material delay"}],
 dependencies:[{from:"MAT",to:"PROTOTYPE",relation:"delays"},{from:"PROTOTYPE",to:"RELEASE",relation:"delays"}],
 executiveState:{costExposure:12,scheduleExposureDays:18,technicalConfidence:.72,qualityBlockers:1,supplyBlockers:1,strategicAlignment:.85},
};

test("strategic packet reconciles evidence prediction optimisation programme and executive views",()=>{
 const p=buildVibeStrategicPacket(base);
 assert.equal(p.foundation.confidence.level,"HIGH");
 assert.equal(p.forecast.available,true);
 assert.equal(p.optimisation.managementDecisionRequired,true);
 assert.deepEqual(p.programme.exceptions.map(x=>x.nodeId),["MAT","PROTOTYPE","RELEASE"]);
 assert.deepEqual(p.alternatives.paretoEfficientIds,["A","B"]);
 assert.equal(new Set(p.executiveLenses.map(x=>x.sourceStateId)).size,1);
 assert.equal(p.authority.executable,false);
});

test("strategic packet fails closed on unresolved governed evidence conflict",()=>{
 const p=buildVibeStrategicPacket({...base,evidence:[...base.evidence,{key:"cash",value:5,truthClass:"governed-internal",source:"ledger-2",observedAt:"2026-10-05T00:00:00Z",maxAgeHours:24}]});
 assert.equal(p.foundation.confidence.level,"LOW");
 assert.equal(p.recommendationStatus,"BLOCKED_EVIDENCE");
 assert.equal(p.authority.executable,false);
});

test("VIBE-BENCH covers evidence, forecasting, optimisation, causality, governance and hallucination controls",()=>{
 const r=evaluateVibeBench();
 assert.equal(r.total,15);
 assert.equal(r.passed,15);
 assert.equal(r.failed,0);
 assert.deepEqual(r.cases.filter(x=>!x.pass),[]);
});
