import test from "node:test";
import assert from "node:assert/strict";
import { assessProductionHealth, PRODUCTION_READINESS_RETRY } from "./production-deployment-readiness.mjs";

const SHA = "60f4886e3746dbc92842df49294fdc3bdd067484";
const healthy = {
  ok: true,
  sourceSha: SHA,
  pendingMigrationCount: 0,
  checks: { database: "ok", schema: "current" },
};

test("only exact source with current production database and migrations can pass", () => {
  assert.deepEqual(assessProductionHealth(200, healthy, SHA), { ready: true, reason: "PASS" });
});

test("older Cloudflare deployment remains unqualified even while it responds 200", () => {
  const decision = assessProductionHealth(200, { ...healthy, sourceSha: "ecec11329c194977d4d2068507fa39df131fecd4" }, SHA);
  assert.equal(decision.ready, false);
  assert.equal(decision.reason, "SOURCE_SHA_MISMATCH");
});

test("database unreachable and incomplete migrations both fail closed", () => {
  assert.equal(assessProductionHealth(503, healthy, SHA).ready, false);
  assert.equal(assessProductionHealth(200, { ...healthy, pendingMigrationCount: 1 }, SHA).reason, "PENDING_MIGRATIONS");
  assert.equal(assessProductionHealth(200, { ...healthy, checks: { database: "unavailable", schema: "current" } }, SHA).ready, false);
  assert.equal(assessProductionHealth(200, { ...healthy, checks: { database: "ok", schema: "lagging" } }, SHA).ready, false);
});

test("missing or truncated source SHA never passes", () => {
  assert.equal(assessProductionHealth(200, { ...healthy, sourceSha: "" }, SHA).ready, false);
  assert.equal(assessProductionHealth(200, healthy, "short").ready, false);
  assert.equal(assessProductionHealth(200, healthy, "").ready, false);
});

test("application ok=false overrides any matching SHA", () => {
  assert.equal(assessProductionHealth(200, { ...healthy, ok: false }, SHA).ready, false);
  assert.equal(assessProductionHealth(200, null, SHA).ready, false);
});

test("deployment retry budget accommodates an independently deployed Cloudflare worker", () => {
  // The previous main assurance timed out about 60 seconds before Cloudflare deployed its exact SHA.
  assert.equal(PRODUCTION_READINESS_RETRY.maxWaitMs, 20 * 60_000);
  assert.ok(PRODUCTION_READINESS_RETRY.maxAttempts * PRODUCTION_READINESS_RETRY.intervalMs >= PRODUCTION_READINESS_RETRY.maxWaitMs);
  assert.ok(PRODUCTION_READINESS_RETRY.requestTimeoutMs <= PRODUCTION_READINESS_RETRY.intervalMs);
});

test("production assurance job permits the full fail-closed deployment retry budget", async () => {
  const { readFile } = await import("node:fs/promises");
  const yaml = await readFile(new URL("../.github/workflows/production-assurance.yml", import.meta.url), "utf8");
  const match = yaml.match(/- name: Wait for exact Cloudflare deployment and schema readiness\s+timeout-minutes:\s*(\d+)/);
  assert.ok(match, "exact production deployment gate has an explicit timeout");
  assert.ok(Number(match[1]) * 60_000 >= PRODUCTION_READINESS_RETRY.maxWaitMs + 60_000);
});
