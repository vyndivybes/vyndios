import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workflow = await readFile(new URL("../.github/workflows/production-assurance.yml", import.meta.url), "utf8");

test("production assurance runs on GitHub-hosted infrastructure after main commits", () => {
  assert.match(workflow, /push:\s*\n\s*branches: \[main\]/);
  assert.match(workflow, /runs-on: ubuntu-latest/);
  assert.doesNotMatch(workflow, /runs-on: \[self-hosted/);
});

test("production assurance checks exact Cloudflare SHA before authenticated browser", () => {
  const gate = workflow.indexOf("node scripts/production-deployment-readiness.mjs");
  const smoke = workflow.indexOf("npm run test:browser:production");
  assert.ok(gate >= 0 && smoke > gate, "Exact-SHA gate must precede browser smoke");
  assert.match(workflow, /VYNDI_TEST_EXPECTED_SHA: \$\{\{ github\.sha \}\}/);
});

test("a public repository must not upload authenticated screenshots or evidence folders", () => {
  assert.doesNotMatch(workflow, /path:\s*\|\s*\n\s*artifacts\/\s*\n\s*\.grok\/evidence\//);
  assert.match(workflow, /path: \.grok\/evidence\/production-assurance-exact-sha\.json/);
});

test("qualification runs explicit business-domain and recovery contracts", () => {
  for (const item of ["crm-domain.test.ts", "schedule-revision-policy.test.mjs", "live-finance-posting.test.mjs", "test:mes:golden", "test:h5:integrations", "test:h2:recovery:expanded"]) {
    assert.ok(workflow.includes(item), "Missing independent contract check: " + item);
  }
});

test("cancelled historical four-order demand is not a live-browser production gate", () => {
  assert.doesNotMatch(workflow, /^\s*- name: Four-order simulation HiGHS desktop and mobile acceptance\s*$/m);
  assert.doesNotMatch(workflow, /^\s*run: node scripts\/four-order-simulation-browser-acceptance\.mjs\s*$/m);
  const chromium = workflow.indexOf("Verify or install Chromium");
  const departments = workflow.indexOf("Independent four-department browser acceptance");
  assert.ok(chromium >= 0 && departments > chromium, "Authenticated departmental browser acceptance must remain active");
  for (const required of [
    "Wait for exact Cloudflare deployment and schema readiness",
    "Seven-domain governed transaction contract tests",
    "Authenticated protected-route smoke",
    "Production SLO observation",
    "Operator UX viewport qualification",
  ]) assert.ok(workflow.includes(required), "Do not remove independent acceptance: " + required);
});

test("required focused-validation blocks known dependency advisories on every PR", async () => {
  const devCi = await readFile(new URL("../.github/workflows/dev-ci.yml", import.meta.url), "utf8");
  const gate = devCi.indexOf("Full dependency security release gate");
  const install = devCi.indexOf("- name: Install");
  const functional = devCi.indexOf("- name: SLO production login selector contract");
  assert.ok(gate > install && gate < functional, "dependency gate must execute inside required CI before functional validation");
  assert.match(devCi, /npm audit --omit=dev --audit-level=moderate/);
  assert.match(devCi, /npm audit --audit-level=low/);
});
