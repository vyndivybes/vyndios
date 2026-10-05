import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../src/lib/db.server.ts", import.meta.url), "utf8");

test("deployed PostgreSQL uses short-lived Clients instead of a retained request Pool", () => {
  const start = source.indexOf("async function createPostgresSql");
  const end = source.indexOf("async function createPgliteSql", start);
  const block = source.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.doesNotMatch(block, /new Pool\(/);
  assert.match(block, /createRequestPostgresLimiter\(/);
  assert.match(block, /new Client\(\{/);
  assert.match(block, /await client\.connect\(\)/);
  assert.match(block, /await client\.query\(text, params\)/);
  assert.match(block, /await client\.end\(\)/);
});

test("deployed SQL facade retains request-level concurrency bounding", async () => {
  const poolSource = await readFile(new URL("../src/lib/postgres-pool.ts", import.meta.url), "utf8");
  assert.match(poolSource, /DEFAULT_REQUEST_POSTGRES_CONCURRENCY\s*=\s*5/);
  assert.match(poolSource, /createRequestPostgresLimiter/);
});
