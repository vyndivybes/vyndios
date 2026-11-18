import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const authServer = await readFile(new URL("../src/lib/auth/server.ts", import.meta.url), "utf8");
const verify = await readFile(new URL("../src/lib/auth/verify.server.ts", import.meta.url), "utf8");

test("SSR Better Auth getSession is wrapped in the same request-local Postgres lifecycle as the auth endpoint", () => {
  assert.match(authServer, /export async function withAuthPostgresRequest/);
  assert.match(authServer, /postgresAuthDialect\s*\?\s*postgresAuthDialect\.runInRequest\(work\)/);
  assert.match(verify, /withAuthPostgresRequest\(\(\)\s*=>\s*auth\.api\.getSession\(\{\s*headers\s*\}\)\)/);
});

test("SSR getSession remains fail-closed on errors; no fabricated user identity", () => {
  assert.match(verify, /logSessionLookupFailure\(request, error\)/);
  assert.match(verify, /throw error/);
  assert.doesNotMatch(verify, /return\s+\{\s*id:\s*["']dev-user["']/);
});
