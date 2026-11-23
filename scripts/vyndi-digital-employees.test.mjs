import assert from "node:assert/strict";
import test from "node:test";
import { VYNDI_DIGITAL_EMPLOYEES, evaluateVyndiAgentRequest } from "../src/lib/vyndi-digital-employees.ts";

const now = new Date("2026-11-18T00:00:00.000Z");
const governedEvidence = {
  sourceId: "approved-plan-1",
  sourceSha: "a".repeat(40),
  capturedAt: "2026-11-17T23:30:00.000Z",
  authority: "governed-internal",
};
const request = (employeeId, mode = "observe", changes = {}) => ({
  employeeId, mode, verifiedActorId: "verified-user-1", evidence: governedEvidence, ...changes,
});

test("roster lists exactly eight distinct proposed business analysts with owned source modules", () => {
  assert.equal(VYNDI_DIGITAL_EMPLOYEES.length, 8);
  assert.equal(new Set(VYNDI_DIGITAL_EMPLOYEES.map((e) => e.id)).size, 8);
  for (const employee of VYNDI_DIGITAL_EMPLOYEES) {
    assert.ok(employee.sources.length >= 2, employee.id);
    assert.ok(employee.sources.every((s) => s.startsWith("src/lib/")), employee.id);
    assert.ok(employee.deliverable, employee.id);
  }
});

test("every candidate is read/advisory or prepare-only, never a transaction executor", () => {
  for (const employee of VYNDI_DIGITAL_EMPLOYEES) {
    const observed = evaluateVyndiAgentRequest(request(employee.id), now);
    assert.equal(observed.status, "ADVISORY", employee.id);
    assert.equal(observed.executionEnabled, false, employee.id);
    const prepared = evaluateVyndiAgentRequest(request(employee.id, "prepare"), now);
    assert.equal(prepared.status, "PREPARED", employee.id);
    assert.equal(prepared.executionEnabled, false, employee.id);
    const executed = evaluateVyndiAgentRequest(request(employee.id, "execute"), now);
    assert.equal(executed.status, "BLOCKED", employee.id);
    assert.equal(executed.executionEnabled, false, employee.id);
  }
});

test("unknown agent and unsupported work modes fail closed", () => {
  assert.equal(evaluateVyndiAgentRequest(request("unknown"), now).status, "BLOCKED");
  assert.equal(evaluateVyndiAgentRequest(request("planning", "approve"), now).status, "BLOCKED");
});

test("missing identity, ungoverned evidence and stale or future snapshots produce HOLD", () => {
  assert.equal(evaluateVyndiAgentRequest(request("finance", "prepare", { verifiedActorId: null }), now).status, "HOLD");
  assert.equal(evaluateVyndiAgentRequest(request("finance", "prepare", { evidence: null }), now).status, "HOLD");
  assert.equal(evaluateVyndiAgentRequest(request("finance", "prepare", { evidence: { ...governedEvidence, sourceSha: "invalid" } }), now).status, "HOLD");
  for (const authority of ["scenario-assumption", "external-reference", "model-inference"]) {
    assert.equal(evaluateVyndiAgentRequest(request("finance", "prepare", { evidence: { ...governedEvidence, authority } }), now).status, "HOLD");
  }
  assert.equal(evaluateVyndiAgentRequest(request("finance", "prepare", { evidence: { ...governedEvidence, capturedAt: "2026-11-16T23:00:00Z" } }), now).status, "HOLD");
  assert.equal(evaluateVyndiAgentRequest(request("finance", "prepare", { evidence: { ...governedEvidence, capturedAt: "2026-11-19T00:00:00Z" } }), now).status, "HOLD");
});
