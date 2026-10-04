import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("final production acceptance is exact-SHA, read-only and responsive", async () => {
  const [runner, pkg, qualification] = await Promise.all([
    readFile("scripts/final-production-acceptance.mjs", "utf8"),
    readFile("package.json", "utf8"),
    readFile("docs/VYNDI-PRODUCTION-QUALIFICATION-REV1.md", "utf8"),
  ]);

  assert.match(runner, /VYNDI_TEST_EXPECTED_SHA/);
  assert.match(runner, /vyndi-golden-enterprise-journey\.mjs/);
  assert.match(runner, /vyndi-production-playwright-smoke\.mjs/);
  assert.match(runner, /operator-ux-hardening\.mjs/);
  assert.doesNotMatch(runner, /VYNDI_E2E_ALLOW_MUTATION.*1/);
  assert.match(pkg, /"test:production:acceptance":\s*"node scripts\/final-production-acceptance\.mjs"/);
  assert.match(qualification, /PLATFORM-CONSTRAINED/);
  assert.match(qualification, /Cloudflare Free/i);
  assert.match(qualification, /4366e8b61f5825aea3013b129780b8394d23ad83/);
});
