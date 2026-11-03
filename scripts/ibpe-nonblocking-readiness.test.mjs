import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("IBPE route does not await full report pack before rendering", () => {
  const page = read("src/routes/command/ibpe-operating-workspace.tsx");
  assert.doesNotMatch(page, /loader:\s*async/);
  assert.doesNotMatch(page, /Route\.useLoaderData/);
  for (const status of ["loading", "ready", "error"]) {
    assert.ok(page.includes(`data-ibpe-readiness="${status}"`));
  }
  assert.match(page, /getIbpeOperatingWorkspaceReport\(\)/);
});

test("report retains authenticated existing view authority", () => {
  const service = read("src/lib/ibpe-operating-workspace-report.ts");
  const reports = read("src/lib/erp-suite-reports.ts");
  assert.ok(service.includes("createServerFn"));
  assert.ok(service.includes("getAllErpSuiteReports()"));
  assert.ok(reports.includes("requireReportView()"));
  assert.ok(reports.includes('canPerform(role, "view")'));
});

test("production browser acceptance checks IBPE report readiness", () => {
  const smoke = read("scripts/vyndi-production-playwright-smoke.mjs");
  assert.ok(smoke.includes('data-ibpe-readiness="ready"'));
  assert.ok(smoke.includes('data-ibpe-readiness="error"'));
});
