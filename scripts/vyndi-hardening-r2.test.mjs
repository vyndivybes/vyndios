import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("R2 uses a durable shared auth abuse limiter in production", () => {
  assert.ok(existsSync(new URL("../migrations/0093_auth_abuse_rate_limit.sql", import.meta.url)));
  const limiter = read("src/lib/security/rate-limit.ts");
  assert.match(limiter, /getSqlServer/);
  assert.match(limiter, /vyndi_auth_rate_limits/);
  assert.match(limiter, /sha256|createHash/i);
  assert.doesNotMatch(limiter, /const buckets = new Map/);
});

test("R2 runs a real transaction Golden Enterprise qualification", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.ok(pkg.scripts["test:golden-enterprise:transaction"]);
  assert.match(pkg.scripts["test:golden-enterprise:transaction"], /canonical-business-truth/);
  assert.match(pkg.scripts["test:golden-enterprise:transaction"], /Stage 2 order/);
  assert.match(pkg.scripts["test:golden-enterprise:transaction"], /recommendation.*PO approval/i);
  const stageD = read(".github/workflows-enterprise/stage-d-acceptance.yml");
  assert.match(stageD, /test:golden-enterprise:transaction/);
});

test("R2 strengthens coverage scope beyond the original R1 subset", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.ok(pkg.scripts["test:coverage:enterprise"]);
  assert.match(pkg.scripts["test:coverage:enterprise"], /master-ledger\.test\.ts/);
  assert.match(pkg.scripts["test:coverage:enterprise"], /advanced-planning-highs-adapter\.test\.ts/);
  assert.match(pkg.scripts["test:coverage:enterprise"], /vibpe-carbon-bike-material-gate\.test\.ts/);
  assert.match(read(".github/workflows-enterprise/ci.yml"), /test:coverage:enterprise/);
});

test("R2 expands VIBPE benchmark to at least 48 cases", async () => {
  const { VIBPE_QA_CASES } = await import("./vibpe-copilot-qa-cases.mjs");
  assert.ok(VIBPE_QA_CASES.length >= 48, `expected >=48 cases, got ${VIBPE_QA_CASES.length}`);
});

test("R2 adds optimizer backtest framework and fixtures", () => {
  assert.ok(existsSync(new URL("./advanced-optimizer-backtest.test.mjs", import.meta.url)));
  const backtest = read("scripts/advanced-optimizer-backtest.test.mjs");
  assert.match(backtest, /actual/i);
  assert.match(backtest, /planned|optimizer/i);
  assert.match(backtest, /variance|error/i);
});

test("R2 adds main-branch governance tripwire", () => {
  assert.ok(existsSync(new URL("../.github/workflows-enterprise/main-governance.yml", import.meta.url)));
  const wf = read(".github/workflows-enterprise/main-governance.yml");
  assert.match(wf, /push:/);
  assert.match(wf, /pull_request|merge/i);
  assert.match(wf, /main/);
});

test("R2 production assurance includes transaction qualification and release SHA", () => {
  const wf = read(".github/workflows/production-assurance.yml");
  assert.match(wf, /test:golden-enterprise:transaction/);
  assert.match(wf, /VYNDI_TEST_EXPECTED_SHA/);
  assert.match(wf, /observe:slo/);
});

