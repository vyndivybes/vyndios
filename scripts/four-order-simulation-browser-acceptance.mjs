import assert from "node:assert/strict";
import { chromium } from "playwright";

// Compatibility browser smoke: the historical demo console is retired.
// Its modelling library remains covered by four-order-highs.test.mjs.
const base = (process.env.VYNDI_TEST_BASE_URL || "https://vyndios.vayushastr.workers.dev").replace(/\/$/, "");
const expected = process.env.VYNDI_TEST_EXPECTED_SHA || "";
assert.match(expected, /^[a-f0-9]{40}$/);
assert.ok(process.env.VYNDI_TEST_EMAIL && process.env.VYNDI_TEST_PASSWORD, "Hosted acceptance credentials required");

const retiredPath = "/command/ibpe-operating-workspace/simulation";
const canonicalPath = "/command/ibpe-operating-workspace/optimizer";
const browser = await chromium.launch({ headless: true });
try {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport, reducedMotion: "reduce" });
    const health = await context.request.get(base + "/api/runtime/health");
    assert.equal(health.status(), 200);
    assert.equal((await health.json()).sourceSha, expected);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => { errors.push(e.message); console.error("VYNDI_BROWSER_PAGEERROR", e.message); });
    await page.goto(base + "/login?returnTo=%2Fcommand%2Fproduction", { waitUntil: "domcontentloaded" });
    await page.locator(".vy-login.is-cinematic").waitFor({ state: "visible", timeout: 30000 });
    await page.getByLabel(/Email address/i).fill(process.env.VYNDI_TEST_EMAIL);
    await page.getByLabel(/^Password$/i).fill(process.env.VYNDI_TEST_PASSWORD);
    await page.getByRole("button", { name: /Sign in to VYNDI OS/i }).click();
    await page.waitForURL(/\/command(?:\/|$)/, { timeout: 45000 });
    await page.goto(base + "/command/production", { waitUntil: "domcontentloaded" });
    assert.equal(await page.locator(`a[href="${retiredPath}"]`).count(), 0, "Production must not link to retired simulation");
    await page.goto(base + retiredPath, { waitUntil: "domcontentloaded" });
    await page.waitForURL((url) => url.pathname === canonicalPath, { timeout: 45000 });
    await page.getByRole("heading", { name: "Advanced Planning Optimizer", exact: true }).waitFor({ timeout: 30000 });
    assert.equal(await page.locator(`a[href="${retiredPath}"]`).count(), 0, "Optimizer must not link back to retired simulation");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, "Page must fit viewport");
    assert.deepEqual(errors, [], "No uncaught browser errors");
    console.log(JSON.stringify({ check: "retired-four-order-simulation-route", sourceSha: expected, viewport, redirect: canonicalPath, result: "PASS" }));
    await context.close();
  }
} finally { await browser.close(); }
