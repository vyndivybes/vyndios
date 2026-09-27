import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const route = readFileSync(
  new URL("../src/routes/api/engineering/authority.ts", import.meta.url),
  "utf8",
);

test("R3-A authority API is authenticated and compiles the pinned VEDM graph", () => {
  assert.match(route, /requireBusinessActor\("view"\)/);
  assert.match(route, /createVedmR3aSeed/);
  assert.match(route, /compileVedmAuthorityGraph/);
  assert.match(route, /sourceCommit/);
  assert.match(route, /authorityByDomain/);
  assert.match(route, /blockingGateIds/);
});

test("R3-A authority API supports deterministic graph trace without mutation", () => {
  assert.match(route, /traceAuthorityPath/);
  assert.match(route, /searchParams\.get\("from"\)/);
  assert.match(route, /searchParams\.get\("to"\)/);
  assert.doesNotMatch(route, /POST\s*:/);
  assert.doesNotMatch(route, /PUT\s*:/);
  assert.doesNotMatch(route, /DELETE\s*:/);
});
