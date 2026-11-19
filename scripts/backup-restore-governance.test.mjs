import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workflow = await readFile(new URL("../.github/workflows/vyndi-backup-restore-qualification.yml", import.meta.url), "utf8");
const sql = await readFile(new URL("./backup-restore-least-privilege.sql", import.meta.url), "utf8");
const dossier = await readFile(new URL("../docs/backup-dr-acceptance-2026-11-19.md", import.meta.url), "utf8");

test("restored BI readback runs as separate isolated non-login, non-bypass and non-writer role", () => {
  assert.match(sql, /CREATE ROLE vyndi_restore_readback NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS/);
  assert.match(sql, /GRANT SELECT ON (?:TABLE )?vyndi_private\.bi_dashboards TO vyndi_restore_readback/);
  assert.match(sql, /CREATE POLICY[\s\S]*? TO vyndi_restore_readback/);
  assert.match(sql, /SET ROLE vyndi_restore_readback/);
  assert.match(sql, /COUNT\(\*\).*vyndi_private\.bi_dashboards/s);
  assert.match(sql, /has_table_privilege\(current_user,.*INSERT/s);
  assert.match(sql, /has_table_privilege\(current_user,.*public\.\"user\"/s);
});
test("readback is attached after restore, before reporting pass, without external network", () => {
  const restored = workflow.indexOf("pg_restore --single-transaction");
  const verified = workflow.indexOf("backup-restore-least-privilege.sql");
  const summary = workflow.indexOf("restore qualification PASS");
  assert.ok(restored > 0 && verified > restored && summary > verified);
  assert.match(workflow, /docker run -d --rm --network none/);
  assert.match(workflow, /restore_start_epoch=/);
  assert.match(workflow, /measured_restore_seconds/);
  assert.doesNotMatch(workflow, /BACKUP_READ_URL|NEON_DATABASE_URL|DATABASE_URL/);
});
test("dossier distinguishes measured isolated recovery from unaccepted RTO and RPO targets", () => {
  assert.match(dossier, /2026-11-19T09:27:05Z/);
  assert.match(dossier, /2026-11-19T09:28:18Z/);
  assert.match(dossier, /2026-11-19T12:54:58Z/);
  assert.match(dossier, /2026-11-19T12:55:27Z/);
  assert.match(dossier, /29 seconds/);
  assert.match(dossier, /RTO[^\n]*not[^\n]*certified/i);
  assert.match(dossier, /RPO[^\n]*not[^\n]*certified/i);
  assert.match(dossier, /BYPASSRLS/);
  assert.match(dossier, /external files/);
});
