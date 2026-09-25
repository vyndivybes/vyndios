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

test("QA corpus covers at least four scenarios in all eight governed packs", () => {
  assert.ok(VIBPE_QA_CASES.length >= 32);
  const counts = new Map();
  for (const item of VIBPE_QA_CASES) counts.set(item.pack, (counts.get(item.pack) ?? 0) + 1);
  assert.deepEqual([...counts.keys()].sort(), EXPECTED_PACKS);
  for (const count of counts.values()) assert.ok(count >= 4);
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
