import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflow = await readFile(new URL("../.github/workflows/vyndi-backup-restore-qualification.yml", import.meta.url), "utf8");

test("restore is manual only, behind finance backup secret scope", () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /environment:\s*finance-backup/);
  assert.doesNotMatch(workflow, /^\s*(schedule|push|pull_request):/m);
});

test("decryption identity never becomes an output or plaintext artifact", () => {
  assert.match(workflow, /VYNDI_GOOGLE_BACKUP_AGE_IDENTITY/);
  assert.match(workflow, /age-keygen\s+-y/);
  assert.match(workflow, /age\s+--decrypt/);
  assert.match(workflow, /pg_restore.*--single-transaction/);
  assert.doesNotMatch(workflow, /upload-artifact|GITHUB_OUTPUT.*(IDENTITY|AGE_IDENTITY)/);
});

test("destination is a network-isolated ephemeral Postgres container, never production", () => {
  assert.match(workflow, /docker\s+run.*--network\s+none/);
  assert.match(workflow, /docker\s+exec.*pg_restore/);
  assert.match(workflow, /docker\s+stop/);
  assert.doesNotMatch(workflow, /BACKUP_READ_URL|DATABASE_URL|NEON_DATABASE_URL/);
});

test("restore checks source manifest and protected private table before acceptance", () => {
  assert.match(workflow, /eb2ba0c89dd4209992a6080c222759ac/);
  assert.match(workflow, /vyndi_private\.bi_dashboards/);
  assert.match(workflow, /restore.*qualification.*PASS/i);
});
