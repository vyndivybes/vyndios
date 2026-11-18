import test from "node:test";
import assert from "node:assert/strict";
import { Kysely } from "kysely";
import { requestSafePostgresDialect } from "../src/lib/auth/postgres-dialect.ts";

test("Better Auth resolves transport on each new request, not at Worker module initialization", async () => {
  let current = "postgresql://redacted-first";
  const events = [];
  const dialect = requestSafePostgresDialect(
    async () => current,
    (url) => ({
      async connect() { events.push("connect:" + url); },
      async query() { events.push("query:" + url); return { rows: [{ token: url }], rowCount: 1 }; },
      async end() { events.push("end:" + url); },
    }),
  );
  const db = new Kysely({ dialect });
  await dialect.runInRequest(async () => {
    assert.deepEqual(await db.selectFrom("session").selectAll().execute(), [{ token: current }]);
    assert.deepEqual(await db.selectFrom("session").selectAll().execute(), [{ token: current }]);
  });
  current = "postgresql://redacted-second";
  await dialect.runInRequest(async () => {
    assert.deepEqual(await db.selectFrom("session").selectAll().execute(), [{ token: current }]);
  });
  assert.deepEqual(events, [
    "connect:postgresql://redacted-first", "query:postgresql://redacted-first",
    "query:postgresql://redacted-first", "end:postgresql://redacted-first",
    "connect:postgresql://redacted-second", "query:postgresql://redacted-second",
    "end:postgresql://redacted-second",
  ]);
  await db.destroy();
});

test("a failed transport resolver fails closed without opening a database connection", async () => {
  let created = 0;
  const dialect = requestSafePostgresDialect(
    async () => { throw new Error("TRANSPORT_NOT_READY"); },
    () => { created++; throw new Error("must not connect"); },
  );
  const db = new Kysely({ dialect });
  await assert.rejects(
    () => dialect.runInRequest(() => db.selectFrom("session").selectAll().execute()),
    /TRANSPORT_NOT_READY/,
  );
  assert.equal(created, 0);
  await db.destroy();
});

test("Better Auth server supplies a live request-time PostgreSQL resolver", async () => {
  const { readFile } = await import("node:fs/promises");
  const authServer = await readFile(new URL("../src/lib/auth/server.ts", import.meta.url), "utf8");
  assert.match(authServer, /requestSafePostgresDialect\(async\s*\(\)\s*=>/);
  assert.doesNotMatch(authServer, /requestSafePostgresDialect\(postgresTransport\.connectionString\)/);
});
