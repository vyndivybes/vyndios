import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const baseUrl = (process.env.VYNDI_TEST_BASE_URL || "http://127.0.0.1:8081").replace(/\/$/, "");
const email = process.env.VYNDI_TEST_EMAIL;
const password = process.env.VYNDI_TEST_PASSWORD;
const expectedSha = process.env.VYNDI_TEST_EXPECTED_SHA?.trim() || "";
const sampleCount = Math.max(1, Math.min(10, Number(process.env.VYNDI_SLO_SAMPLE_COUNT || 3)));
const enforceLatency = process.env.VYNDI_SLO_ENFORCE_LATENCY === "1";
const routeP95LimitMs = Number(process.env.VYNDI_SLO_ROUTE_P95_LIMIT_MS || 4000);
const routeP99LimitMs = Number(process.env.VYNDI_SLO_ROUTE_P99_LIMIT_MS || 8000);
const evidenceRoot = resolve(
  process.env.VYNDI_SLO_EVIDENCE_DIR ||
    `.grok/evidence/observability-slo-${new Date().toISOString().replace(/[:.]/g, "-")}`,
);

if (!email) throw new Error("VYNDI_TEST_EMAIL is required.");
if (!password) throw new Error("VYNDI_TEST_PASSWORD is required.");

const protectedRoutes = [
  "/command",
  "/command/sales",
  "/command/inventory",
  "/command/operations",
  "/command/quality",
  "/command/actuals",
  "/command/financial-cockpit",
  "/command/ibpe-operating-workspace/assurance",
];

function percentile(values, p) {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const index = Math.min(ordered.length - 1, Math.max(0, Math.ceil((p / 100) * ordered.length) - 1));
  return ordered[index];
}

function stats(samples) {
  const durations = samples.map((sample) => sample.durationMs);
  const failures = samples.filter((sample) => !sample.ok);
  return {
    samples: samples.length,
    successes: samples.length - failures.length,
    failures: failures.length,
    errorRate: samples.length ? failures.length / samples.length : 1,
    p50Ms: percentile(durations, 50),
    p95Ms: percentile(durations, 95),
    p99Ms: percentile(durations, 99),
    maxMs: durations.length ? Math.max(...durations) : null,
  };
}

await mkdir(evidenceRoot, { recursive: true });
const report = {
  test: "VYNDI H1 observability/SLO evidence",
  mode: "read-only",
  baseUrl,
  expectedSha: expectedSha || null,
  sampleCount,
  startedAt: new Date().toISOString(),
  releaseMarker: null,
  health: null,
  routes: [],
  summary: null,
  result: "RUNNING",
};

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });

try {
  const markerResponse = await context.request.get(`${baseUrl}/api/runtime/release-marker`);
  assert.ok(markerResponse.ok(), `Release marker returned HTTP ${markerResponse.status()}`);
  const marker = await markerResponse.json();
  report.releaseMarker = { status: markerResponse.status(), marker };
  if (expectedSha) {
    assert.equal(String(marker?.sourceSha || "").toLowerCase(), expectedSha.toLowerCase(), "Deployment SHA mismatch.");
  }

  const healthStarted = Date.now();
  const healthResponse = await context.request.get(`${baseUrl}/api/runtime/health`);
  const healthBody = await healthResponse.json().catch(() => ({}));
  report.health = {
    status: healthResponse.status(),
    durationMs: Date.now() - healthStarted,
    body: healthBody,
  };
  assert.ok(healthResponse.ok(), `Runtime health returned HTTP ${healthResponse.status()}`);
  assert.equal(healthBody?.checks?.database, "ok", "Runtime health did not confirm database readiness.");

  const login = await context.newPage();
  const loginStarted = Date.now();
  const loginResponse = await login.goto(`${baseUrl}/login?returnTo=%2Fcommand`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  assert.ok(loginResponse?.ok(), `Login page returned HTTP ${loginResponse?.status() ?? "none"}`);
  await login.getByLabel(/Authorised Email/i).fill(email);
  await login.getByLabel(/^Password$/i).fill(password);
  await login.getByRole("button", { name: /Authorize · Enter Command/i }).click();
  await login.waitForURL(/\/command(?:\/|$)/, { timeout: 45_000, waitUntil: "domcontentloaded" });
  report.login = { durationMs: Date.now() - loginStarted, ok: true };
  await login.close();

  for (const route of protectedRoutes) {
    for (let sample = 1; sample <= sampleCount; sample += 1) {
      const page = await context.newPage();
      const pageErrors = [];
      page.on("pageerror", (error) => pageErrors.push(String(error?.message || error)));
      const started = Date.now();
      let status = null;
      let ok = false;
      let error = null;
      try {
        const response = await page.goto(`${baseUrl}${route}`, {
          waitUntil: "domcontentloaded",
          timeout: route.includes("assurance") ? 90_000 : 60_000,
        });
        status = response?.status() ?? null;
        await page.locator("body").waitFor({ state: "visible", timeout: 30_000 });
        await page.waitForFunction(() => (document.body?.innerText || "").trim().length > 40, undefined, { timeout: 30_000 });
        const body = (await page.locator("body").innerText()).trim();
        assert.ok(response?.ok(), `${route} returned HTTP ${status ?? "none"}`);
        assert.doesNotMatch(page.url(), /\/login(?:\?|$)|\/command-login/, `${route} lost authenticated access`);
        assert.doesNotMatch(body, /Something went wrong|Internal Server Error|Cannot read properties of undefined/i, `${route} rendered a fatal error`);
        assert.deepEqual(pageErrors, [], `${route} emitted browser errors: ${pageErrors.join(" | ")}`);
        ok = true;
      } catch (caught) {
        error = caught instanceof Error ? caught.message : String(caught);
      } finally {
        report.routes.push({
          route,
          sample,
          status,
          ok,
          durationMs: Date.now() - started,
          pageErrors,
          error,
        });
        await page.close().catch(() => {});
      }
    }
  }

  const aggregate = stats(report.routes);
  const byRoute = Object.fromEntries(
    protectedRoutes.map((route) => [route, stats(report.routes.filter((sample) => sample.route === route))]),
  );
  report.summary = { aggregate, byRoute };
  assert.equal(aggregate.failures, 0, `SLO probe observed ${aggregate.failures} protected-route failures.`);
  if (enforceLatency) {
    assert.ok((aggregate.p95Ms ?? Infinity) <= routeP95LimitMs, `Protected-route p95 ${aggregate.p95Ms}ms exceeds ${routeP95LimitMs}ms.`);
    assert.ok((aggregate.p99Ms ?? Infinity) <= routeP99LimitMs, `Protected-route p99 ${aggregate.p99Ms}ms exceeds ${routeP99LimitMs}ms.`);
  }

  report.result = "PASS";
  report.completedAt = new Date().toISOString();
  console.log(JSON.stringify({ event: "vyndi.slo.evidence", sourceSha: marker?.sourceSha ?? null, health: report.health, summary: report.summary }, null, 2));
} catch (error) {
  report.result = "FAIL";
  report.completedAt = new Date().toISOString();
  report.error = error instanceof Error ? error.stack || error.message : String(error);
  throw error;
} finally {
  await writeFile(resolve(evidenceRoot, "slo-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
}
