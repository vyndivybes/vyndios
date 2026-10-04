import assert from "node:assert/strict";
import { test } from "node:test";
import { compileVedmAuthorityGraph, type VedmAuthoritySeed } from "./vedm-authority-graph.ts";
import { buildEngineeringScenario } from "./engineering-scenario-model.ts";

const seed: VedmAuthoritySeed = {
  schema: "VYNDI_VEDM_AUTHORITY_GRAPH_V1",
  sourceRepository: "test/repo",
  sourceCommit: "abc",
  nodes: [
    { id:"AUTH", kind:"document_revision", domain:"geometry", title:"Authority", lifecycle:"controlling", sourceRef:"AUTH", releaseEffect:"none", effectiveFrom:"2026-01-01" },
    { id:"OBJ", kind:"engineering_object", domain:"geometry", title:"Object", lifecycle:"controlling", sourceRef:"OBJ", releaseEffect:"none" },
    { id:"EVID", kind:"evidence", domain:"geometry", title:"Evidence", lifecycle:"evidence", sourceRef:"EVID", releaseEffect:"supports_release", evidenceState:"sufficient" },
    { id:"GATE", kind:"release_gate", domain:"release", title:"Gate", lifecycle:"gate", sourceRef:"GATE", releaseEffect:"release_authority", gateStatus:"closed", requiredEvidenceIds:["EVID"] },
  ],
  edges: [
    { from:"AUTH", to:"OBJ", relation:"CONTROLS" },
    { from:"OBJ", to:"EVID", relation:"EVIDENCED_BY" },
    { from:"EVID", to:"GATE", relation:"VALIDATED_BY" },
  ],
};

const tasks = [
  {
    id:"A", optimisticDays:1, mostLikelyDays:2, pessimisticDays:3,
    costForecastRequired:true, costOptimisticLakh:1, costMostLikelyLakh:2, costPessimisticLakh:3,
  },
  {
    id:"B", optimisticDays:2, mostLikelyDays:4, pessimisticDays:6,
    costForecastRequired:true, costOptimisticLakh:2, costMostLikelyLakh:3, costPessimisticLakh:4,
  },
];
const dependencies = [{ predecessorId:"A", successorId:"B", lagDays:0 }];

test("engineering scenario combines controlled graph impact with scenario-only forecast overrides", () => {
  const graph = compileVedmAuthorityGraph(seed, "2026-10-04");
  const result = buildEngineeringScenario({
    graph,
    tasks,
    dependencies,
    request: {
      sourceNodeId:"AUTH",
      targetTaskId:"B",
      scheduleOverride:{ optimisticDays:4, mostLikelyDays:6, pessimisticDays:8 },
      costOverride:{ optimisticLakh:3, mostLikelyLakh:4, pessimisticLakh:5 },
    },
  });

  assert.equal(result.valid, true);
  assert.equal(result.impact.evidenceSuspectCount, 1);
  assert.equal(result.impact.releaseGateReviewCount, 1);
  assert.equal(result.baseline.schedule.available, true);
  assert.equal(result.scenario.schedule.available, true);
  assert.ok((result.scheduleDelta?.p50Days ?? 0) > 0);
  assert.ok((result.costDelta?.p50Lakh ?? 0) > 0);
});

test("scenario calculation does not mutate governed baseline task inputs", () => {
  const graph = compileVedmAuthorityGraph(seed, "2026-10-04");
  const original = structuredClone(tasks);
  buildEngineeringScenario({
    graph,
    tasks,
    dependencies,
    request: {
      sourceNodeId:"AUTH",
      targetTaskId:"B",
      scheduleOverride:{ optimisticDays:5, mostLikelyDays:6, pessimisticDays:7 },
      costOverride:null,
    },
  });
  assert.deepEqual(tasks, original);
});

test("unknown engineering source fails closed", () => {
  const graph = compileVedmAuthorityGraph(seed, "2026-10-04");
  const result = buildEngineeringScenario({
    graph,
    tasks,
    dependencies,
    request: { sourceNodeId:"MISSING", targetTaskId:null, scheduleOverride:null, costOverride:null },
  });
  assert.equal(result.valid, false);
  assert.match(result.issues[0] ?? "", /not present/i);
});

test("unknown target task fails closed when an override is requested", () => {
  const graph = compileVedmAuthorityGraph(seed, "2026-10-04");
  const result = buildEngineeringScenario({
    graph,
    tasks,
    dependencies,
    request: {
      sourceNodeId:"AUTH",
      targetTaskId:"MISSING",
      scheduleOverride:{ optimisticDays:1, mostLikelyDays:2, pessimisticDays:3 },
      costOverride:null,
    },
  });
  assert.equal(result.valid, false);
  assert.match(result.issues[0] ?? "", /target task/i);
});

test("forecast deltas remain withheld when baseline uncertainty is incomplete", () => {
  const graph = compileVedmAuthorityGraph(seed, "2026-10-04");
  const incomplete = [{ ...tasks[0], optimisticDays:null }];
  const result = buildEngineeringScenario({
    graph,
    tasks:incomplete,
    dependencies:[],
    request:{ sourceNodeId:"AUTH", targetTaskId:null, scheduleOverride:null, costOverride:null },
  });
  assert.equal(result.valid, true);
  assert.equal(result.baseline.schedule.available, false);
  assert.equal(result.scheduleDelta, null);
});
