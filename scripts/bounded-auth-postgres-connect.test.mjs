import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { requestSafePostgresDialect } from "../src/lib/auth/postgres-dialect.ts";

const source = await readFile(new URL("../src/lib/auth/postgres-dialect.ts", import.meta.url), "utf8");

test("production Better Auth connections have explicit bounded transport and query timeouts", () => {
  assert.match(source, /connectionTimeoutMillis:\s*3_500/);
  assert.match(source, /query_timeout:\s*10_000/);
  assert.doesNotMatch(source, /createClient:.*= \(\) => new Client\(\{ connectionString \}\)/);
});

function fakeClient({ error = null, successful = false, counters }) {
  return {
    async connect() {
      counters.connect += 1;
      if (error) throw error;
      if (!successful) throw new Error("unexpected attempt");
    },
    async end() { counters.end += 1; },
    async query() { return { rows: [], rowCount: 0 }; },
  };
}

test("transient connect failure retries once with a newly-created connection", async () => {
  const counters = { connect: 0, end: 0, creates: 0 };
  const temporary = Object.assign(new Error("temporary connection timeout"), { code: "ETIMEDOUT" });
  const dialect = requestSafePostgresDialect("postgres://not-contacted", () => {
    counters.creates += 1;
    return fakeClient({ error: counters.creates === 1 ? temporary : null, successful: counters.creates === 2, counters });
  });
  const driver = dialect.createDriver();
  const connection = await driver.acquireConnection();
  assert.equal(counters.creates, 2, "only one bounded retry");
  assert.equal(counters.connect, 2);
  await driver.releaseConnection(connection);
  assert.equal(counters.end, 2, "failed and successful clients closed");
});

test("nontransport SQL/auth errors never retry and never fall back to an identity", async () => {
  const counters = { connect: 0, end: 0, creates: 0 };
  const nonretryable = Object.assign(new Error("permission denied"), { code: "28P01" });
  const dialect = requestSafePostgresDialect("postgres://not-contacted", () => {
    counters.creates += 1;
    return fakeClient({ error: nonretryable, counters });
  });
  const driver = dialect.createDriver();
  await assert.rejects(driver.acquireConnection(), /permission denied/);
  assert.equal(counters.creates, 1);
  assert.equal(counters.end, 1);
});

test("transient connection failure remains fail-closed after one retry", async () => {
  const counters = { connect: 0, end: 0, creates: 0 };
  const temporary = Object.assign(new Error("connect timed out"), { code: "ETIMEDOUT" });
  const dialect = requestSafePostgresDialect("postgres://not-contacted", () => {
    counters.creates += 1;
    return fakeClient({ error: temporary, counters });
  });
  const driver = dialect.createDriver();
  await assert.rejects(driver.acquireConnection(), /timed out/);
  assert.equal(counters.creates, 2, "must never retry indefinitely");
  assert.equal(counters.end, 2);
});
