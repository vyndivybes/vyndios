import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const baseUrl = (process.env.VYNDI_TEST_BASE_URL || "http://127.0.0.1:8081").replace(/\/$/, "");
const email = process.env.VYNDI_TEST_EMAIL;
const password = process.env.VYNDI_TEST_PASSWORD;
if (!email || !password) throw new Error("VYNDI_TEST_EMAIL and VYNDI_TEST_PASSWORD are required.");

const viewports = [
  { name: "desktop-1440", width: 1440, height: 900 },
  { name: "desktop-1180", width: 1180, height: 820 },
  { name: "tablet-768", width: 768, height: 1024 },
  { name: "mobile-390", width: 390, height: 844 },
];
const routes = ["/command", "/command/intelligence", "/command/planning", "/command/engineering", "/command/scenarios", "/command/quality", "/command/procurement", "/command/risk", "/command/ibpe-operating-workspace/optimizer", "/command/ibpe-operating-workspace/release", "/command/sales", "/command/inventory", "/command/operations", "/command/financial-cockpit"];
const evidenceRoot = resolve(process.env.VYNDI_UX_EVIDENCE_DIR || "artifacts/operator-ux-hardening");
await mkdir(evidenceRoot, { recursive: true });

const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const viewport of viewports) {
    const context = await browser.newContext({ viewport });
    const login = await context.newPage();
    const pageErrors = [];
    login.on("pageerror", (error) => pageErrors.push(String(error?.message || error)));
    await login.goto(`${baseUrl}/login?returnTo=%2Fcommand`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    // The server-rendered form is visible before React installs onSubmit.
  // Cinematic readiness is set by a mounted effect; wait before entering credentials.
  await login.locator(".vy-login.is-cinematic").waitFor({ state: "visible", timeout: 30_000 });
  await login.getByLabel(/Authorised Email/i).fill(email);
    await login.getByLabel(/^Password$/i).fill(password);
    // Better Auth can transiently return ?created=false while an existing session
    // is rotated/settled. Retry the normal credential flow once; never bypass auth.
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      await login.getByRole("button", { name: /Authorize · Enter Command/i }).click();
      try {
        await login.waitForURL(/\/command(?:\/|$)/, { timeout: 45_000, waitUntil: "domcontentloaded" });
        break;
      } catch (cause) {
        if (attempt < 2) {
          await login.goto(`${baseUrl}/login?returnTo=%2Fcommand`, { waitUntil: "domcontentloaded", timeout: 60_000 });
          await login.locator(".vy-login.is-cinematic").waitFor({ state: "visible", timeout: 30_000 });
          await login.getByLabel(/Authorised Email/i).fill(email);
          await login.getByLabel(/^Password$/i).fill(password);
          continue;
        }
        const finalUrl = login.url();
        const visibleText = (await login.locator("body").innerText().catch(() => "")).trim().slice(0, 2000);
        const screenshot = resolve(evidenceRoot, `${viewport.name}-login-diagnostic.png`);
        await login.screenshot({ path: screenshot, fullPage: true }).catch(() => {});
        results.push({ viewport: viewport.name, stage: "login", finalUrl, visibleText, pageErrors, screenshot });
        throw new Error(`Login failed after retry at ${viewport.name} · finalUrl=${finalUrl} · pageErrors=${pageErrors.join(" | ") || "none"} · visibleText=${visibleText || "(empty)"}`, { cause });
      }
    }
    await login.close();

    for (const route of routes) {
      const page = await context.newPage();
      const pageErrors = [];
      page.on("pageerror", (error) => pageErrors.push(String(error?.message || error)));
      const response = await page.goto(`${baseUrl}${route}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
      assert.ok(response?.ok(), `${route} returned HTTP ${response?.status() ?? "none"}`);
      await page.locator("body").waitFor({ state: "visible", timeout: 30_000 });
      const body = (await page.locator("body").innerText()).trim();
      assert.doesNotMatch(page.url(), /\/login(?:\?|$)|\/command-login/, `${route} lost authenticated access at ${viewport.name}`);
      assert.doesNotMatch(body, /Something went wrong|Internal Server Error|Cannot read properties of undefined/i, `${route} rendered a fatal error at ${viewport.name}`);
      assert.deepEqual(pageErrors, [], `${route} emitted browser errors at ${viewport.name}: ${pageErrors.join(" | ")}`);
      const overflow = await page.evaluate(() => ({
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: document.documentElement.clientWidth,
        bodyWidth: document.body.scrollWidth,
      }));
      assert.ok(
        overflow.documentWidth <= overflow.viewportWidth + 2,
        `${route} overflows horizontally at ${viewport.width}px: ${JSON.stringify(overflow)}`,
      );
      results.push({ viewport: viewport.name, route, overflow, pageErrors });
      await page.close();
    }
    await context.close();
  }
  console.log(`[operator-ux] PASS · ${results.length} route/viewport checks`);
} finally {
  await writeFile(resolve(evidenceRoot, "operator-ux-report.json"), JSON.stringify({ baseUrl, results }, null, 2) + "\n");
  await browser.close().catch(() => {});
}
