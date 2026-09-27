import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const route = readFileSync(
  new URL("../src/routes/api/engineering/authority.ts", import.meta.url),
  "utf8",
);
const engineeringAuthority = readFileSync(
  new URL("../src/lib/engineering-authority.ts", import.meta.url),
  "utf8",
);
const currentAuthority = readFileSync(
  new URL("../src/lib/engineering-current-authority.ts", import.meta.url),
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

test("R3-A is surfaced through the existing Engineering authority response", () => {
  assert.match(engineeringAuthority, /compileVedmAuthorityGraph/);
  assert.match(engineeringAuthority, /createVedmR3aSeed/);
  assert.match(engineeringAuthority, /vedmAuthorityGraph/);
});

test("R3-A pins the human-readable current authority summary to the same VEDM source", () => {
  assert.match(currentAuthority, /VEDM_R3A_SOURCE_REPOSITORY/);
  assert.match(currentAuthority, /VEDM_R3A_SOURCE_COMMIT/);
  assert.match(currentAuthority, /authorityGraphSchema:\s*"VYNDI_VEDM_AUTHORITY_GRAPH_V1"/);
});
