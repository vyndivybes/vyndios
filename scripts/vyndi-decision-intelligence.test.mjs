import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read=(path)=>readFile(new URL(`../${path}`,import.meta.url),"utf8");

const [migration,model,authority,data,queries,intelligence,intelligenceDeck]=await Promise.all([
  read("migrations/0109_vibpe_decision_intelligence.sql"),
  read("src/lib/decision-intelligence-model.ts"),
  read("src/lib/decision-intelligence-authority.ts"),
  read("src/lib/decision-intelligence-data.ts"),
  read("src/lib/vibpe-governance-queries.ts"),
  read("src/routes/command/intelligence.tsx"),
  read("src/components/intelligence-advisory-deck.tsx"),
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
  assert.match(data,/vyndi_risk_intelligence/);
  assert.match(data,/vyndi_monte_carlo_runs/);
  assert.match(data,/vyndi_supplier_risk_runs/);
  assert.match(data,/vyndi_quality_intelligence_runs/);
  assert.match(authority,/DECISION_INTELLIGENCE_CAPTURED/);
});

test("VIBPE can answer decision-option questions without auto-approving actions",()=>{
  assert.match(queries,/isDecisionIntelligenceQuestion/);
  assert.match(queries,/decisionIntelligenceAnswer/);
  assert.match(queries,/does not approve, transact, release engineering, accept risk, commit funding, issue purchase orders/i);
});

test("Product Intelligence surfaces governed decision alternatives",()=>{
  assert.match(intelligence,/IntelligenceAdvisoryDeck/);
  assert.match(intelligenceDeck,/Decision Intelligence/);
  assert.match(intelligenceDeck,/Primary advisory/);
  assert.match(intelligenceDeck,/Governance-priority ordering/i);
});
