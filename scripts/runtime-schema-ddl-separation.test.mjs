import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const dbServer = await readFile(new URL("../src/lib/db.server.ts", import.meta.url), "utf8");
const migrator = await readFile(new URL("./migrate.mjs", import.meta.url), "utf8");

test("normal Hyperdrive SQL never performs runtime schema DDL", () => {
  const start = dbServer.indexOf("export async function getSqlServer");
  const end = dbServer.indexOf("export async function getPgliteServer", start);
  const block = dbServer.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(block, /await ensureHyperdriveSchemaReady\(transport\)/);
  const gateStart=dbServer.indexOf("async function ensureHyperdriveSchemaReady");
  const gateEnd=dbServer.indexOf("export async function readRuntimeSchemaMigrationStatus",gateStart);
  assert.ok(gateStart>=0 && gateEnd>gateStart);
  const gate=dbServer.slice(gateStart,gateEnd);
  assert.match(gate,/SCHEMA_LAG/);
  assert.match(gate,/plan\.pending/);
  assert.doesNotMatch(gate,/create table|alter table|insert into _migrations|client\.query\(migration\.sql/i);
  assert.match(block, /createPostgresSql\(transport\)/);
});

test("schema diagnostic is detection-only for deployed Hyperdrive", () => {
  const start = dbServer.indexOf("export async function getRuntimeSchemaDiagnosticServer");
  const end = dbServer.indexOf("function toSql", start);
  const block = dbServer.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.doesNotMatch(block, /ensureHyperdriveSchemaReady/);
  assert.match(block, /readRuntimeSchemaMigrationStatus/);
  assert.match(block, /SCHEMA_LAG/);
});

test("deploy migrator no longer claims restricted runtime role will apply DDL", () => {
  assert.doesNotMatch(migrator, /runtime Hyperdrive reconciliation will enforce schema before queries/i);
  assert.match(migrator, /privileged DATABASE_URL migration/i);
});

