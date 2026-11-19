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
  assert.throws(() => assessBackupRoleEvidence("neondb_owner|f|t|f|f|t|248|0|0|1"), /dedicated/);
});

test("rejects role escalation and table mutation grants", () => {
  assert.throws(() => assessBackupRoleEvidence("vyndi_books_backup_ro|t|t|f|f|t|248|0|0|1"), /privileged/);
  assert.throws(() => assessBackupRoleEvidence("vyndi_books_backup_ro|f|t|f|f|t|248|0|1|1"), /mutation/);
  assert.throws(() => assessBackupRoleEvidence("vyndi_books_backup_ro|f|t|f|t|t|248|0|0|1"), /privileged/);
});

test("rejects truncated and missing table coverage and unexpected textual fields", () => {
  assert.throws(() => assessBackupRoleEvidence("vyndi_books_backup_ro|f|t|f|f|t|248|1|0|1"), /SELECT/);
  assert.throws(() => assessBackupRoleEvidence("vyndi_books_backup_ro|f|t|f|f|t|0|0|0|0"), /tables/);
  assert.throws(() => assessBackupRoleEvidence(valid + "|password=secret"), /format/);
  assert.throws(() => assessBackupRoleEvidence(valid + "\n" + valid), /format/);
});
