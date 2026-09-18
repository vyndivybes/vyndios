import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (path) => readFile(join(root, path), "utf8");

test("H1 structured telemetry is operational evidence only", async () => {
  const [observability, health, auth, vibpe] = await Promise.all([
    read("src/lib/observability/server.ts"),
    read("src/routes/api/runtime/health.ts"),
    read("src/lib/auth/server.ts"),
    read("src/lib/ibpe-copilot.ts"),
  ]);

  assert.match(observability, /event: "vyndi\.operational"/);
  assert.match(observability, /durationMs/);
  assert.match(observability, /sourceSha/);
  assert.match(auth, /component: "auth"/);
  assert.match(auth, /operation: "session-lookup"/);
  assert.match(vibpe, /component: "vibpe"/);
  assert.match(vibpe, /operation: "copilot-query"/);

  assert.match(health, /select 1::integer as ok/);
  assert.match(health, /governedIbpeRun/);
  assert.match(health, /cache-control": "no-store"/);
  assert.doesNotMatch(health, /\binsert\b|\bupdate\b|\bdelete\b/i);
  assert.doesNotMatch(observability, /password|bearerToken|questionText|financialPayload/i);
});

test("H1 SLO runner measures exact-SHA protected-route evidence without writes", async () => {
  const [runner, policy, freeze] = await Promise.all([
    read("scripts/vyndi-observability-slo.mjs"),
    read("docs/VYNDI-H1-OBSERVABILITY-SLO-REV1.md"),
    read("docs/VYNDI-V1-FUNCTIONAL-DESIGN-FREEZE.md"),
  ]);

  assert.match(runner, /\/api\/runtime\/release-marker/);
  assert.match(runner, /\/api\/runtime\/health/);
  assert.match(runner, /p50Ms/);
  assert.match(runner, /p95Ms/);
  assert.match(runner, /p99Ms/);
  assert.match(runner, /VYNDI_TEST_EXPECTED_SHA/);
  assert.match(runner, /mode: "read-only"/);
  assert.doesNotMatch(runner, /\.post\(|\.put\(|\.patch\(|\.delete\(/);

  assert.match(policy, />= 99\.9% successful probes/);
  assert.match(policy, /p95 <= 4 s; p99 <= 8 s/);
  assert.match(policy, /VIBPE Co-Pilot latency/);
  assert.match(policy, /Telemetry\/logs are derived operational evidence, not canonical business records/);
  assert.match(freeze, /ee47744b89b9f9aa16da0c110fc0cdfa8471c426/);
  assert.match(freeze, /Broad business-feature expansion pauses/);
});
