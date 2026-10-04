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

test("Hyperdrive database requests reconcile the migration ledger before returning SQL",()=>{
  assert.match(dbServer,/ensureHyperdriveSchemaReady/);
  assert.match(dbServer,/pg_advisory_xact_lock/);
  assert.match(dbServer,/create table if not exists _migrations/i);
  assert.match(dbServer,/planRuntimeSchemaMigrations/);
  assert.match(dbServer,/await ensureHyperdriveSchemaReady\(transport\)/);
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

test("build migrator documents Hyperdrive runtime reconciliation instead of silently claiming schema readiness",()=>{
  assert.match(migrator,/runtime Hyperdrive reconciliation/i);
});

test("aggregate test gate includes Hyperdrive schema parity regression",()=>{
  assert.match(pkg,/hyperdrive-schema-parity\.test\.mjs/);
  assert.match(pkg,/runtime-schema-migrations\.test\.ts/);
});


test("runtime Hyperdrive migrator uses a transaction-scoped lock per migration and rechecks the ledger",()=>{
  assert.match(dbServer,/pg_advisory_xact_lock/);
  assert.match(dbServer,/for\(;;\)/);
  assert.match(dbServer,/plan\.pending\[0\]/);
  assert.match(dbServer,/await client\.query\("BEGIN"\)/);
  assert.match(dbServer,/insert into _migrations\(name\)/i);
  assert.match(dbServer,/await client\.query\("COMMIT"\)/);
  assert.match(dbServer,/select name from _migrations/);
  assert.doesNotMatch(dbServer,/pg_advisory_unlock/);
  assert.doesNotMatch(dbServer,/pg_advisory_lock\(/);
});

test("safe schema diagnostic route reports migration failure without leaking connection details",()=>{
  assert.match(diagnostic,/createFileRoute\("\/api\/runtime\/schema-diagnostic"\)/);
  assert.match(diagnostic,/migrationName/);
  assert.match(diagnostic,/sqlState/);
  assert.doesNotMatch(diagnostic,/connectionString|DATABASE_URL|password|HYPERDRIVE.*connection/i);
});
