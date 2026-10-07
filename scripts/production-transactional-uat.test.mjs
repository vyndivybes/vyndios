import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8").catch(() => "");
const [dbServer, db, authority, route, metadata, runner] = await Promise.all([
  read("src/lib/db.server.ts"),
  read("src/lib/db.ts"),
  read("src/lib/production-uat-authority.ts"),
  read("src/routes/command/uat-certification.tsx"),
  read("src/lib/page-metadata.ts"),
  read("scripts/vyndi-production-uat.mjs"),
]);

test("transactional UAT has a dedicated single-connection rollback primitive", () => {
  assert.match(db, /withSqlTransaction/);
  assert.match(dbServer, /withSqlTransactionServer/);
  assert.match(dbServer, /BEGIN/);
  assert.match(dbServer, /SERIALIZABLE/);
  assert.match(dbServer, /ROLLBACK/);
  assert.match(dbServer, /alwaysRollback/);
});

test("transactional UAT is admin-only and exercises four production authorities", () => {
  assert.match(authority, /requireBusinessActor\("admin"\)/);
  assert.match(authority, /RUN_ROLLBACK_UAT/);
  assert.match(authority, /create_vyndi_funding_grant/);
  assert.match(authority, /record_vyndi_people_employment_event/);
  assert.match(authority, /save_vyndi_master_inventory_entry/);
  assert.match(authority, /vyndi_quality_inspections/);
  assert.match(authority, /vyndi_audit_events/);
});

test("transactional UAT proves fixtures are absent after rollback", () => {
  assert.match(authority, /rollback verification/i);
  assert.match(authority, /rolledBack:\s*true/);
  assert.match(authority, /remainingFixtureCount/);
});

test("certification route is hidden admin-only and Playwright executes it", () => {
  assert.match(metadata, /\/command\/uat-certification/);
  assert.match(metadata, /navHidden:\s*true/);
  assert.match(metadata, /adminOnly:\s*true/);
  assert.match(route, /Run rollback UAT/i);
  assert.match(route, /PASS · ROLLED BACK/i);
  assert.match(runner, /uat-certification/);
  assert.match(runner, /RUN_ROLLBACK_UAT/);
  assert.match(runner, /transactional write phase/i);
});

test("transactional UAT surfaces server failures and allows the expanded rollback transaction to finish", () => {
  assert.match(dbServer, /lock_timeout/i);
  assert.match(dbServer, /statement_timeout/i);
  assert.match(runner, /transactional server failure/i);
  assert.match(runner, /transactionalTimeoutMs\s*=\s*120_000/);
  assert.match(runner, /getByRole\("alert"\)/);
  assert.match(runner, /transactional UAT timed out/i);
  assert.match(runner, /while \(Date\.now\(\) < deadline\)/);
  assert.doesNotMatch(runner, /timeout:\s*45_000/);
});


test("transactional UAT exercises Finance and HR/payroll production authorities", () => {
  assert.match(authority, /post_vyndi_finance_journal/);
  assert.match(authority, /apply_vyndi_verified_cash_movement/);
  assert.match(authority, /post_vyndi_supplier_payment/);
  assert.match(authority, /post_vyndi_people_office_actual_payment/);
  assert.match(authority, /save_vyndi_linked_payroll_control/);
  assert.match(authority, /epr_finance_journal_lines/);
  assert.match(authority, /epr_finance_payroll_controls/);
  assert.match(authority, /sales_invoice/);
  assert.match(authority, /customer_receipt/);
  assert.match(route, /Finance/i);
  assert.match(route, /Payroll/i);
});


test("browser UAT tolerates inventory hydration and requires Finance and HR/payroll domain PASS", () => {
  assert.match(runner, /inventory entry did not open after hydrated retry/i);
  assert.match(runner, /Close entry/i);
  assert.match(runner, /"finance", "hrPayroll"/);
});
