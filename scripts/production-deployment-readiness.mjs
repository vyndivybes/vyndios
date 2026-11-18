import { fileURLToPath } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

// Cloudflare deployment is an independently sequenced operation after a main push.
// Wait up to 20 minutes for exact-SHA publication, but never accept an old Worker.
export const PRODUCTION_READINESS_RETRY = Object.freeze({
  maxAttempts: 81,
  intervalMs: 15_000,
  maxWaitMs: 20 * 60_000,
  requestTimeoutMs: 10_000,
});

export function assessProductionHealth(status, value, expectedSha) {
  const expected = String(expectedSha ?? "").trim().toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(expected)) return { ready: false, reason: "EXPECTED_SHA_INVALID" };
  if (status !== 200 || !value || value.ok !== true) return { ready: false, reason: "RUNTIME_UNHEALTHY" };
  const observed = String(value.sourceSha ?? "").trim().toLowerCase();
  if (observed !== expected) return { ready: false, reason: "SOURCE_SHA_MISMATCH" };
  if (Number(value.pendingMigrationCount) !== 0) return { ready: false, reason: "PENDING_MIGRATIONS" };
  if (value.checks?.database !== "ok") return { ready: false, reason: "DATABASE_UNHEALTHY" };
  if (value.checks?.schema !== "current") return { ready: false, reason: "SCHEMA_NOT_CURRENT" };
  return { ready: true, reason: "PASS" };
}

async function writeEvidence(evidence) {
  const dir = resolve(".grok/evidence");
  await mkdir(dir, { recursive: true });
  await writeFile(resolve(dir, "production-assurance-exact-sha.json"), JSON.stringify(evidence, null, 2) + "\n");
}

async function main() {
  const target = (process.env.VYNDI_TEST_BASE_URL || "https://vyndios.vayushastr.workers.dev").replace(/\/$/, "");
  const expected = String(process.env.VYNDI_TEST_EXPECTED_SHA ?? "").trim().toLowerCase();
  if (!/^https:\/\//.test(target)) throw new Error("Production deployment gate requires HTTPS.");
  if (!/^[a-f0-9]{40}$/.test(expected)) throw new Error("Production SHA must be an exact 40-character commit SHA.");

  const maxAttempts = PRODUCTION_READINESS_RETRY.maxAttempts;
  const startedAt = Date.now();
  let last = { ready: false, reason: "NOT_CHECKED" };
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const remainingMs = PRODUCTION_READINESS_RETRY.maxWaitMs - (Date.now() - startedAt);
    if (remainingMs <= 0) break;
    let observedSha = null;
    let status = null;
    try {
      const result = await fetch(target + "/api/runtime/health", {
        headers: { "cache-control": "no-cache" },
        signal: AbortSignal.timeout(Math.min(PRODUCTION_READINESS_RETRY.requestTimeoutMs, remainingMs)),
      });
      status = result.status;
      const payload = await result.json();
      observedSha = typeof payload?.sourceSha === "string" ? payload.sourceSha : null;
      last = assessProductionHealth(status, payload, expected);
    } catch {
      last = { ready: false, reason: "HEALTH_REQUEST_UNAVAILABLE" };
    }
    if (last.ready) {
      await writeEvidence({ verdict: "PASS", expectedSha: expected, observedSha, httpStatus: status, attempt, checkedAt: new Date().toISOString() });
      console.log("Exact production deployment gate PASS", expected, "attempt", attempt);
      return;
    }
    console.log("Production deployment not yet qualified", "attempt", attempt, "reason", last.reason);
    const waitMs = Math.min(PRODUCTION_READINESS_RETRY.intervalMs,
      Math.max(0, PRODUCTION_READINESS_RETRY.maxWaitMs - (Date.now() - startedAt)));
    if (attempt < maxAttempts && waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));
  }

  await writeEvidence({ verdict: "UNVERIFIED", expectedSha: expected, reason: last.reason, checkedAt: new Date().toISOString() });
  throw new Error("Exact production deployment qualification timed out: " + last.reason);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Production deployment readiness failed");
    process.exitCode = 1;
  });
}
