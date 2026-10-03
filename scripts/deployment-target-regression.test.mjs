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
  assert.equal(pkg.devDependencies["@cloudflare/vite-plugin"], "1.54.7");
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
