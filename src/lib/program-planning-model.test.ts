import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildProgramNetwork,
  type ProgramTaskInput,
} from "./program-planning-model.ts";

const tasks: ProgramTaskInput[] = [
  { id:"A", title:"Requirements", durationDays:2, status:"planned" },
  { id:"B", title:"Geometry", durationDays:3, status:"planned" },
  { id:"C", title:"Material", durationDays:4, status:"planned" },
  { id:"D", title:"FEA", durationDays:5, status:"planned" },
  { id:"E", title:"Tooling", durationDays:2, status:"planned" },
];

test("critical path is derived from governed dependencies and durations", () => {
  const result = buildProgramNetwork(tasks, [
    { predecessorId:"A", successorId:"B", lagDays:0 },
    { predecessorId:"A", successorId:"C", lagDays:0 },
    { predecessorId:"B", successorId:"D", lagDays:0 },
    { predecessorId:"C", successorId:"D", lagDays:0 },
    { predecessorId:"D", successorId:"E", lagDays:0 },
  ]);

  assert.equal(result.valid, true);
  assert.equal(result.projectDurationDays, 13);
  assert.deepEqual(result.criticalPath, ["A","C","D","E"]);
  assert.equal(result.taskById.B?.slackDays, 1);
  assert.equal(result.taskById.C?.slackDays, 0);
});

test("dependency lag contributes to the critical path", () => {
  const result = buildProgramNetwork(
    [
      { id:"A", title:"A", durationDays:2, status:"planned" },
      { id:"B", title:"B", durationDays:3, status:"planned" },
    ],
    [{ predecessorId:"A", successorId:"B", lagDays:2 }],
  );
  assert.equal(result.projectDurationDays, 7);
  assert.equal(result.taskById.B?.earliestStartDay, 4);
});

test("cycles are rejected instead of producing a fake schedule", () => {
  const result = buildProgramNetwork(
    [
      { id:"A", title:"A", durationDays:1, status:"planned" },
      { id:"B", title:"B", durationDays:1, status:"planned" },
    ],
    [
      { predecessorId:"A", successorId:"B", lagDays:0 },
      { predecessorId:"B", successorId:"A", lagDays:0 },
    ],
  );
  assert.equal(result.valid, false);
  assert.equal(result.cycleTaskIds.length, 2);
  assert.equal(result.projectDurationDays, null);
});

test("missing dependency references are surfaced as integrity issues", () => {
  const result = buildProgramNetwork(
    [{ id:"A", title:"A", durationDays:1, status:"planned" }],
    [{ predecessorId:"A", successorId:"MISSING", lagDays:0 }],
  );
  assert.equal(result.valid, false);
  assert.equal(result.issues[0]?.code, "BROKEN_DEPENDENCY");
});

test("zero or negative duration is rejected", () => {
  const result = buildProgramNetwork(
    [{ id:"A", title:"A", durationDays:0, status:"planned" }],
    [],
  );
  assert.equal(result.valid, false);
  assert.equal(result.issues[0]?.code, "INVALID_DURATION");
});
