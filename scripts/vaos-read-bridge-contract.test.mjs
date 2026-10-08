import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

test("VAOS read bridge exposes exactly the eight commissioned read actions", async () => {
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
