import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { VIBPE_QA_CASES } from "./vibpe-copilot-qa-cases.mjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("R1 hardening installs a guarded Golden Enterprise journey", () => {
  assert.ok(existsSync(new URL("./vyndi-golden-enterprise-journey.mjs", import.meta.url)));
  const source = read("scripts/vyndi-golden-enterprise-journey.mjs");
  for (const stage of ["sales", "planning", "procurement", "receiving", "inventory", "operations", "quality", "financial-cockpit", "governance"]) {
    assert.match(source, new RegExp(stage, "i"));
  }
  assert.match(source, /VYNDI_E2E_ALLOW_MUTATION/);
  assert.match(source, /sandbox|localhost|127\.0\.0\.1/i);
});

test("R1 hardening adds measurable coverage thresholds", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.ok(pkg.scripts["test:coverage"]);
  assert.match(pkg.scripts["test:coverage"], /test-coverage-lines/);
  assert.match(pkg.scripts["test:coverage"], /test-coverage-functions/);
  assert.match(pkg.scripts["test:coverage"], /test-coverage-branches/);
});

test("R1 expands VIBPE governed benchmark depth", () => {
  assert.ok(VIBPE_QA_CASES.length >= 32, `expected >=32 QA cases, found ${VIBPE_QA_CASES.length}`);
  const counts = new Map();
  for (const item of VIBPE_QA_CASES) counts.set(item.pack, (counts.get(item.pack) ?? 0) + 1);
  for (const [pack, count] of counts) assert.ok(count >= 4, `${pack} has only ${count} cases`);
});

test("R1 adds scheduled production assurance telemetry", () => {
  assert.ok(existsSync(new URL("../.github/workflows/production-assurance.yml", import.meta.url)));
  const workflow = read(".github/workflows/production-assurance.yml");
  assert.match(workflow, /schedule:/);
  assert.match(workflow, /observe:slo/);
  assert.match(workflow, /VYNDI_SLO_ENFORCE_LATENCY/);
  assert.match(workflow, /upload-artifact/);
});

test("R1 hardens migration release by separating build from privileged migration", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.scripts.build, "npm run build:bundle");
  assert.doesNotMatch(pkg.scripts.build, /db:migrate/);
  assert.equal(pkg.scripts["release:migrate"], "node scripts/migration-release-gate.mjs");
  assert.ok(existsSync(new URL("./migration-release-gate.mjs", import.meta.url)));
  const gate = read("scripts/migration-release-gate.mjs");
  assert.match(gate, /VYNDI_MIGRATION_BACKUP_REF/);
  assert.match(gate, /VYNDI_MIGRATION_APPROVED/);
  assert.match(gate, /VYNDI_SOURCE_SHA|GITHUB_SHA/);
  assert.match(gate, /production/i);
});

test("R1 includes explicit security abuse controls", () => {
  assert.ok(existsSync(new URL("../src/lib/security/rate-limit.ts", import.meta.url)));
  const limiter = read("src/lib/security/rate-limit.ts");
  assert.match(limiter, /retryAfterSeconds/);
  assert.match(limiter, /limit/);
  assert.ok(existsSync(new URL("./security-abuse-controls.test.mjs", import.meta.url)));
});

test("R1 includes optimizer benchmark evidence", () => {
  assert.ok(existsSync(new URL("./advanced-optimizer-benchmark.test.mjs", import.meta.url)));
  const benchmark = read("scripts/advanced-optimizer-benchmark.test.mjs");
  assert.match(benchmark, /determin/i);
  assert.match(benchmark, /infeasible|constraint/i);
  assert.match(benchmark, /objective/i);
});

test("R1 strengthens governed knowledge freshness policy", () => {
  assert.ok(existsSync(new URL("./knowledge-freshness-assurance.test.mjs", import.meta.url)));
  const policy = read("scripts/knowledge-freshness-assurance.test.mjs");
  assert.match(policy, /4 hours|4\s*\*\s*60/i);
  assert.match(policy, /stale/i);
});

test("R1 adds UX regression assurance for horizontal overflow on priority workspaces", () => {
  assert.ok(existsSync(new URL("./operator-ux-hardening.test.mjs", import.meta.url)));
  const ux = read("scripts/operator-ux-hardening.test.mjs");
  assert.match(ux, /1440/);
  assert.match(ux, /1180/);
  assert.match(ux, /390/);
});
