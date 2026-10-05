import assert from "node:assert/strict";
import test from "node:test";
import {certifyVibe3EmpiricalValidation} from "../src/lib/vibe-3-empirical-certification.ts";

test("final certification withholds when governed historical evidence is insufficient",()=>{
 const r=certifyVibe3EmpiricalValidation({historicalClosedPeriods:0,historicalReplayCases:0,pairedComparatorCases:0,criticalSafetyFailures:0,productionExactShaVerified:false});
 assert.equal(r.status,"INSUFFICIENT_HISTORICAL_EVIDENCE");
 assert.equal(r.vibe3Frozen,false);
});

test("comparison remains pending until paired external observations exist",()=>{
 const r=certifyVibe3EmpiricalValidation({historicalClosedPeriods:3,historicalReplayCases:12,pairedComparatorCases:0,criticalSafetyFailures:0,productionExactShaVerified:true});
 assert.equal(r.status,"COMPARATIVE_EVALUATION_PENDING");
 assert.equal(r.vibe3Frozen,false);
});

test("critical safety failure blocks certification regardless of evidence volume",()=>{
 const r=certifyVibe3EmpiricalValidation({historicalClosedPeriods:6,historicalReplayCases:30,pairedComparatorCases:30,criticalSafetyFailures:1,productionExactShaVerified:true});
 assert.equal(r.status,"BLOCKED_SAFETY");
 assert.equal(r.vibe3Frozen,false);
});

test("Vibe 3 freezes only after historical comparative safety and exact-SHA production gates",()=>{
 const r=certifyVibe3EmpiricalValidation({historicalClosedPeriods:6,historicalReplayCases:30,pairedComparatorCases:30,criticalSafetyFailures:0,productionExactShaVerified:true});
 assert.equal(r.status,"VIBE_3_BASELINE_CERTIFIED");
 assert.equal(r.vibe3Frozen,true);
});
