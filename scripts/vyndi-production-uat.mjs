import assert from "node:assert/strict";
import { access, mkdir, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";

const baseUrl = (process.env.VYNDI_UAT_BASE_URL || "https://vyndios.vayushastr.workers.dev").replace(/\/$/, "");
const authStatePath = resolve(process.env.VYNDI_UAT_AUTH_STATE || ".auth/vyndi-production.json");
const expectedSha = process.env.VYNDI_UAT_EXPECTED_SHA?.trim() || "";
const headed = process.env.VYNDI_UAT_HEADED === "1";
const evidenceRoot = resolve(
  process.env.VYNDI_UAT_EVIDENCE_DIR ||
    `.grok/evidence/playwright-uat-${new Date().toISOString().replace(/[:.]/g, "-")}`,
);

const parsed = new URL(baseUrl);
if (parsed.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(parsed.hostname)) {
  throw new Error(`Refusing UAT against non-HTTPS target: ${baseUrl}`);
}
await access(authStatePath, fsConstants.R_OK).catch(() => {
  throw new Error(`Authenticated Playwright state not found at ${authStatePath}. Run npm run uat:prod:auth first.`);
});
await mkdir(evidenceRoot, { recursive: true });

const routeSpecs = [
  { route: "/command", evidence: /Command Centre|Command/i },
  { route: "/command/ibpe-operating-workspace", evidence: /IBPE|VIBPE|planning/i },
  { route: "/command/inventory", evidence: /Master Inventory/i, interact: "inventory" },
  { route: "/command/funding", evidence: /Grants & Funding|Actual funding lifecycle/i, interact: "funding" },
  { route: "/command/people-office", evidence: /People|Operating administration registers/i, interact: "people" },
  { route: "/command/quality", evidence: /Quality & Product Compliance/i, interact: "quality" },
  { route: "/command/recovery", evidence: /Recovery safety boundary|Backup & Recovery Centre/i, interact: "recovery" },
];

const evidence = {
  test: "VYNDI authenticated production UAT",
  mode: "authenticated-transactional-rollback",
  baseUrl,
  expectedSha: expectedSha || null,
  startedAt: new Date().toISOString(),
  preflight: {},
  routes: [],
  writePhase: {
    result: "PENDING",
    mode: "rollback-transactional",
  },
  result: "RUNNING",
};

function sanitize(value) {
  return String(value ?? "")
    .replace(/("(?:password|email|token|secret|authorization|cookie)"\s*:\s*")[^"]*(")/gi, "$1[REDACTED]$2")
    .slice(0, 3000);
}

const browser = await chromium.launch({ headless: !headed });
const context = await browser.newContext({
  storageState: authStatePath,
  viewport: { width: 1440, height: 900 },
  reducedMotion: "reduce",
});

try {
  for (const [name, path] of [
    ["root", "/"],
    ["releaseMarker", "/api/runtime/release-marker"],
    ["health", "/api/runtime/health"],
  ]) {
    const response = await context.request.get(`${baseUrl}${path}`, { timeout: 30_000, failOnStatusCode: false });
    const raw = await response.text().catch(() => "");
    evidence.preflight[name] = { status: response.status(), ok: response.ok(), bodyPreview: sanitize(raw) };
  }

  assert.ok(evidence.preflight.root.ok, `Root preflight failed: HTTP ${evidence.preflight.root.status}`);
  assert.ok(evidence.preflight.releaseMarker.ok, `Release marker failed: HTTP ${evidence.preflight.releaseMarker.status}`);
  assert.ok(evidence.preflight.health.ok, `Runtime health failed: HTTP ${evidence.preflight.health.status}`);

  const marker = JSON.parse(evidence.preflight.releaseMarker.bodyPreview);
  const health = JSON.parse(evidence.preflight.health.bodyPreview);
  evidence.releaseMarker = marker;
  evidence.health = health;
  assert.equal(health?.ok, true, "Runtime health did not report ok=true");
  assert.equal(health?.checks?.database, "ok", "Runtime database health is not OK");
  assert.equal(health?.checks?.schema, "current", "Runtime schema is not current");
  assert.equal(health?.checks?.governedIbpeRun, "present", "Governed IBPE run is not present");
  assert.equal(Number(health?.pendingMigrationCount), 0, "Production has pending migrations");
  assert.equal(String(marker?.sourceSha || "").toLowerCase(), String(health?.sourceSha || "").toLowerCase(), "Release marker and health source SHA differ");
  if (expectedSha) assert.equal(String(marker?.sourceSha || "").toLowerCase(), expectedSha.toLowerCase(), "Deployed SHA does not match expected SHA");

  for (const spec of routeSpecs) {
    const page = await context.newPage();
    const pageErrors = [];
    const consoleErrors = [];
    page.on("pageerror", (error) => pageErrors.push(sanitize(error?.message || error)));
    page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(sanitize(msg.text())); });
    const started = Date.now();
    const response = await page.goto(`${baseUrl}${spec.route}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.locator("body").waitFor({ state: "visible", timeout: 30_000 });
    const body = (await page.locator("body").innerText()).trim();
    assert.ok(response?.ok(), `${spec.route} returned HTTP ${response?.status() ?? "none"}`);
    assert.doesNotMatch(page.url(), /\/login(?:\?|$)|\/command-login/, `${spec.route} lost authenticated access; rerun npm run uat:prod:auth`);
    assert.doesNotMatch(body, /Something went wrong|Internal Server Error|Cannot read properties of undefined/i, `${spec.route} rendered a fatal error`);
    assert.match(body, spec.evidence, `${spec.route} did not render expected governed evidence`);
    assert.deepEqual(pageErrors, [], `${spec.route} emitted page errors: ${pageErrors.join(" | ")}`);

    const interactions = [];
    if (spec.interact === "inventory") {
      const panel = page.getByRole("region", { name: /Single inventory entry/i });
      const close = page.getByRole("button", { name: /Close entry/i });
      let opened = false;

      for (let attempt = 0; attempt < 2 && !opened; attempt += 1) {
        const open = page.getByRole("button", { name: /Item \/ manual receipt/i });
        await open.waitFor({ state: "visible", timeout: 15_000 });
        await open.click();

        opened = await Promise.race([
          panel.waitFor({ state: "visible", timeout: 4_000 }).then(() => true).catch(() => false),
          close.waitFor({ state: "visible", timeout: 4_000 }).then(() => true).catch(() => false),
        ]);

        if (!opened && attempt === 0) {
          await page.waitForLoadState("load", { timeout: 15_000 }).catch(() => {});
          await page.waitForTimeout(500);
        }
      }

      assert.equal(opened, true, "Inventory entry did not open after hydrated retry.");
      await panel.waitFor({ state: "visible", timeout: 15_000 });
      await page.getByText(/Receipt reference/i).first().waitFor({ state: "visible", timeout: 15_000 });
      interactions.push("inventory-entry-controls-opened-without-submit");
    }
    if (spec.interact === "funding") {
      await page.getByText(/Actual funding lifecycle/i).first().waitFor({ state: "visible", timeout: 15_000 });
      interactions.push("funding-lifecycle-projection-rendered");
    }
    if (spec.interact === "people") {
      const summary = page.getByText(/People Register \(/i).first();
      await summary.waitFor({ state: "visible", timeout: 15_000 });
      await summary.click();
      await page.getByText(/Draft → submit → approve → supersede/i).first().waitFor({ state: "visible", timeout: 15_000 });
      interactions.push("people-lifecycle-register-expanded-without-mutation");
    }
    if (spec.interact === "quality") {
      const section = page.getByText(/ISO compliance & product conformity/i).first();
      await section.waitFor({ state: "visible", timeout: 15_000 });
      await section.click();
      await page.waitForTimeout(400);
      const alerts = await page.getByRole("alert").allInnerTexts().catch(() => []);
      assert.equal(alerts.length, 0, `Quality evidence load reported alerts: ${alerts.join(" | ")}`);
      interactions.push("quality-governed-evidence-loaded-on-demand");
    }
    if (spec.interact === "recovery") {
      await page.getByText(/Compare-only recovery evidence/i).first().waitFor({ state: "visible", timeout: 15_000 });
      assert.equal(await page.getByRole("button", { name: /Execute Restore/i }).count(), 0, "Recovery page exposed a generic Execute Restore button");
      interactions.push("recovery-compare-only-boundary-confirmed");
    }

    const screenshot = resolve(evidenceRoot, `${spec.route.replace(/^\//, "").replaceAll("/", "__") || "root"}.png`);
    await page.screenshot({ path: screenshot, fullPage: true });
    evidence.routes.push({
      route: spec.route,
      finalUrl: page.url(),
      status: response?.status() ?? null,
      durationMs: Date.now() - started,
      interactions,
      pageErrors,
      consoleErrors,
      screenshot,
    });
    await page.close();
  }

  const transactional = await context.newPage();
  const transactionalErrors = [];
  transactional.on("pageerror", (error) => transactionalErrors.push(sanitize(error?.message || error)));
  const transactionalResponse = await transactional.goto(`${baseUrl}/command/uat-certification`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  assert.ok(transactionalResponse?.ok(), `Transactional UAT route returned HTTP ${transactionalResponse?.status() ?? "none"}`);
  assert.doesNotMatch(transactional.url(), /\/login(?:\?|$)|\/command-login/, "Transactional UAT route lost authenticated access");
  const runRollbackButton = transactional.getByRole("button", { name: /Run rollback UAT/i });
  const runningRollbackButton = transactional.getByRole("button", { name: /Running rollback UAT/i });
  const passRollback = transactional.getByText(/PASS · ROLLED BACK/i);
  const rollbackAlert = transactional.getByRole("alert");

  await runRollbackButton.waitFor({ state: "visible", timeout: 20_000 });

  let transactionalStarted = false;
  for (let attempt = 0; attempt < 2 && !transactionalStarted; attempt += 1) {
    await runRollbackButton.click();

    const acceptanceDeadline = Date.now() + 5_000;
    while (Date.now() < acceptanceDeadline) {
      if (
        await runningRollbackButton.isVisible().catch(() => false) ||
        await passRollback.isVisible().catch(() => false) ||
        await rollbackAlert.isVisible().catch(() => false)
      ) {
        transactionalStarted = true;
        break;
      }
      await transactional.waitForTimeout(250);
    }

    if (!transactionalStarted && attempt === 0) {
      await transactional.waitForLoadState("load", { timeout: 15_000 }).catch(() => {});
      await transactional.waitForTimeout(500);
    }
  }

  assert.equal(transactionalStarted, true, "Rollback action did not start after hydrated retry.");

  const transactionalTimeoutMs = 120_000;
  const deadline = Date.now() + transactionalTimeoutMs;
  let transactionalOutcome = null;

  while (Date.now() < deadline) {
    if (await passRollback.isVisible().catch(() => false)) {
      transactionalOutcome = { type: "pass" };
      break;
    }
    if (await rollbackAlert.isVisible().catch(() => false)) {
      transactionalOutcome = { type: "error", message: (await rollbackAlert.innerText()).trim() };
      break;
    }
    await transactional.waitForTimeout(500);
  }

  if (!transactionalOutcome) {
    const buttonText = (await transactional.getByRole("button").allInnerTexts().catch(() => [])).join(" | ");
    throw new Error(`Transactional UAT timed out after ${transactionalTimeoutMs}ms. Button state: ${buttonText || "none"}`);
  }
  if (transactionalOutcome.type === "error") {
    throw new Error(`Transactional server failure: ${transactionalOutcome.message || "unknown server error"}`);
  }
  const transactionalJson = await transactional.getByTestId("uat-result").innerText();
  const transactionalResult = JSON.parse(transactionalJson);
  assert.equal(transactionalResult?.ok, true, "Transactional UAT did not report ok=true");
  assert.equal(transactionalResult?.rolledBack, true, "Transactional UAT did not prove rollback");
  assert.equal(Number(transactionalResult?.remainingFixtureCount), 0, "Transactional UAT left fixture rows behind");
  for (const domain of ["funding", "peopleOffice", "inventory", "quality", "finance", "hrPayroll"]) {
    assert.equal(transactionalResult?.domains?.[domain]?.status, "PASS", `Transactional UAT domain ${domain} did not pass`);
  }
  assert.deepEqual(transactionalErrors, [], `Transactional UAT emitted page errors: ${transactionalErrors.join(" | ")}`);
  const transactionalScreenshot = resolve(evidenceRoot, "command__uat-certification.png");
  await transactional.screenshot({ path: transactionalScreenshot, fullPage: true });
  evidence.writePhase = {
    result: "PASS",
    mode: "rollback-transactional",
    confirmation: "RUN_ROLLBACK_UAT",
    runId: transactionalResult.runId,
    rolledBack: transactionalResult.rolledBack,
    remainingFixtureCount: transactionalResult.remainingFixtureCount,
    domains: transactionalResult.domains,
    screenshot: transactionalScreenshot,
  };
  await transactional.close();

  evidence.result = "PASS";
  evidence.completedAt = new Date().toISOString();
  console.log(`[vyndi-uat] PASS · authenticated production UAT · SHA ${evidence.releaseMarker?.sourceSha || "unknown"}`);
  console.log(`[vyndi-uat] transactional write phase: ${evidence.writePhase.result} · rollback=${evidence.writePhase.rolledBack ?? false} · remaining=${evidence.writePhase.remainingFixtureCount ?? "unknown"}`);
  console.log(`[vyndi-uat] evidence: ${evidenceRoot}`);
} catch (error) {
  evidence.result = "FAIL";
  evidence.completedAt = new Date().toISOString();
  evidence.error = sanitize(error instanceof Error ? error.stack || error.message : error);
  throw error;
} finally {
  await writeFile(resolve(evidenceRoot, "evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
}
