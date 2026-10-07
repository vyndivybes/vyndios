import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Hyperdrive reconciles non-destructive bundled migrations before serving SQL", async () => {
  const source=await readFile("src/lib/db.server.ts","utf8");

  assert.match(source,/planRuntimeSchemaMigrations/);
  assert.match(source,/__hyperdriveMigrationReady__/);
  assert.match(source,/ensureHyperdriveSchemaReady/);
  assert.match(source,/pg_advisory_xact_lock/);
  assert.match(source,/create table if not exists _migrations/i);
  assert.match(source,/insert into _migrations\(name\)/i);
  assert.match(source,/destructive migration policy/i);

  const getSqlIndex=source.indexOf("export async function getSqlServer");
  const reconcileIndex=source.indexOf("await ensureHyperdriveSchemaReady",getSqlIndex);
  const createSqlIndex=source.indexOf("createPostgresSql",getSqlIndex);
  assert.ok(getSqlIndex>=0,"getSqlServer must exist");
  assert.ok(reconcileIndex>getSqlIndex,"getSqlServer must reconcile Hyperdrive schema");
  assert.ok(reconcileIndex<createSqlIndex,"schema reconciliation must happen before SQL is served");
});

test("runtime health remains fail-closed on schema lag", async () => {
  const source=await readFile("src/routes/api/runtime/health.ts","utf8");
  assert.match(source,/pendingMigrationCount/);
  assert.match(source,/schemaCurrent/);
  assert.match(source,/503/);
});
