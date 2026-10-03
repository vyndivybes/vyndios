import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const baseUrl = (process.env.VYNDI_TEST_BASE_URL || "https://vyndios.vayushastr.workers.dev").replace(/\/$/, "");
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
  "/command/ibpe-operating-workspace",
  "/command/ibpe-operating-workspace/authority",
  "/command/ibpe-operating-workspace/optimizer",
  "/command/ibpe-operating-workspace/outputs",
  "/command/ibpe-operating-workspace/assurance",
  "/command/ibpe-operating-workspace/release",
  "/command/intelligence",
  "/command/scenarios",
  "/command/cash",
  "/command/engineering",
  "/command/risk",
  "/command/sales",
  "/command/inventory",
  "/command/operations",
  "/command/quality",
  "/command/actuals",
  "/command/financial-cockpit",
];

const routeEvidence = new Map([
  ["/command", /Command Centre|Command/i],
  ["/command/ibpe-operating-workspace", /IBPE|VIBPE|planning/i],
  ["/command/ibpe-operating-workspace/authority", /Authority|Planning/i],
  ["/command/ibpe-operating-workspace/optimizer", /Optimizer|Optimiser/i],
  ["/command/ibpe-operating-workspace/outputs", /Outputs|Evidence/i],
  ["/command/ibpe-operating-workspace/assurance", /Assurance|evidence/i],
  ["/command/ibpe-operating-workspace/release", /Release Readiness|release/i],
  ["/command/intelligence", /Product Intelligence/i],
  ["/command/scenarios", /Scenario/i],
  ["/command/cash", /Cash|Working Capital/i],
  ["/command/engineering", /Engineering/i],
  ["/command/risk", /Risk Register|VYNDI Risk Engine/i],
]);

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
    assert.ok(markerResponse.ok(), `Release marker returned HTTP ${markerResponse.status()}`);

    let markerJson;
    try {
      markerJson = JSON.parse(markerText);
    } catch {
      throw new Error(`Release marker did not return valid JSON: ${markerText.slice(0, 240)}`);
    }

    evidence.releaseMarker = {
      status: markerResponse.status(),
      marker: markerJson,
    };

    const reportedSha = typeof markerJson?.sourceSha === "string" ? markerJson.sourceSha.trim() : "";
    assert.ok(reportedSha, "Release marker does not expose sourceSha; exact deployment certification is unavailable.");
    assert.equal(
      reportedSha.toLowerCase(),
      expectedSha.toLowerCase(),
      `Target deployment reports SHA ${reportedSha}; expected ${expectedSha}`,
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

    const expectedEvidence = routeEvidence.get(route);
    if (expectedEvidence) {
      assert.match(body, expectedEvidence, `${route} did not render its expected page evidence`);
    }

    if (route === "/command") {
      const productIntelligenceLink = page.getByRole("link", { name: /^Product Intelligence →$/i });
      await productIntelligenceLink.waitFor({ state: "visible", timeout: 10_000 });
      const href = await productIntelligenceLink.getAttribute("href");
      assert.equal(href, "/command/intelligence", "Command Centre Product Intelligence link targets the wrong route");
    }

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
