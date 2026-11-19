import test from "node:test";
import assert from "node:assert/strict";
import { assessBackupRoleEvidence } from "./backup-authority-preflight.mjs";

const valid = "vyndi_books_backup_ro|f|t|f|f|t|248|0|0|1";

test("accepts a dedicated non-superuser backup account with complete read authority", () => {
  assert.deepEqual(assessBackupRoleEvidence(valid), { tableCount: 248, rlsTableCount: 1 });
});

test("fails closed when a backup account is missing RLS authority", () => {
  assert.throws(() => assessBackupRoleEvidence("vyndi_books_backup_ro|f|f|f|f|t|248|0|0|1"), /RLS/);
});

test("rejects an owner or unexpected role, even if it can bypass RLS", () => {
  assert.throws(() => assessBackupRoleEvidence("neondb_owner|f|t|f|f|t|248|0|0|1"), /DEDICATED/);
});

test("rejects role escalation and table mutation grants", () => {
  assert.throws(() => assessBackupRoleEvidence("vyndi_books_backup_ro|t|t|f|f|t|248|0|0|1"), /PRIVILEGED/);
  assert.throws(() => assessBackupRoleEvidence("vyndi_books_backup_ro|f|t|f|f|t|248|0|1|1"), /MUTATION/);
  assert.throws(() => assessBackupRoleEvidence("vyndi_books_backup_ro|f|t|f|t|t|248|0|0|1"), /PRIVILEGED/);
});

test("rejects truncated and missing table coverage and unexpected textual fields", () => {
  assert.throws(() => assessBackupRoleEvidence("vyndi_books_backup_ro|f|t|f|f|t|248|1|0|1"), /SELECT/);
  assert.throws(() => assessBackupRoleEvidence("vyndi_books_backup_ro|f|t|f|f|t|0|0|0|0"), /TABLES/);
  assert.throws(() => assessBackupRoleEvidence(valid + "|password=secret"), /FORMAT/);
  assert.throws(() => assessBackupRoleEvidence(valid + "\n" + valid), /FORMAT/);
});

test("supplementary encrypted backup verifies role authority before pg_dump, without a row-security waiver", async () => {
  const { readFile } = await import("node:fs/promises");
  const workflow = await readFile(new URL("../.github/workflows/google-drive-books-backup.yml", import.meta.url), "utf8");
  const gate = workflow.indexOf("- name: Fail closed on backup role completeness and RLS authorization");
  const exportStep = workflow.indexOf("- name: Stream-read PostgreSQL custom archive directly into age encryption");
  assert.ok(gate > 0 && exportStep > gate, "role evidence must gate encrypted export");
  assert.match(workflow, /backup-role-evidence\.sql/);
  assert.match(workflow, /backup-authority-preflight\.mjs/);
  assert.doesNotMatch(workflow, /pg_dump\s+--enable-row-security/);
  assert.doesNotMatch(workflow, /ALTER\s+ROLE|DISABLE\s+ROW\s+LEVEL\s+SECURITY/i);
});
