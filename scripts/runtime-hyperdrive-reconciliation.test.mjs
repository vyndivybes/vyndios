import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Hyperdrive is a least-privilege schema parity gate, never a runtime DDL writer", async () => {
  const source=await readFile("src/lib/db.server.ts","utf8");
  const start=source.indexOf("async function ensureHyperdriveSchemaReady");
  const end=source.indexOf("export async function readRuntimeSchemaMigrationStatus",start);
  assert.ok(start>=0 && end>start,"Hyperdrive schema gate must exist");
  const gate=source.slice(start,end);

  assert.match(gate,/planRuntimeSchemaMigrations/);
  assert.match(gate,/pg_advisory_xact_lock/);
  assert.match(gate,/SCHEMA_LAG/);
  assert.match(gate,/plan\.pending/);
  assert.doesNotMatch(gate,/create table if not exists _migrations/i);
  assert.doesNotMatch(gate,/client\.query\(migration\.sql/);
  assert.doesNotMatch(gate,/insert into _migrations/i);
});

test("getSqlServer checks schema parity before serving Hyperdrive SQL", async () => {
  const source=await readFile("src/lib/db.server.ts","utf8");
  const getSqlIndex=source.indexOf("export async function getSqlServer");
  const gateIndex=source.indexOf("await ensureHyperdriveSchemaReady",getSqlIndex);
  const serveIndex=source.indexOf("createPostgresSql",getSqlIndex);
  assert.ok(gateIndex>getSqlIndex);
  assert.ok(gateIndex<serveIndex);
});

test("runtime health stays fail-closed on schema lag", async () => {
  const source=await readFile("src/routes/api/runtime/health.ts","utf8");
  assert.match(source,/pendingMigrationCount/);
  assert.match(source,/schemaCurrent/);
  assert.match(source,/503/);
});
