import assert from "node:assert/strict";
import test from "node:test";
import {runVibeBench2, VIBE_BENCH_2_CASES} from "../src/lib/vibe-bench-2.ts";

test("VIBE-BENCH 2.0 contains 120 executable capability cases with no decorative passes",()=>{
 assert.equal(VIBE_BENCH_2_CASES.length,120);
 assert.equal(new Set(VIBE_BENCH_2_CASES.map(x=>x.id)).size,120);
 assert.ok(VIBE_BENCH_2_CASES.every(x=>typeof x.execute==="function"));
 assert.ok(VIBE_BENCH_2_CASES.every(x=>x.criticality==="standard"||x.criticality==="critical"));
});

test("certification computes scores from executed cases and requires zero critical failures",()=>{
 const r=runVibeBench2();
 assert.equal(r.total,120);
 assert.equal(r.executed,120);
 assert.equal(r.failed,0);
 assert.equal(r.criticalFailures,0);
 assert.equal(r.overallScore,100);
 assert.equal(r.certification,"CERTIFIED");
 assert.ok(Object.keys(r.categoryScores).length>=8);
});

test("benchmark covers truth reasoning prediction optimisation decision governance hallucination and cross-domain capability",()=>{
 const categories=new Set(VIBE_BENCH_2_CASES.map(x=>x.category));
 for(const required of ["evidence-integrity","factual-correctness","forecasting","optimisation","causal-reasoning","decision-intelligence","governance","hallucination-resistance","cross-domain-reasoning"]) assert.ok(categories.has(required));
});
