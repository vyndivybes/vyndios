import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../src/lib/db.server.ts", import.meta.url), "utf8");

test("deployed Postgres creates one bounded Pool per SQL facade, not one Pool per query", () => {
  const start = source.indexOf("async function createPostgresSql");
  const end = source.indexOf("async function createPgliteSql", start);
  const block = source.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(block, /const pool = new Pool\(requestSafePostgresPoolConfig\(transport\.connectionString\)\);[\s\S]*return toSql/);
  const runnerStart = block.indexOf("return toSql(async <T>");
  const runner = block.slice(runnerStart);
  assert.doesNotMatch(runner, /new Pool\(/);
  assert.match(runner, /await pool\.query\(text, params\)/);
  assert.doesNotMatch(runner, /await pool\.end\(\)/);
});

test("deployed pool retires clients after one query while bounding aggregate concurrency", async () => {
  const poolSource = await readFile(new URL("../src/lib/postgres-pool.ts", import.meta.url), "utf8");
  assert.match(poolSource, /max:\s*5/);
  assert.match(poolSource, /maxUses:\s*1/);
});
