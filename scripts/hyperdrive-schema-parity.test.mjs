import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const read=(p)=>readFile(new URL(`../${p}`,import.meta.url),"utf8");
const [dbServer,helper,health,diagnostic,pkg,migrator]=await Promise.all([
  read("src/lib/db.server.ts"),
  read("src/lib/runtime-schema-migrations.ts"),
  read("src/routes/api/runtime/health.ts"),
  read("src/routes/api/runtime/schema-diagnostic.ts"),
  read("package.json"),
  read("scripts/migrate.mjs"),
]);

test("Hyperdrive database requests never execute schema DDL before returning SQL",()=>{
  const start=dbServer.indexOf("export async function getSqlServer");
  const end=dbServer.indexOf("export async function getPgliteServer",start);
  const block=dbServer.slice(start,end);
  assert.match(block, /await ensureHyperdriveSchemaReady\(transport\)/);
  const gateStart=dbServer.indexOf("async function ensureHyperdriveSchemaReady");
  const gateEnd=dbServer.indexOf("export async function readRuntimeSchemaMigrationStatus",gateStart);
  assert.ok(gateStart>=0 && gateEnd>gateStart);
  const gate=dbServer.slice(gateStart,gateEnd);
  assert.match(gate,/SCHEMA_LAG/);
  assert.match(gate,/plan\.pending/);
  assert.doesNotMatch(gate,/create table|alter table|insert into _migrations|client\.query\(migration\.sql/i);
  assert.match(block,/createPostgresSql\(transport\)/);
});

test("runtime migration policy blocks destructive SQL and only permits Hyperdrive",()=>{
  assert.match(helper,/transportSource!=="hyperdrive"/);
  assert.match(helper,/DROP TABLE/);
  assert.match(helper,/DROP COLUMN/);
  assert.match(helper,/TRUNCATE/);
  assert.match(helper,/DELETE WITHOUT WHERE/);
});

test("runtime health exposes safe schema parity without database secrets",()=>{
  assert.match(health,/pendingMigrationCount/);
  assert.match(health,/latestExpectedMigration/);
  assert.match(health,/latestAppliedMigration/);
  assert.doesNotMatch(health,/connectionString|DATABASE_URL|HYPERDRIVE.*connection/i);
});

test("build migrator requires a privileged DATABASE_URL path for deployed schema changes",()=>{
  assert.match(migrator,/privileged DATABASE_URL migration/i);
  assert.doesNotMatch(migrator,/runtime Hyperdrive reconciliation will enforce schema before queries/i);
});

test("aggregate test gate includes Hyperdrive schema parity regression",()=>{
  assert.match(pkg,/hyperdrive-schema-parity\.test\.mjs/);
  assert.match(pkg,/runtime-schema-migrations\.test\.ts/);
});


test("runtime schema diagnostic detects lag without attempting DDL",()=>{
  const start=dbServer.indexOf("export async function getRuntimeSchemaDiagnosticServer");
  const end=dbServer.indexOf("function toSql",start);
  const block=dbServer.slice(start,end);
  assert.match(block,/readRuntimeSchemaMigrationStatus/);
  assert.match(block,/SCHEMA_LAG/);
  assert.doesNotMatch(block,/client\.query\(|CREATE TABLE|ALTER TABLE|DROP TRIGGER|CREATE TRIGGER/i);
});

test("safe schema diagnostic route reports migration failure without leaking connection details",()=>{
  assert.match(diagnostic,/createFileRoute\("\/api\/runtime\/schema-diagnostic"\)/);
  assert.match(diagnostic,/migrationName/);
  assert.match(diagnostic,/sqlState/);
  assert.doesNotMatch(diagnostic,/connectionString|DATABASE_URL|password|HYPERDRIVE.*connection/i);
});

