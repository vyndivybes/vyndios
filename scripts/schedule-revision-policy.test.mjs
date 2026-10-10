import test from "node:test";
import assert from "node:assert/strict";
import { validateScheduleRevision, canMonitorSchedule } from "../src/lib/schedule-revision-policy.mjs";

const base = {id:"REV-10",baseRevision:"REV-9",reason:"Supplier lead time",sourceReference:"EVID-123",changes:[{taskId:"AL-002",field:"durationDays",before:10,after:14}],author:"planner"};
test("draft changes remain editable but never monitorable",()=>{
  assert.equal(validateScheduleRevision({...base,status:"draft"}).ok,true);
  assert.equal(canMonitorSchedule({...base,status:"draft"}),false);
});
test("approved change requires separate named reviewer and complete source",()=>{
  assert.equal(validateScheduleRevision({...base,status:"approved",reviewer:"planner",approvedBy:"planner"}).ok,false);
  assert.equal(validateScheduleRevision({...base,status:"approved",reviewer:"auditor",approvedBy:"auditor",approvalEvidence:"approval-321",effectiveRevision:"REV-10"}).ok,true);
});
test("revision requires nonempty changed field and an explicit prior value",()=>{
  assert.equal(validateScheduleRevision({...base,changes:[{taskId:"AL-002",field:"durationDays",after:10}]}).ok,false);
});
test("monitoring requires approved dated immutable baseline and independent verifier",()=>{
  const approved={...base,status:"approved",reviewer:"auditor",approvedBy:"auditor",approvalEvidence:"approval-321",effectiveRevision:"REV-10"};
  assert.equal(canMonitorSchedule(approved),false);
  assert.equal(canMonitorSchedule({...approved,baselineHash:"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",approvedTimezone:"Asia/Kolkata",approvedDates:true,independentVerifier:"third-party"}),true);
});
test("unsupported arbitrary field changes are rejected",()=>{
  assert.equal(validateScheduleRevision({...base,changes:[{taskId:"AL-002",field:"deleteDatabase",before:0,after:1}]}).ok,false);
});
