import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const vite = read("vite.config.ts");
const pkg = JSON.parse(read("package.json"));
const releaseMarker = read("src/routes/api/runtime/release-marker.ts");
const observability = read("src/lib/observability/server.ts");
const productionSmoke = read("scripts/vyndi-production-playwright-smoke.mjs");
const wrangler = JSON.parse(read("wrangler.jsonc"));
const authRuntime = read("src/lib/auth/runtime-config.ts");
const releaseScript = read("scripts/run-vyndi-release-test.ps1");

test("Cloudflare remains the VYNDI production deployment authority while legacy adapters stay build-compatible", () => {
  assert.equal(wrangler.name, "vyndios");
  assert.match(authRuntime, /https:\/\/vyndios\.vayushastr\.workers\.dev/);
  assert.doesNotMatch(authRuntime, /tiger-field-flora-finch/);
  assert.match(productionSmoke, /vyndios\.vayushastr\.workers\.dev/);
  assert.match(releaseScript, /vyndios\.vayushastr\.workers\.dev/);
  assert.equal(pkg.devDependencies["@cloudflare/vite-plugin"], "1.62.5");
  assert.equal(pkg.devDependencies?.nitro, undefined);

  assert.match(vite, /import \{ cloudflare \} from "@cloudflare\/vite-plugin"/);
  assert.match(vite, /cloudflare\(\{ viteEnvironment: \{ name: "ssr" \} \}\)/);
  assert.doesNotMatch(vite, /nitro\/vite|preset:\s*"[^"]+"/i);
});

test("release marker exposes the runtime source SHA and production smoke validates it exactly", () => {
  assert.match(releaseMarker, /runtimeSourceSha/);
  assert.match(observability, /VYNDI_SOURCE_SHA/);
  assert.match(releaseMarker, /sourceSha/);
  assert.match(productionSmoke, /JSON\.parse\(markerText\)/);
  assert.match(productionSmoke, /markerJson\?\.sourceSha/);
  assert.match(productionSmoke, /reportedSha\.toLowerCase\(\)/);
  assert.doesNotMatch(productionSmoke, /markerText\.includes\(expectedSha/);
});


test("release acceptance policy names Cloudflare Workers as the production path", () => {
  const audit = read("docs/MASTER-PHASE-1-6A-AUDIT.md");
  assert.match(audit, /Declared production deployer:\*\* Cloudflare Workers/);
  assert.match(audit, /Cloudflare Workers is the \*\*declared production deployer\*\*/);
  assert.match(audit, /Cloudflare Workers is the \*\*declared production deployer\*\*/);
});


test("production smoke waits for hydrated login readiness before credential interaction", () => {
  const readiness = productionSmoke.indexOf('locator(".vy-login.is-cinematic").waitFor');
  const emailFill = productionSmoke.indexOf("getByLabel(/Authorised Email/i).fill(email)");
  assert.ok(readiness >= 0, "production smoke must wait for the mounted login readiness marker");
  assert.ok(emailFill >= 0, "production smoke must fill the authorised email field");
  assert.ok(readiness < emailFill, "login readiness must be established before credentials are entered");
});

test("release browser setup is bounded and can run without waiting for credentials", () => {
  assert.match(releaseScript, /\[switch\]\$NonInteractive/);
  assert.match(releaseScript, /\[switch\]\$SetupOnly/);
  assert.match(releaseScript, /SetupTimeoutSeconds/);
  assert.match(releaseScript, /WaitForExit/);
  assert.match(releaseScript, /Test-ChromiumLaunch/);
  assert.match(releaseScript, /VYNDI_TEST_PASSWORD is required in -NonInteractive mode/);
  assert.match(releaseScript, /Playwright Chromium setup preflight PASS/);
});


test("H3 Chromium setup reuses a working browser and bounds fallback installation", () => {
  const h3Workflow = read(".github/workflows/h3-performance-load.yml");
  assert.match(h3Workflow, /name: Verify or install Chromium/);
  assert.match(h3Workflow, /timeout-minutes:\s*4/);
  assert.match(h3Workflow, /chromium\\\.launch/);
  assert.match(h3Workflow, /timeout --signal=TERM --kill-after=15s 180s npx playwright install chromium/);
  assert.doesNotMatch(h3Workflow, /playwright install --with-deps chromium/);
});
