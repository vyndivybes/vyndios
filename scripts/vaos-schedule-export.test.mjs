import test from "node:test";
import assert from "node:assert/strict";
import { normalizeVaosScheduleExport, validateScheduleProjectInput } from "../src/lib/vaos-schedule-export.ts";

test("read-only schedule export retains source identities but never grants approval",()=>{
 const r=normalizeVaosScheduleExport({
  projectId:"VYNDI-MASTER-PROGRAM",
  capturedAt:"2026-10-08T14:00:00.000Z",
  records:[
   {id:"B",owner:"production",status:"blocked",planned_finish:"2026-10-10",actual_finish:null},
   {id:"A",owner:"engineering",status:"complete",planned_finish:"2026-10-07",actual_finish:"2026-10-08"},
  ],
 });
 assert.equal(r.projectId,"VYNDI-MASTER-PROGRAM");
 assert.equal(r.schemaVersion,"vyndi.program.schedule-export.v1");
 assert.equal(r.tasks.length,2);
 assert.deepEqual(r.tasks.map(x=>x.id),["A","B"]);
 assert.equal(r.tasks[0].sourceRef,"vyndi_program_tasks/A");
 assert.equal(r.tasks[0].plannedFinish,"2026-10-07");
 assert.equal(r.approvalStatus,"UNAPPROVED_SOURCE_EXPORT");
 assert.ok(!("approval" in r));
 assert.ok(!("approvedBy" in r.tasks[0]));
});
test("invalid project identifiers, empty rows and duplicate tasks fail closed",()=>{
 assert.throws(()=>validateScheduleProjectInput({projectId:"' OR 1=1 --"}),/SCHEDULE_PROJECT_ID_INVALID/);
 assert.throws(()=>validateScheduleProjectInput({projectId:""}),/SCHEDULE_PROJECT_ID_INVALID/);
 assert.throws(()=>normalizeVaosScheduleExport({projectId:"VYNDI-MASTER-PROGRAM",capturedAt:"2026-10-08T14:00:00.000Z",records:[]}),/SCHEDULE_SOURCE_EMPTY/);
 assert.throws(()=>normalizeVaosScheduleExport({projectId:"VYNDI-MASTER-PROGRAM",capturedAt:"2026-10-08T14:00:00.000Z",records:[{id:"A"},{id:"A"}]}),/SCHEDULE_DUPLICATE_TASK/);
});
test("reject unsupported source statuses, invalid date fields and non-UTC poll timestamps",()=>{
 const args={projectId:"VYNDI-MASTER-PROGRAM",capturedAt:"2026-10-08T14:00:00.000Z",records:[{id:"A",status:"invented",planned_finish:"2026-10-08"}]};
 assert.throws(()=>normalizeVaosScheduleExport(args),/SCHEDULE_SOURCE_STATUS_INVALID/);
 assert.throws(()=>normalizeVaosScheduleExport({...args,records:[{id:"A",status:"ready",planned_finish:"31-12-2026"}]}),/SCHEDULE_SOURCE_DATE_INVALID/);
 assert.throws(()=>normalizeVaosScheduleExport({...args,capturedAt:"2026-10-08"}),/SCHEDULE_CAPTURE_INVALID/);
});
test("does not export unrelated financial, people or other unrestricted row fields",()=>{
 const r=normalizeVaosScheduleExport({projectId:"VYNDI-MASTER-PROGRAM",capturedAt:"2026-10-08T14:00:00.000Z",records:[{id:"A",owner:"eng",status:"ready",planned_finish:"2026-10-08",bank_account:"SECRET",internal_notes:"PRIVATE"}]});
 assert.equal(JSON.stringify(r).includes("SECRET"),false);
 assert.equal(JSON.stringify(r).includes("PRIVATE"),false);
});
