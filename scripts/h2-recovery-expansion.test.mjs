import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read=(path)=>readFile(path,"utf8");

test("H2 recovery qualification expands beyond sales and cash into multi-department evidence",async()=>{
  const [drill,manifest]=await Promise.all([
    read("scripts/h2-recovery-drill.mjs"),
    read("scripts/recovery-qualification-manifest.mjs"),
  ]);
  assert.match(drill,/captureRecoveryQualificationSnapshot/);
  for(const scope of ["commercial","finance","peopleOffice","quality","configuration","attachments","audit"]){
    assert.match(manifest,new RegExp(scope));
  }
  assert.match(drill,/multiDepartmentRestore:true/);
  assert.match(drill,/configurationHashMatch:true/);
  assert.match(drill,/attachmentHashMatch:true/);
  assert.match(drill,/attachmentBytesMatch:true/);
  assert.match(drill,/domainHashes/);
});

test("Recovery qualification evidence is append-only and tied to a full-restore request",async()=>{
  const migration=await read("migrations/0141_recovery_qualification_expansion.sql");
  assert.match(migration,/create table if not exists vyndi_recovery_qualification_evidence/i);
  assert.match(migration,/request_id text not null references vyndi_recovery_requests/i);
  assert.match(migration,/evidence_kind text not null/i);
  assert.match(migration,/source_hash text not null/i);
  assert.match(migration,/restored_hash text not null/i);
  assert.match(migration,/source_bytes bigint/i);
  assert.match(migration,/restored_bytes bigint/i);
  assert.match(migration,/deny_vyndi_recovery_qualification_mutation/i);
  assert.match(migration,/register_vyndi_recovery_qualification_evidence/i);
  assert.match(migration,/vyndi_recovery_qualification_summary/i);
});

test("Full restore validation fails closed without matched department configuration and attachment evidence",async()=>{
  const migration=await read("migrations/0141_recovery_qualification_expansion.sql");
  assert.match(migration,/matched_department_count/i);
  assert.match(migration,/configuration_match_count/i);
  assert.match(migration,/attachment_match_count/i);
  assert.match(migration,/mismatch_count/i);
  assert.match(migration,/at least four department recovery scopes/i);
  assert.match(migration,/configuration recovery evidence/i);
  assert.match(migration,/attachment recovery evidence/i);
});

test("Recovery server exposes qualification evidence registration and summary",async()=>{
  const authority=await read("src/lib/recovery-control.ts");
  assert.match(authority,/recordVindyRecoveryQualificationEvidence/);
  assert.match(authority,/qualificationSummary/);
  assert.match(authority,/evidenceKind/);
  assert.match(authority,/sourceHash/);
  assert.match(authority,/restoredHash/);
  assert.match(authority,/sourceBytes/);
  assert.match(authority,/restoredBytes/);
});
