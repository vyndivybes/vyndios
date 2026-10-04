import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read=(path)=>readFile(new URL(`../${path}`,import.meta.url),"utf8");

const [migration,model,authority,queries,intelligence]=await Promise.all([
  read("migrations/0109_vibpe_decision_intelligence.sql"),
  read("src/lib/decision-intelligence-model.ts"),
  read("src/lib/decision-intelligence-authority.ts"),
  read("src/lib/vibpe-governance-queries.ts"),
  read("src/routes/command/intelligence.tsx"),
]);

test("Decision Intelligence persists advisory packets without transaction authority",()=>{
  assert.match(migration,/vyndi_decision_intelligence_runs/);
  assert.match(migration,/Immutable advisory/);
  assert.doesNotMatch(migration,/approved_by|approval_status|transaction_id/);
});

test("decision model uses governance-priority ordering and withholds invented benefit",()=>{
  assert.match(model,/GOVERNANCE_PRIORITY_NOT_UTILITY_OPTIMIZATION/);
  assert.match(model,/quantifiedBenefit:null/);
  assert.match(model,/Human.*Authority|human-controlled|human owner/i);
});

test("Decision Intelligence consumes governed evidence and keeps human authority",()=>{
  assert.match(authority,/vyndi_risk_intelligence/);
  assert.match(authority,/vyndi_monte_carlo_runs/);
  assert.match(authority,/vyndi_supplier_risk_runs/);
  assert.match(authority,/vyndi_quality_intelligence_runs/);
  assert.match(authority,/DECISION_INTELLIGENCE_CAPTURED/);
});

test("VIBPE can answer decision-option questions without auto-approving actions",()=>{
  assert.match(queries,/isDecisionIntelligenceQuestion/);
  assert.match(queries,/decisionIntelligenceAnswer/);
  assert.match(queries,/does not approve, transact, release engineering, accept risk, commit funding, issue purchase orders/i);
});

test("Product Intelligence surfaces governed decision alternatives",()=>{
  assert.match(intelligence,/Decision Intelligence/);
  assert.match(intelligence,/Primary advisory/);
  assert.match(intelligence,/governance-priority ordering/);
});
