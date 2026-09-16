import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const baseUrl = (process.env.VYNDI_TEST_BASE_URL || "https://tiger-field-flora-finch.shyamsundhar1982.workers.dev").replace(/\/$/, "");
const email = process.env.VYNDI_TEST_EMAIL;
const password = process.env.VYNDI_TEST_PASSWORD;
const expectedSha = process.env.VYNDI_TEST_EXPECTED_SHA?.trim() || "";
const headed = process.env.VYNDI_TEST_HEADED === "1";
const evidenceRoot = resolve(
  process.env.VYNDI_TEST_EVIDENCE_DIR ||
    `.grok/evidence/playwright-production-${new Date().toISOString().replace(/[:.]/g, "-")}`,
);

if (!email) throw new Error("VYNDI_TEST_EMAIL is required.");
if (!password) throw new Error("VYNDI_TEST_PASSWORD is required.");
const parsedBase = new URL(baseUrl);
if (parsedBase.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(parsedBase.hostname)) {
  throw new Error(`Refusing browser smoke against non-HTTPS target: ${baseUrl}`);
}

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

await mkdir(evidenceRoot, { recursive: true });

const evidence = {
  test: "VYNDI production Playwright smoke",
  mode: "read-only-browser",
  baseUrl,
  expectedSha: expectedSha || null,
  startedAt: new Date().toISOString(),
  routes: [],
  releaseMarker: null,
  result: "RUNNING",
};

const browser = await chromium.launch({ headless: !headed });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  reducedMotion: "reduce",
});

try {
  if (expectedSha) {
    const markerResponse = await context.request.get(`${baseUrl}/api/runtime/release-marker`);
    const markerText = await markerResponse.text().catch(() => "");
    evidence.releaseMarker = {
      status: markerResponse.status(),
      text: markerText.slice(0, 1000),
    };
    assert.ok(markerResponse.ok(), `Release marker returned HTTP ${markerResponse.status()}`);
    assert.ok(
      markerText.includes(expectedSha) || markerText.includes(expectedSha.slice(0, 12)),
      `Target deployment does not report expected SHA ${expectedSha}`,
    );
  }

  const login = await context.newPage();
  const loginErrors = [];
  login.on("pageerror", (error) => loginErrors.push(String(error?.message || error)));
  const loginResponse = await login.goto(`${baseUrl}/login?returnTo=%2Fcommand`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  assert.ok(loginResponse?.ok(), `Login page returned HTTP ${loginResponse?.status() ?? "none"}`);
  await login.getByLabel(/Authorised Email/i).fill(email);
  await login.getByLabel(/^Password$/i).fill(password);
  await login.getByRole("button", { name: /Authorize · Enter Command/i }).click();
  await login.waitForURL(/\/command(?:\/|$)/, { timeout: 45_000 });
  assert.deepEqual(loginErrors, [], `Login emitted browser errors: ${loginErrors.join(" | ")}`);

  for (const route of protectedRoutes) {
    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(String(error?.message || error)));
    const started = Date.now();
    const response = await page.goto(`${baseUrl}${route}`, {
      waitUntil: "domcontentloaded",
      timeout: route.includes("assurance") ? 90_000 : 60_000,
    });
    await page.locator("body").waitFor({ state: "visible", timeout: 30_000 });
    await page.waitForFunction(() => (document.body?.innerText || "").trim().length > 40, undefined, {
      timeout: 30_000,
    });

    const body = (await page.locator("body").innerText()).trim();
    assert.ok(response?.ok(), `${route} returned HTTP ${response?.status() ?? "none"}`);
    assert.doesNotMatch(page.url(), /\/login(?:\?|$)|\/command-login/, `${route} lost authenticated access`);
    assert.doesNotMatch(
      body,
      /Something went wrong|Internal Server Error|Cannot read properties of undefined/i,
      `${route} rendered a fatal error`,
    );
    assert.deepEqual(pageErrors, [], `${route} emitted browser errors: ${pageErrors.join(" | ")}`);

    if (route === "/command/sales") {
      assert.match(body, /Create bicycle demand \/ order/i, "Commercial order entry surface is missing");
      await page.getByRole("button", { name: /Add demand \/ order|Sign in to create order/i }).first().waitFor({
        state: "visible",
        timeout: 20_000,
      });
    }

    const screenshotPath = resolve(
      evidenceRoot,
      `${route.replace(/^\//, "").replaceAll("/", "__") || "root"}.png`,
    );
    await page.screenshot({ path: screenshotPath, fullPage: true });
    evidence.routes.push({
      route,
      finalUrl: page.url(),
      status: response?.status() ?? null,
      bodyLength: body.length,
      durationMs: Date.now() - started,
      screenshot: screenshotPath,
      pageErrors,
    });
    await page.close();
  }

  evidence.result = "PASS";
  evidence.completedAt = new Date().toISOString();
  console.log(`[vyndi-playwright] PASS · ${protectedRoutes.length} protected routes · ${baseUrl}`);
  console.log(`[vyndi-playwright] evidence: ${evidenceRoot}`);
} catch (error) {
  evidence.result = "FAIL";
  evidence.completedAt = new Date().toISOString();
  evidence.error = error instanceof Error ? error.stack || error.message : String(error);
  throw error;
} finally {
  await writeFile(resolve(evidenceRoot, "evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
}
