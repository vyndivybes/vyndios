import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assessIndiaBackupProof } from "./india-books-backup-proof.mjs";

const good = {
  region: "ap-south-1", versioning: "Enabled", objectLock: "Enabled",
  retentionMode: "COMPLIANCE", size: 4096, sha256: "a".repeat(64),
  remoteSha256: "a".repeat(64), versionId: "v-id-1", encrypted: "AES256",
};
test("only India-hosted, encrypted, immutable, checksum-matching backups can pass", () => {
  assert.equal(assessIndiaBackupProof(good).state, "BACKUP_OBJECT_VERIFIED");
  assert.equal(assessIndiaBackupProof({...good, region:"ap-south-2"}).state, "BACKUP_OBJECT_VERIFIED");
});
for (const [name, diff] of [
  ["outside India region",{region:"ap-southeast-1"}],
  ["Cloudflare APAC hint",{region:"apac"}],
  ["missing versioning",{versioning:"Suspended"}],
  ["no object lock",{objectLock:"Disabled"}],
  ["no default retention",{retentionMode:""}],
  ["empty backup",{size:0}],
  ["bad digest",{sha256:"123"}],
  ["checksum mismatch",{remoteSha256:"b".repeat(64)}],
  ["missing immutable version",{versionId:""}],
  ["unencrypted",{encrypted:""}],
]) {
  test(`backup verification rejects ${name}`,()=>{
    assert.equal(assessIndiaBackupProof({...good,...diff}).state,"BACKUP_OBJECT_NOT_VERIFIED");
  });
}
test("invalid object metadata cannot silently pass",()=>{
  assert.equal(assessIndiaBackupProof(null).state,"BACKUP_OBJECT_NOT_VERIFIED");
  assert.equal(assessIndiaBackupProof({...good,size:"NaN"}).state,"BACKUP_OBJECT_NOT_VERIFIED");
});
test("workflow is guarded, uses India location and does not export live data to GitHub artifacts",()=>{
  const yml=readFileSync(new URL("../.github/workflows/india-books-backup.yml",import.meta.url),"utf8");
  assert.match(yml,/VYNDI_INDIA_BACKUP_COMMISSIONED/);
  assert.match(yml,/workflow_dispatch/);
  assert.match(yml,/schedule:/);
  assert.match(yml,/configure-aws-credentials/);
  assert.match(yml,/aws s3api get-bucket-location/);
  assert.match(yml,/get-bucket-object-lock-configuration/);
  assert.match(yml,/pg_dump/);
  assert.match(yml,/--no-owner/);
  assert.match(yml,/--no-acl/);
  assert.match(yml,/upload-artifact/);
  assert.doesNotMatch(yml,/path:\s*.*\.dump/i);
  assert.doesNotMatch(yml,/echo .*DATABASE_URL/);
});

test("restoration uses isolated PostgreSQL and requires real archive checksum",()=>{
  const yml=readFileSync(new URL("../.github/workflows/india-books-restore-drill.yml",import.meta.url),"utf8");
  assert.match(yml,/workflow_dispatch/);
  assert.match(yml,/VYNDI_INDIA_RESTORE_IAM_ROLE/);
  assert.match(yml,/postgres:18-alpine/);
  assert.match(yml,/pg_restore --exit-on-error/);
  assert.match(yml,/sha256sum/);
  assert.match(yml,/vyndi_books_edit_audit/);
  assert.doesNotMatch(yml,/path:\s*.*\.dump/i);
  assert.doesNotMatch(yml,/DROP DATABASE/i);
});
