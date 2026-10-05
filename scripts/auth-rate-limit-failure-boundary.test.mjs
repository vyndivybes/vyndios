import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("auth route fails closed with a distinct safe rate-limit backend error", async () => {
  const source = await readFile(new URL("../src/routes/api/auth/$.ts", import.meta.url), "utf8");
  assert.match(source, /AUTH_RATE_LIMIT_BACKEND_UNAVAILABLE/);
  assert.match(source, /status:\s*503/);
  assert.match(source, /catch\s*\(error\)/);
  assert.doesNotMatch(source, /error\.message|String\(error\)/);
});
