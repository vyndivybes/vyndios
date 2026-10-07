import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read=(path)=>readFile(new URL(`../${path}`,import.meta.url),"utf8");

test("People & Office has canonical specialist ledgers without a competing person master", async()=>{
  const migration=await read("migrations/0140_people_office_lifecycle_authority.sql");
  for(const table of [
    "vyndi_people_employment_ledger",
    "vyndi_people_attendance_ledger",
    "vyndi_people_leave_ledger",
    "vyndi_people_qualification_ledger",
    "vyndi_people_asset_custody_ledger",
    "vyndi_people_access_ledger",
    "vyndi_people_payroll_readiness_ledger",
    "vyndi_people_exit_cases",
    "vyndi_people_exit_clearance_ledger",
  ]) assert.match(migration,new RegExp(`create table if not exists ${table}`,"i"),table);
  assert.doesNotMatch(migration,/create table if not exists vyndi_(?:employee|person)_master\b/i);
  assert.match(migration,/alter table vyndi_people_records[\s\S]*record_revision/i);
  assert.match(migration,/operational_status/i);
});

test("People record writes use optimistic concurrency and department reads are bounded", async()=>{
  const authority=await read("src/lib/people-office-authority.ts");
  const route=await read("src/routes/command/people-office.tsx");
  assert.match(authority,/expectedRevision/);
  assert.match(authority,/record_revision/);
  assert.match(authority,/stale/i);
  assert.match(route,/recordRevision/);
  assert.match(authority,/select \* from vyndi_people_records order by updated_at desc limit \d+/i);
  assert.match(authority,/select \* from vyndi_people_office_cost_items order by cost_group,name limit \d+/i);
  assert.match(authority,/select \* from vyndi_people_office_assets order by asset_class,category,name limit \d+/i);
  assert.match(authority,/listPeopleOfficeOperations/);
  assert.match(authority,/pageSize/i);
});

test("specialist ledger server writers preserve actor, evidence and revision governance", async()=>{
  const authority=await read("src/lib/people-office-authority.ts");
  for(const writer of [
    "recordEmploymentEvent",
    "recordAttendance",
    "postLeaveTransaction",
    "recordQualification",
    "recordAssetCustodyEvent",
    "recordAccessEvent",
    "recordPayrollReadiness",
    "initiatePeopleExit",
    "recordExitClearance",
    "finalizePeopleExit",
  ]) assert.match(authority,new RegExp(`export const ${writer}\\b`),writer);
  assert.match(authority,/requireBusinessActor/);
  assert.match(authority,/sourceReference/);
  assert.match(authority,/evidenceReference/);
});

test("exit finalization is fail-closed across custody access payroll handover and leave reconciliation", async()=>{
  const migration=await read("migrations/0140_people_office_lifecycle_authority.sql");
  assert.match(migration,/finalize_vyndi_people_exit/i);
  assert.match(migration,/open asset custody/i);
  assert.match(migration,/active access/i);
  assert.match(migration,/payroll/i);
  assert.match(migration,/leave_reconciliation/i);
  assert.match(migration,/handover/i);
  assert.match(migration,/department_clearance/i);
  assert.match(migration,/operational_status='inactive'/i);
});

test("derived views own attendance current state leave balances qualification validity custody access and exit readiness", async()=>{
  const migration=await read("migrations/0140_people_office_lifecycle_authority.sql");
  for(const view of [
    "vyndi_people_attendance_current",
    "vyndi_people_leave_balance",
    "vyndi_people_qualification_current",
    "vyndi_people_asset_custody_current",
    "vyndi_people_access_current",
    "vyndi_people_payroll_readiness_current",
    "vyndi_people_exit_readiness",
    "vyndi_people_office_operational_summary",
  ]) assert.match(migration,new RegExp(`create or replace view ${view}`,"i"),view);
});
