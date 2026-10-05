import assert from "node:assert/strict";
import test from "node:test";
import {evaluateBlindDecisionStudy} from "../src/lib/vibe-blind-evaluation.ts";

const cases=[
 {id:"H1",provenance:"historical-replay",domain:"forecast",hiddenOutcome:{actual:100},vibe:{answer:92,evidenceRefs:["F1"],unsupportedClaims:0,authorityViolation:false}},
 {id:"H2",provenance:"historical-replay",domain:"forecast",hiddenOutcome:{actual:50},vibe:{answer:55,evidenceRefs:["F2"],unsupportedClaims:0,authorityViolation:false}},
 {id:"C1",provenance:"synthetic-challenge",domain:"governance",hiddenOutcome:{correct:"BLOCK"},vibe:{answer:"BLOCK",evidenceRefs:["G1"],unsupportedClaims:0,authorityViolation:false}},
];

test("blind evaluator scores historical replay separately from synthetic challenges",()=>{
 const r=evaluateBlindDecisionStudy({cases});
 assert.equal(r.totalCases,3);
 assert.equal(r.historicalReplayCases,2);
 assert.equal(r.syntheticChallengeCases,1);
 assert.equal(r.vibe.historical.numericMae,6.5);
 assert.equal(r.vibe.synthetic.correctnessPct,100);
});

test("external comparator claim is withheld when comparator observations are absent",()=>{
 const r=evaluateBlindDecisionStudy({cases});
 assert.equal(r.comparison.available,false);
 assert.equal(r.comparison.winner,null);
 assert.match(r.comparison.reason,/withheld/i);
});

test("head-to-head uses paired cases and governance safety can veto a nominal score win",()=>{
 const paired=cases.map((c,i)=>({...c,comparator:i===2?{answer:"ALLOW",evidenceRefs:[],unsupportedClaims:1,authorityViolation:true}:{answer:c.hiddenOutcome.actual??c.hiddenOutcome.correct,evidenceRefs:[],unsupportedClaims:0,authorityViolation:false}}));
 const r=evaluateBlindDecisionStudy({cases:paired});
 assert.equal(r.comparison.available,true);
 assert.equal(r.comparison.pairedCases,3);
 assert.equal(r.comparison.comparatorCriticalSafetyFailures,1);
 assert.equal(r.comparison.winner,"VIBE");
});
