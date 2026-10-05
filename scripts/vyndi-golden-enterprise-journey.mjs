import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const baseUrl = (process.env.VYNDI_TEST_BASE_URL || "http://127.0.0.1:8081").replace(/\/$/, "");
const email = process.env.VYNDI_TEST_EMAIL;
const password = process.env.VYNDI_TEST_PASSWORD;
const allowMutation = process.env.VYNDI_E2E_ALLOW_MUTATION === "1";
const host = new URL(baseUrl).hostname;
const sandboxHost = ["localhost", "127.0.0.1", "::1"].includes(host) || /preview|sandbox|staging|test/i.test(host);

if (!email || !password) throw new Error("VYNDI_TEST_EMAIL and VYNDI_TEST_PASSWORD are required.");
if (allowMutation && !sandboxHost) {
  throw new Error("VYNDI_E2E_ALLOW_MUTATION is permitted only against localhost/sandbox/staging/test targets.");
}

const stages = [
  { id: "command", route: "/command", evidence: /Command|VYNDI/i },
  { id: "sales", route: "/command/sales", evidence: /sales|demand|order|commercial/i },
  { id: "planning", route: "/command/ibpe-operating-workspace", evidence: /IBPE|plan|planning/i },
  { id: "procurement", route: "/command/procurement", evidence: /procurement|supplier|purchase/i },
  { id: "receiving", route: "/command/receiving", evidence: /receiv|GRN|supplier/i },
  { id: "inventory", route: "/command/inventory", evidence: /inventory|stock|material/i },
  { id: "operations", route: "/command/operations", evidence: /operation|production|job card|traveller/i },
  { id: "quality", route: "/command/quality", evidence: /quality|NCR|inspection|release/i },
  { id: "financial-cockpit", route: "/command/financial-cockpit", evidence: /finance|cash|P&L|profit|ledger/i },
  { id: "governance", route: "/command/governance", evidence: /governance|audit|authority|evidence/i },
];

const evidenceRoot = resolve(
  process.env.VYNDI_E2E_EVIDENCE_DIR ||
  `artifacts/golden-enterprise-${new Date().toISOString().replace(/[:.]/g, "-")}`
);
await mkdir(evidenceRoot, { recursive: true });

const report = {
  test: "VYNDI Golden Enterprise Journey R1",
  mode: allowMutation ? "sandbox-mutation-enabled" : "read-only-cross-workspace",
  baseUrl,
  startedAt: new Date().toISOString(),
  stages: [],
  result: "RUNNING",
};

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });

try {
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
      const screenshot = resolve(evidenceRoot, "login-diagnostic.png");
      await login.screenshot({ path: screenshot, fullPage: true }).catch(() => {});
      report.loginDiagnostic = { finalUrl, visibleText, pageErrors, screenshot };
      throw new Error(`Login failed after retry · finalUrl=${finalUrl} · pageErrors=${pageErrors.join(" | ") || "none"} · visibleText=${visibleText || "(empty)"}`, { cause });
    }
  }
  await login.close();

  for (const stage of stages) {
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error?.message || error)));
    const started = Date.now();
    const response = await page.goto(`${baseUrl}${stage.route}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.locator("body").waitFor({ state: "visible", timeout: 30_000 });
    const body = (await page.locator("body").innerText()).trim();
    assert.ok(response?.ok(), `${stage.id} returned HTTP ${response?.status() ?? "none"}`);
    assert.doesNotMatch(page.url(), /\/login(?:\?|$)|\/command-login/, `${stage.id} lost authentication`);
    assert.match(body, stage.evidence, `${stage.id} did not render expected business evidence`);
    assert.deepEqual(errors, [], `${stage.id} emitted browser errors: ${errors.join(" | ")}`);
    report.stages.push({
      id: stage.id,
      route: stage.route,
      status: response?.status() ?? null,
      durationMs: Date.now() - started,
      bodyLength: body.length,
      errors,
    });
    await page.close();
  }

  // Mutation is deliberately opt-in and sandbox-only. The R1 journey certifies
  // cross-workspace continuity by default; destructive business mutations remain
  // under the existing governed transaction-specific tests.
  report.mutationGuard = {
    requested: allowMutation,
    sandboxHost,
    permitted: !allowMutation || sandboxHost,
  };
  report.result = "PASS";
  report.completedAt = new Date().toISOString();
  console.log(`[golden-enterprise] PASS · ${stages.length} governed stages · ${baseUrl}`);
} catch (error) {
  report.result = "FAIL";
  report.completedAt = new Date().toISOString();
  report.error = error instanceof Error ? error.stack || error.message : String(error);
  throw error;
} finally {
  await writeFile(resolve(evidenceRoot, "golden-enterprise-report.json"), JSON.stringify(report, null, 2) + "\n");
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
}
