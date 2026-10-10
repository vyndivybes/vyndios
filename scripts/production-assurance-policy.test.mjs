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
