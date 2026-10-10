import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

test("VAOS bridge preserves the original eight reads and the governed project schedule read", async () => {
  const source = await readFile(join(root, "src/routes/api/vaos/bridge.ts"), "utf8");
  const actions = [
    "COMMERCIAL.OBSERVE_PIPELINE",
    "PROCUREMENT.OBSERVE_SHORTAGE",
    "INVENTORY.OBSERVE_STOCK",
    "PRODUCTION.OBSERVE_WIP",
    "MAINTENANCE.OBSERVE_ASSET",
    "FINANCE.OBSERVE_LEDGER",
    "PEOPLE.OBSERVE_WORKFORCE",
    "ENGINEERING.OBSERVE_CONFIGURATION",
    "PROJECT.OBSERVE_SCHEDULE",
  ];
  for (const action of actions) assert.equal(source.includes(action), true, action);
  assert.equal(source.includes("action_not_commissioned"), true);
  assert.equal(source.includes("replay_detected"), true);
  assert.equal(source.includes("body_hash_mismatch"), true);
  assert.equal(source.includes("readOnly: true"), true);
});

test("migration 0147 provides durable nonce replay protection", async () => {
  const sql = await readFile(join(root, "migrations/0147_vaos_signed_bridge_read_commissioning.sql"), "utf8");
  assert.equal(sql.toLowerCase().includes("create table if not exists vyndi_vaos_bridge_nonces"), true);
  assert.equal(sql.toLowerCase().includes("nonce text primary key"), true);
  assert.equal(sql.includes("claim_vyndi_vaos_bridge_nonce"), true);
  assert.equal(sql.toLowerCase().includes("on conflict (nonce) do nothing"), true);
});

test("VAOS read bridge enforces protocol-v2 signed context before executing", async () => {
  const source = await readFile(join(root, "src/routes/api/vaos/bridge.ts"), "utf8");
  assert.equal(source.includes("validateVaosBridgeSignedContext"), true);
  assert.equal(source.includes("signed_context_invalid"), true);
  assert.equal(source.includes("employee_context_mismatch"), true);
});

test("Stage-3 compensated qualification remains intact while Stage-4 commissions only People draft writes", async () => {
  const source = await readFile(join(root, "src/routes/api/vaos/bridge.ts"), "utf8");
  const sql = await readFile(join(root, "migrations/0148_vaos_write_qualification_canary.sql"), "utf8");

  assert.equal(source.includes('purpose === "write-qualify"'), true);
  assert.equal(source.includes("qualify_vaos_commercial_write_canary"), true);
  assert.equal(source.includes("COMMERCIAL_WRITE_CANARY_V1"), true);
  assert.equal(source.includes('actionType !== "PEOPLE.CHANGE_EMPLOYEE_MASTER"'), true);
  assert.equal(source.includes('payload.operationalWriteProfile !== OPERATIONAL_WRITE_PROFILE'), true);
  assert.equal(source.includes("operational_write_scope_denied"), true);
  assert.equal(source.includes("execute_vaos_people_master_draft_change"), true);

  assert.match(sql,/create table if not exists vyndi_vaos_write_qualifications/i);
  assert.match(sql,/create or replace function qualify_vaos_commercial_write_canary/i);
  assert.match(sql,/VAOS-CANARY-SO-/);
  assert.match(sql,/COMMERCIAL_WRITE_CANARY_V1/);
  assert.match(sql,/save_vyndi_sales_order/);
  assert.match(sql,/'lead'/);
  assert.match(sql,/'cancelled'/);
  assert.match(sql,/COMPENSATED/);
});
