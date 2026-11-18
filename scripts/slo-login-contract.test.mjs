import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const source = (file) => readFileSync(new URL(file, new URL("../", import.meta.url)), "utf8");
const slo = source("scripts/vyndi-observability-slo.mjs");
const passedSmoke = source("scripts/vyndi-production-playwright-smoke.mjs");

test("SLO authentication uses the same working email label as production smoke, including retry", () => {
  const verified = "getByLabel(/Email address/i)";
  assert.ok(passedSmoke.includes(verified), "production smoke must establish the verified selector");
  assert.equal(slo.split(verified).length - 1, 2, "initial and retry login must use the verified label");
  assert.doesNotMatch(slo, /getByLabel\(\/Authorised Email\/i\)/);
});

test("SLO authentication uses the working VYNDI OS sign-in button", () => {
  const verified = 'getByRole("button", { name: /Sign in to VYNDI OS/i })';
  assert.ok(passedSmoke.includes(verified), "production smoke must establish the verified button");
  assert.ok(slo.includes(verified), "SLO must use the verified sign-in button");
  assert.doesNotMatch(slo, /Authorize · Enter Command/);
});

test("SLO keeps authenticated route checks and exact deployment SHA verification", () => {
  assert.ok(slo.includes("VYNDI_TEST_EXPECTED_SHA"));
  assert.ok(slo.includes("Post-login Command probe"));
  assert.ok(slo.includes('doesNotMatch(login.url()'));
});
