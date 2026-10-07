import assert from "node:assert/strict";
import { chmod, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { chromium } from "playwright";

const baseUrl = (process.env.VYNDI_UAT_BASE_URL || "https://vyndios.vayushastr.workers.dev").replace(/\/$/, "");
const authStatePath = resolve(process.env.VYNDI_UAT_AUTH_STATE || ".auth/vyndi-production.json");
const parsed = new URL(baseUrl);
if (parsed.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(parsed.hostname)) {
  throw new Error(`Refusing auth setup against non-HTTPS target: ${baseUrl}`);
}

await mkdir(dirname(authStatePath), { recursive: true });
const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

try {
  const response = await page.goto(`${baseUrl}/login?returnTo=%2Fcommand`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  assert.ok(response?.ok(), `Login page returned HTTP ${response?.status() ?? "none"}`);
  console.log("[vyndi-uat-auth] Sign in manually in the opened browser. Do not paste credentials into the terminal.");
  console.log("[vyndi-uat-auth] Waiting for authenticated /command navigation …");
  await page.waitForURL(/\/command(?:[/?#]|$)/, { timeout: 10 * 60_000, waitUntil: "domcontentloaded" });
  assert.doesNotMatch(page.url(), /\/login(?:\?|$)/, "Authentication did not leave the login page.");
  await context.storageState({ path: authStatePath });
  await chmod(authStatePath, 0o600).catch(() => {});
  console.log(`[vyndi-uat-auth] PASS · authenticated browser state saved locally at ${authStatePath}`);
} finally {
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
}
