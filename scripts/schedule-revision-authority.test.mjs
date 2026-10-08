import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const read=path=>readFile(new URL("../"+path,import.meta.url),"utf8");
const [authority,ui,migration]=await Promise.all([
  read("src/lib/schedule-revision-authority.ts"),
  read("src/components/schedule-revision-editor.tsx"),
  read("migrations/0190_vyndi_schedule_revision_workflow.sql")
]);
test("revision API enforces authenticated business actor and separates edit from approve",()=>{
  assert.match(authority,/requireBusinessActor\("edit"\)/);
  assert.match(authority,/requireBusinessActor\("approve"\)/);
  assert.match(authority,/proposed_by<>\$\{actor.userId\}/);
});
test("revision proposal checks canonical tasks and stale before-values",()=>{
  assert.match(authority,/taskIds/);
  assert.match(authority,/Stale proposal:/);
  assert.match(authority,/Unknown source task/);
});
test("revision UI cannot approve/publish a baseline",()=>{
  assert.match(ui,/proposeScheduleRevision/);
  assert.match(ui,/submitScheduleRevision/);
  assert.match(ui,/rejectScheduleRevision/);
  assert.doesNotMatch(ui,/approveScheduleRevision|publishScheduleRevision/);
});
test("migration is additive and records evidence, reviewer and immutable baseline hash",()=>{
  assert.match(migration,/create table if not exists vyndi_schedule_revisions/i);
  assert.match(migration,/create table if not exists vyndi_schedule_revision_changes/i);
  assert.match(migration,/reviewed_by <> proposed_by/);
  assert.match(migration,/baseline_hash/);
  assert.doesNotMatch(migration,/drop table|truncate table/i);
});
