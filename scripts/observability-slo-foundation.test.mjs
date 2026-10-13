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

test("SLO failures surface route-by-route diagnostics without disclosing browser data", async () => {
  const { summarizePublicFailureDiagnostics } = await import("./slo-failure-diagnostics.mjs");
  const routes = [
    { route: "/command", ok: true, status: 200, durationMs: 50 },
    { route: "/command/sales", ok: false, status: 503, durationMs: 500, error: "secret=DO_NOT_EXPOSE", pageErrors: ["DO_NOT_EXPOSE"] },
    { route: "/command/sales", ok: false, status: null, durationMs: 60000, error: "page.goto: Timeout 60000ms exceeded https://private" },
    { route: "/command/inventory", ok: false, status: 200, durationMs: 150, error: "lost authenticated access: session DO_NOT_EXPOSE" },
    { route: "/command/quality", ok: false, status: 200, durationMs: 250, pageErrors: ["token DO_NOT_EXPOSE"], error: "browser emitted errors" },
  ];
  const result = summarizePublicFailureDiagnostics(routes);
  assert.equal(result.failures, 4);
  assert.equal(result.routeFailures.length, 3);
  assert.deepEqual(result.routeFailures.find(r => r.route === "/command/sales").reasons, {
    HTTP_5XX: 1, NAVIGATION_TIMEOUT: 1,
  });
  assert.deepEqual(result.routeFailures.find(r => r.route === "/command/inventory").reasons, { AUTH_REDIRECT: 1 });
  assert.deepEqual(result.routeFailures.find(r => r.route === "/command/quality").reasons, { BROWSER_EXCEPTION: 1 });
  assert.doesNotMatch(JSON.stringify(result), /DO_NOT_EXPOSE|private|secret|token/);
});

test("SLO must emit safe failure breakdown before fail-closed assertion and retain latency gates", async () => {
  const runner = await read("scripts/vyndi-observability-slo.mjs");
  assert.match(runner, /summarizePublicFailureDiagnostics/);
  const diagnosticPos = runner.indexOf('event: "vyndi.slo.failure-diagnostics"');
  const failedAssertionPos = runner.indexOf("assert.equal(aggregate.failures, 0");
  assert.ok(diagnosticPos > 0 && diagnosticPos < failedAssertionPos, "Safe diagnostics must appear before failure throws");
  assert.match(runner, /aggregate\.p95Ms/);
  assert.match(runner, /aggregate\.p99Ms/);
  assert.match(runner, /report\.summary = \{ aggregate, byRoute \}/);
});
