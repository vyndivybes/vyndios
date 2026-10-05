import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Better Auth 500 path emits only safe schema/adapter diagnostics", async () => {
  const source = await readFile(new URL("../src/lib/auth/server.ts", import.meta.url), "utf8");
  assert.match(source, /diagnoseBetterAuthSchema/);
  assert.match(source, /AUTH_SCHEMA_INCOMPATIBLE/);
  assert.match(source, /BETTER_AUTH_HANDLER_FAILED/);
  assert.match(source, /information_schema\.columns/);
  assert.doesNotMatch(source, /responseBody.*password|password.*responseBody/i);
});
