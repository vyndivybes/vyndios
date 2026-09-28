import assert from "node:assert/strict";
import test from "node:test";
import { createWorkflow, transitionWorkflow, evaluateWaiver } from "./r3-governed-workflow.ts";

test("R3-B enforces draft → pending approval → approved → released lifecycle", () => {
  const draft=createWorkflow({id:"ECR-1",domain:"frame_geometry",createdBy:"eng-1"});
  const pending=transitionWorkflow(draft,{action:"submit",actor:{id:"eng-1",role:"engineering"}});
  const approved=transitionWorkflow(pending.record,{action:"approve",actor:{id:"qa-1",role:"qa"}});
  const released=transitionWorkflow(approved.record,{action:"release",actor:{id:"cfg-1",role:"admin"}});
  assert.equal(pending.allowed,true);
  assert.equal(approved.allowed,true);
  assert.equal(released.allowed,true);
  assert.equal(released.record.status,"released");
});

test("R3-B segregation of duties prevents self approval and VIBPE approval", () => {
  const draft=createWorkflow({id:"ECR-2",domain:"frame_geometry",createdBy:"eng-1"});
  const pending=transitionWorkflow(draft,{action:"submit",actor:{id:"eng-1",role:"engineering"}}).record;
  const self=transitionWorkflow(pending,{action:"approve",actor:{id:"eng-1",role:"engineering"}});
  const vibpe=transitionWorkflow(pending,{action:"approve",actor:{id:"vibpe",role:"vibpe"}});
  assert.equal(self.allowed,false);
  assert.equal(self.reason,"SEGREGATION_OF_DUTIES");
  assert.equal(vibpe.allowed,false);
  assert.equal(vibpe.reason,"HUMAN_APPROVAL_REQUIRED");
});

test("R3-B supersession requires a released successor in the same authority domain", () => {
  const old={...createWorkflow({id:"OLD",domain:"frame_geometry",createdBy:"eng"}),status:"released" as const};
  const bad=transitionWorkflow(old,{action:"supersede",actor:{id:"cfg",role:"admin"},successor:{id:"NEW",domain:"fork_front_end",status:"released"}});
  const good=transitionWorkflow(old,{action:"supersede",actor:{id:"cfg",role:"admin"},successor:{id:"NEW",domain:"frame_geometry",status:"released"}});
  assert.equal(bad.allowed,false);
  assert.equal(good.allowed,true);
  assert.equal(good.record.status,"superseded");
});

test("R3-B never allows a waiver to bypass safety-critical engineering release evidence", () => {
  const waiver=evaluateWaiver({gateId:"G5-FEA",criticality:"safety_critical",reason:"schedule",requestedBy:"eng",approvedBy:"cfg",expiresOn:"2026-10-01"},"2026-09-28");
  assert.equal(waiver.allowed,false);
  assert.equal(waiver.reason,"SAFETY_CRITICAL_GATE_NOT_WAIVABLE");
});
