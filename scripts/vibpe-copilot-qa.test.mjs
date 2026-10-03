import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { VIBPE_QA_CASES } from "./vibpe-copilot-qa-cases.mjs";

const qa = await readFile(new URL("../src/lib/vibpe-copilot-qa.ts", import.meta.url), "utf8");
const runner = await readFile(new URL("./vibpe-copilot-qa-runner.mjs", import.meta.url), "utf8");
const copilot = await readFile(new URL("../src/lib/vibpe-copilot-2.ts", import.meta.url), "utf8");
const liveSpecialist = await readFile(new URL("../src/lib/vibpe-live-specialist-queries.ts", import.meta.url), "utf8");

const EXPECTED_PACKS = [
  "actual-vs-plan",
  "cash-ledger-reconciliation",
  "demand-commitment-feasibility",
  "funding",
  "inventory",
  "job-card-traveller",
  "liquidity",
  "procurement-recommendations",
];

test("QA corpus covers at least six scenarios in all eight governed packs", () => {
  assert.ok(VIBPE_QA_CASES.length >= 48);
  const counts = new Map();
  for (const item of VIBPE_QA_CASES) counts.set(item.pack, (counts.get(item.pack) ?? 0) + 1);
  assert.deepEqual([...counts.keys()].sort(), EXPECTED_PACKS);
  for (const count of counts.values()) assert.ok(count >= 6);
});

test("QA engine classifies all seven requested answer dimensions", () => {
  for (const dimension of [
    "correctness",
    "completeness",
    "provenance",
    "ledger-vs-plan-semantics",
    "freshness",
    "repetition",
    "actionability",
  ]) assert.match(qa, new RegExp(`"${dimension}"`));
});

test("autonomous correction scope fails closed around business authority", () => {
  assert.ok(qa.includes("/^migrations\\//"));
  assert.ok(qa.includes("/^src\\/routes\\//"));
  assert.ok(qa.includes("transaction(?:al)?\\s+business\\s+data"));
  assert.ok(qa.includes("Any QA mutation requires a governed test fixture or sandbox."));
  assert.ok(qa.includes("VIBPE QA correction scope violation"));
  assert.ok(qa.includes("production\\s+release"));
});

test("runner exercises the current certified routing stack rather than reviving PR205 specialist code", () => {
  assert.match(runner, /tryVibpeLiveSpecialistAnswer\(sql, question\)/);
  assert.match(runner, /runVibpeCopilot2\(sql, question, governedBaseline/);
  assert.match(runner, /262cac9ff5cfc37a8dd66a14b1b57fa3c3024ad8/);
  assert.doesNotMatch(runner, /vibpe-qa-governed-queries/);
  assert.match(copilot, /tryGovernanceDataAnswer/);
  assert.match(copilot, /tryOperationalDataAnswer/);
  assert.match(liveSpecialist, /tryVibpeLiveSpecialistAnswer/);
});

test("runner emits auditable JSON and Markdown and preserves non-autonomous guardrails", () => {
  assert.match(runner, /JSON\.stringify\(\{ \.\.\.meta, audits \}/);
  assert.match(runner, /markdownReport\(meta, audits\)/);
  assert.match(runner, /transactionalBusinessDataAutoMutation: false/);
  assert.match(runner, /automaticProcurementCommitment: false/);
  assert.match(runner, /automaticFundingCommitment: false/);
  assert.match(runner, /automaticCustomerPromise: false/);
  assert.match(runner, /productionReleaseMutation: false/);
  assert.match(runner, /migrationsAllowed: false/);
});

test("governed questions retain domain truth and fail closed on commitments", async (t) => {
  const { createServer } = await import("vite");
  const { fileURLToPath } = await import("node:url");
  const server = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)),
    configFile: false,
    appType: "custom",
    logLevel: "error",
    server: { middlewareMode: true },
    resolve: { alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) } },
  });
  t.after(() => server.close());
  const operational = await server.ssrLoadModule("/src/lib/vibpe-operational-queries.ts");
  const governance = await server.ssrLoadModule("/src/lib/vibpe-governance-queries.ts");
  const truth = await server.ssrLoadModule("/src/lib/vibpe-truth-contract.ts");
  const queries = [];
  const sql = async () => [];
  sql.query = async (query) => {
    queries.push(query);
    if (query.includes("with current_orders as")) return [{
      confirmed_orders: 1, confirmed_units: 1, active_job_cards: 1,
      committed_component_units: 3, committed_skus: 2, net_committed_shortage: 3,
      open_po_qty: 2, capacity_shortfall_months: 1, latest_run_id: "TEST-R1",
    }];
    if (query.includes("from epr_production_job_cards c")) return [{
      job_card_id: "JC-TEST", sales_order_id: "SO-TEST", sales_order_revision: 1,
      matched_order_id: "SO-TEST", matched_order_revision: 2,
    }];
    return [];
  };
  const baseline = {
    cash: [], supply: [], findings: [],
    summary: { minimumFreeLiquidityAfterRecommendationsLakh: -4, totalRecommendedProcurementLakh: 1 },
    funding: { incrementalFundingNeedLakh: 4, firstLiquidityBreachAfterRecommendationsPeriod: 1 },
  };

  await t.test("confirmed-demand paraphrases use material and capacity evidence", async () => {
    for (const question of [
      "Stress-test whether confirmed demand is feasible using both material and capacity evidence.",
      "What blocks the currently confirmed orders from being produced?",
      "Capacity is available but a released material reservation is short. Can VIBPE promise delivery?",
    ]) {
      const answer = await operational.tryOperationalDataAnswer(sql, question);
      assert.match(answer, /Committed-demand feasibility: BLOCKED/);
      assert.match(answer, /3.0 component units/);
      assert.match(answer, /capacity shortfall month/);
      assert.match(answer, /advisory only/);
    }
  });
  await t.test("stale sales-order revisions require execution hold", async () => {
    for (const question of [
      "Trace released job cards back to the confirmed sales-order revision that authorised them.",
      "A sales-order revision changed after job release. What must happen to stale execution evidence?",
    ]) {
      const answer = await governance.tryGovernanceDataAnswer(sql, question);
      assert.match(answer, /FAIL/);
      assert.match(answer, /stale revision R1; current sales order is R2/);
      assert.match(answer, /hold affected execution/);
    }
  });
  await t.test("today's payment uses ledger authority, not forecast surplus", async () => {
    const answer = await truth.tryVibpeTruthContractAnswer(sql,
      "The forecast shows surplus cash but the ledger is lower. Which figure is authoritative for today's payment decision?", baseline);
    assert.match(answer, /current reconciled ledger cash, not forecast surplus/);
    assert.match(answer, /do not silently reconcile/);
    assert.match(answer, /human approval/);
  });
  await t.test("supplier comparison does not fabricate lane metrics", async () => {
    const answer = await truth.tryVibpeTruthContractAnswer(sql,
      "Two approved suppliers can cover the same shortage. Explain the trade-off without committing either supplier.", baseline);
    assert.match(answer, /cost, lead time, reliability/);
    assert.match(answer, /does not establish those supplier-lane metrics/);
    assert.match(answer, /advisory only/);
  });
  await t.test("reservations and quarantine do not become usable promise stock", async () => {
    for (const question of [
      "Physical stock is positive but all of it is reserved. What is actually available to promise?",
      "A goods receipt is quarantined. Should it count as usable stock for committed production?",
    ]) {
      const answer = await truth.tryVibpeTruthContractAnswer(sql, question, baseline);
      assert.match(answer, /no free stock remains for a new promise/);
      assert.match(answer, /quarantined goods receipt must not count as usable stock/);
      assert.match(answer, /not a verified stock balance/);
    }
  });
  await t.test("completion cannot bypass serial quality-release authority", async () => {
    const answer = await truth.tryVibpeTruthContractAnswer(sql,
      "A job is complete but one serial lacks final quality release. Can dispatch proceed?", baseline);
    assert.match(answer, /Dispatch cannot proceed while any serial lacks final quality release/);
    assert.match(answer, /advisory only/);
  });
  assert.ok(queries.every((query) => /^\s*(select|with)\b/i.test(query)), "handlers must remain read-only");
});

test("reconciliation fixture is selected before its embedded inventory view", () => {
  const reconciliation = runner.indexOf('if (q.includes("with jc as")');
  const inventory = runner.indexOf('if (q.includes("from vyndi_report_procurement_net_requirement")');
  assert.ok(reconciliation >= 0 && inventory > reconciliation);
});
