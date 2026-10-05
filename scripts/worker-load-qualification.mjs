import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

if (process.env.VYNDI_LOAD_TEST_ENABLE !== "1") {
  throw new Error("Set VYNDI_LOAD_TEST_ENABLE=1 to run the controlled Worker load qualification.");
}

const baseUrl = (process.env.VYNDI_TEST_BASE_URL || "https://vyndios.vayushastr.workers.dev").replace(/\/$/, "");
const email = process.env.VYNDI_TEST_EMAIL;
const password = process.env.VYNDI_TEST_PASSWORD;
const expectedSha = process.env.VYNDI_TEST_EXPECTED_SHA;
const targetRoute = process.env.VYNDI_LOAD_TEST_ROUTE || "/command/inventory";
const maxP95Ms = Number(process.env.VYNDI_LOAD_TEST_MAX_P95_MS || 10000);
const levels = (process.env.VYNDI_LOAD_LEVELS || "1,5,20,100").split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0);
if (!email || !password || !expectedSha) throw new Error("VYNDI_TEST_EMAIL, VYNDI_TEST_PASSWORD and VYNDI_TEST_EXPECTED_SHA are required.");

const marker = await fetch(`${baseUrl}/api/runtime/release-marker`);
assert.equal(marker.status, 200, "release marker unavailable");
const markerBody = await marker.json();
assert.equal(markerBody.sourceSha, expectedSha, "load qualification target SHA mismatch");

const evidenceDir = resolve(process.env.VYNDI_LOAD_EVIDENCE_DIR || "artifacts/worker-load");
await mkdir(evidenceDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
try {
  const login = await context.newPage();
  await login.goto(`${baseUrl}/login?returnTo=%2Fcommand`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await login.locator(".vy-login.is-cinematic").waitFor({ state: "visible", timeout: 30_000 });
  await login.getByLabel(/Authorised Email/i).fill(email);
  await login.getByLabel(/^Password$/i).fill(password);
  await login.getByRole("button", { name: /Authorize · Enter Command/i }).click();
  await login.waitForURL(/\/command(?:\/|$)/, { timeout: 45_000, waitUntil: "domcontentloaded" });
  await login.close();

  const results = [];
  for (const concurrency of levels) {
    const pages = await Promise.all(Array.from({ length: concurrency }, () => context.newPage()));
    const samples = await Promise.all(pages.map(async (page) => {
      const started = Date.now();
      const response = await page.goto(`${baseUrl}${targetRoute}`, { waitUntil: "domcontentloaded", timeout: 90_000 }).catch(() => null);
      const durationMs = Date.now() - started;
      const status = response?.status() ?? 0;
      await page.close().catch(() => {});
      return { status, durationMs };
    }));

    const durations = samples.map((sample) => sample.durationMs).sort((a, b) => a - b);
    const failures = samples.filter((sample) => sample.status < 200 || sample.status >= 400);
    const p95Index = Math.max(0, Math.ceil(durations.length * 0.95) - 1);
    const p95Ms = durations[p95Index] ?? 0;
    const result = { concurrency, requests: samples.length, failures: failures.length, p95Ms, statuses: [...new Set(samples.map((s) => s.status))] };
    results.push(result);
    console.log(`[worker-load] C=${concurrency} · failures=${failures.length} · p95=${p95Ms}ms`);
    assert.equal(failures.length, 0, `Worker load qualification had ${failures.length} failure(s) at concurrency ${concurrency}`);
    assert.ok(p95Ms <= maxP95Ms, `Worker p95 ${p95Ms}ms exceeded ${maxP95Ms}ms at concurrency ${concurrency}`);
  }

  await writeFile(resolve(evidenceDir, "worker-load-qualification.json"), JSON.stringify({
    qualification: "WORKER-LOAD-PQ",
    sourceSha: expectedSha,
    targetRoute,
    levels,
    maxP95Ms,
    results,
  }, null, 2) + "\n");
  console.log("[worker-load] PASS · controlled 1/5/20/100 concurrency qualification");
} finally {
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
}
