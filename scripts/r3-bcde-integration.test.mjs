import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../migrations/0095_r3_engineering_governance.sql", import.meta.url), "utf8");
const governance = readFileSync(new URL("../src/lib/engineering-governance-authority.ts", import.meta.url), "utf8");
const evidenceRoute = readFileSync(new URL("../src/routes/api/engineering/evidence.ts", import.meta.url), "utf8");
const threadRoute = readFileSync(new URL("../src/routes/api/engineering/thread.ts", import.meta.url), "utf8");
const copilot = readFileSync(new URL("../src/lib/vibpe-copilot-2.ts", import.meta.url), "utf8");

test("R3-B/C persistence has governed workflow and append-only decision evidence", () => {
  assert.match(migration, /create table if not exists vyndi_engineering_workflows/);
  assert.match(migration, /create table if not exists vyndi_engineering_workflow_events/);
  assert.match(migration, /create table if not exists vyndi_engineering_waivers/);
  assert.match(migration, /create table if not exists vyndi_engineering_evidence_acceptances/);
  assert.match(migration, /create table if not exists vyndi_engineering_release_decisions/);
  assert.match(migration, /append-only/i);
  assert.match(migration, /before update or delete on vyndi_engineering_workflow_events/i);
  assert.match(migration, /before update or delete on vyndi_engineering_release_decisions/i);
});

test("R3-E persistence stores immutable digital-thread snapshots and normalized links", () => {
  assert.match(migration, /create table if not exists vyndi_engineering_thread_snapshots/);
  assert.match(migration, /create table if not exists vyndi_engineering_thread_links/);
  assert.match(migration, /before update or delete on vyndi_engineering_thread_snapshots/i);
  assert.match(migration, /before update or delete on vyndi_engineering_thread_links/i);
});

test("R3-B/C server authority uses human identity, SoD workflow, evidence acceptance and deterministic release evaluation", () => {
  assert.match(governance, /requireBusinessActor/);
  assert.match(governance, /evaluateEngineeringWorkflowTransition/);
  assert.match(governance, /applyEngineeringWaiver/);
  assert.match(governance, /evaluateEngineeringRelease/);
  assert.match(governance, /compileVedmAuthorityGraph/);
  assert.match(governance, /vyndi_audit_events/);
  assert.match(governance, /SOD_MAKER_CHECKER/);
});

test("R3-C engineering evidence receiver records authority provenance without trusting it as approval", () => {
  assert.match(evidenceRoute, /authorityNodeId/);
  assert.match(evidenceRoute, /authoritySourceCommit/);
  assert.match(evidenceRoute, /evidence acceptance/i);
  assert.match(evidenceRoute, /HUMAN_APPROVAL_REQUIRED/);
});

test("R3-D VIBPE knowledge path invokes the authority guardrail before returning engineering authority answers", () => {
  assert.match(copilot, /evaluateVibpeAuthorityContext/);
  assert.match(copilot, /createVedmR3aSeed/);
  assert.match(copilot, /Authority guardrail/);
  assert.match(copilot, /blockingGateIds/);
});

test("R3-E digital-thread API is authenticated and read-only", () => {
  assert.match(threadRoute, /requireBusinessActor\("view"\)/);
  assert.match(threadRoute, /compileDigitalProductThread/);
  assert.match(threadRoute, /traceDigitalProductThread/);
  assert.match(threadRoute, /assessDigitalThreadImpact/);
  assert.doesNotMatch(threadRoute, /POST\s*:/);
  assert.doesNotMatch(threadRoute, /PUT\s*:/);
  assert.doesNotMatch(threadRoute, /DELETE\s*:/);
});
