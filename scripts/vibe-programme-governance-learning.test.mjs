import assert from "node:assert/strict";
import test from "node:test";
import {
  buildProgrammeExceptions,
  createDecisionLedgerEntry,
  transitionDecision,
  measureDecisionOutcome,
  buildExecutiveLenses,
} from "../src/lib/vibe-programme-governance-learning.ts";

test("programme exceptions propagate only declared dependencies and preserve evidence",()=>{
 const r=buildProgrammeExceptions({
  signals:[{id:"MAT-P80",domain:"supply",severity:"high",evidenceRef:"EV-MAT",message:"Material P80 slipped"}],
  dependencies:[
   {from:"MAT-P80",to:"PROTOTYPE",relation:"delays"},
   {from:"PROTOTYPE",to:"VALIDATION",relation:"delays"},
   {from:"VALIDATION",to:"CASH",relation:"shifts"},
  ],
 });
 assert.deepEqual(r.exceptions.map(x=>x.nodeId),["MAT-P80","PROTOTYPE","VALIDATION","CASH"]);
 assert.equal(r.exceptions[3].evidenceRefs.includes("EV-MAT"),true);
});

test("decision ledger starts advisory and cannot execute without authority",()=>{
 const d=createDecisionLedgerEntry({id:"DEC-1",problem:"Choose prototype sequence",recommendation:"Sequence A",evidenceRefs:["EV-1"],expectedOutcome:{scheduleDays:60}});
 assert.equal(d.status,"recommended");
 assert.equal(d.executable,false);
 assert.throws(()=>transitionDecision(d,{action:"approve",actorRole:"viewer",allowedRoles:["admin","manager"]}),/authority/i);
});

test("authorised approval is explicit but execution remains a separate controlled transition",()=>{
 const d=createDecisionLedgerEntry({id:"DEC-2",problem:"Release spend",recommendation:"Approve staged spend",evidenceRefs:["EV-2"],expectedOutcome:{cost:10}});
 const approved=transitionDecision(d,{action:"approve",actorRole:"manager",allowedRoles:["manager"]});
 assert.equal(approved.status,"approved");
 assert.equal(approved.executable,true);
 const executed=transitionDecision(approved,{action:"execute",actorRole:"manager",allowedRoles:["manager"]});
 assert.equal(executed.status,"executed");
});

test("outcome learning measures expected versus actual without self-modifying policy",()=>{
 const r=measureDecisionOutcome({expected:{scheduleDays:60,cost:10},actual:{scheduleDays:66,cost:9},accepted:true});
 assert.equal(r.variance.scheduleDays,6);
 assert.equal(r.variance.cost,-1);
 assert.equal(r.recommendationAccepted,true);
 assert.equal(r.policyMutationPermitted,false);
});

test("executive lenses reconcile one governed state using different objectives",()=>{
 const r=buildExecutiveLenses({costExposure:12,scheduleExposureDays:18,technicalConfidence:0.72,qualityBlockers:2,supplyBlockers:1,strategicAlignment:0.85});
 assert.deepEqual(r.map(x=>x.role),["CFO","COO","Chief Engineer","Quality","Supply Chain","CEO"]);
 assert.equal(new Set(r.map(x=>x.sourceStateId)).size,1);
});
