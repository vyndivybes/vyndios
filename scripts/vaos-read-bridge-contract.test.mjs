import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import './vaos-procurement-canonical.test.mjs';

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

test("VAOS read bridge enforces protocol-v2 signed context before executing", async () => {
  const source = await readFile(join(root, "src/routes/api/vaos/bridge.ts"), "utf8");
  assert.equal(source.includes("validateVaosBridgeSignedContext"), true);
  assert.equal(source.includes("signed_context_invalid"), true);
  assert.equal(source.includes("employee_context_mismatch"), true);
});

test("Stage-3 qualification-only write bridge is atomic, compensated and does not commission operational writes", async () => {
  const source = await readFile(join(root, "src/routes/api/vaos/bridge.ts"), "utf8");
  const sql = await readFile(join(root, "migrations/0148_vaos_write_qualification_canary.sql"), "utf8");

  assert.equal(source.includes('purpose === "write-qualify"'), true);
  assert.equal(source.includes("qualify_vaos_commercial_write_canary"), true);
  assert.equal(source.includes("write_execution_not_commissioned"), true);
  assert.equal(source.includes("COMMERCIAL_WRITE_CANARY_V1"), true);

  assert.match(sql,/create table if not exists vyndi_vaos_write_qualifications/i);
  assert.match(sql,/create or replace function qualify_vaos_commercial_write_canary/i);
  assert.match(sql,/VAOS-CANARY-SO-/);
  assert.match(sql,/COMMERCIAL_WRITE_CANARY_V1/);
  assert.match(sql,/save_vyndi_sales_order/);
  assert.match(sql,/'lead'/);
  assert.match(sql,/'cancelled'/);
  assert.match(sql,/COMPENSATED/);
});

test("new VEDM knowledge graph read action is signed, nonce protected and read-only",async()=>{
 const route=await readFile(join(root,"src/routes/api/vaos/bridge.ts"),"utf8");
 assert.match(route,/KNOWLEDGE\.OBSERVE_VEDM_GRAPH/);
 assert.match(route,/compileVedmAuthorityGraph/);
 assert.match(route,/projectVedmAuthorityGraphForVaos/);
 assert.match(route,/claim_vyndi_vaos_bridge_nonce/);
 assert.match(route,/readOnly: true/);
 const source=await readFile(join(root,"src/lib/vaos-knowledge-graph-export.ts"),"utf8");
 assert.match(source,/currentRuntimeAuthorityVerified:false/);
 assert.match(source,/actionAuthorized:false/);
});

test("existing Cloudflare branch previews explicitly omit production database bindings and credentials",async()=>{
 const config=JSON.parse(await readFile(join(root,"wrangler.jsonc"),"utf8"));
 // Previews require this block and do not inherit production vars or bindings.
 assert.deepEqual(config.previews,{});
 assert.ok(config.hyperdrive.some(binding=>binding.binding==='HYPERDRIVE'));
});

test("signed PO observations retain cancelled-origin procurement drafts with explicit demand lineage",async()=>{
 const source=await readFile(join(root,"src/routes/api/vaos/bridge.ts"),"utf8");
 const block=source.split('if (actionType === "PROCUREMENT.OBSERVE_OPEN_POS") {')[1]
   ?.split('if (actionType === "INVENTORY.OBSERVE_STOCK")')[0]??"";
 assert.match(block,/LEFT JOIN epr_production_job_cards j ON j.id=p.job_card_id/i);
 assert.match(block,/LEFT JOIN vyndi_sales_orders s ON s.id=j.sales_order_id/i);
 assert.match(block,/j.status AS job_card_status/i);
 assert.match(block,/s.status AS sales_order_status/i);
 assert.match(block,/CANCELLED_UPSTREAM_DEMAND/);
 assert.match(block,/UPSTREAM_DEMAND_UNVERIFIED/);
 assert.match(block,/createOntologyReadReceipt/);
 assert.ok(block.includes("p.status IN ('draft','pending_approval','approved','issued','partially_received')"));
 // Cancelled-origin drafts remain in auditable read data, not silently deleted/hidden.
 assert.equal(block.includes("WHERE j.status <> 'cancelled'"),false);
});
