import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read=(path)=>readFile(path,"utf8");

test("H3 qualifies bounded DB, route and optimizer load without weakening governance", async()=>{
  const [db,route,optimizer,workflow,policy,pool,budget]=await Promise.all([
    read("scripts/h3-db-performance.mjs"),
    read("scripts/h3-route-load.mjs"),
    read("scripts/h3-optimizer-performance.mjs"),
    read(".github/workflows/h3-performance-load.yml"),
    read("docs/VYNDI-H3-PERFORMANCE-LOAD-QUALIFICATION-REV1.md"),
    read("src/lib/postgres-pool.ts"),
    read("src/lib/optimizer-resource-budget.ts"),
  ]);

  assert.match(db,/for \(const concurrency of \[5,10,20\]\)/);
  assert.match(db,/async function warmPool/);
  assert.match(db,/startupWarmup/);
  assert.match(db,/clients\.map\(\(client\)=>client\.release\(\)\)/);
  assert.match(db,/H3-HOTSPOT/);
  assert.match(db,/hotspotCurrentRevision,13/);
  assert.match(db,/unattributedAuditEvents,0/);
  assert.match(db,/writeP95LimitMs.*3000/);
  assert.match(route,/H3_ROUTE_CONCURRENCY \|\| 8/);
  assert.match(route,/p95LimitMs.*8000/);
  assert.match(route,/p99LimitMs.*15000/);
  assert.match(route,/Warm each route sequentially before measuring concurrency/);
  assert.match(route,/evidence\.warmup\.push/);
  assert.doesNotMatch(route,/context\.request\.(post|put|patch|delete)\(/);
  assert.match(optimizer,/loadHighs/);
  assert.match(optimizer,/hardRuntimeMs=12_000/);
  assert.match(optimizer,/p95LimitMs.*8000/);
  assert.match(workflow,/H3 PostgreSQL concurrency qualification/);
  assert.match(workflow,/H3 authenticated route load qualification/);
  assert.match(workflow,/H3 governed optimizer performance qualification/);
  assert.match(workflow,/actions\/upload-artifact@v4/);
  assert.match(policy,/minimum qualified operating envelope/i);
  assert.match(policy,/CI results are not an assertion of the maximum production capacity/i);
  assert.match(pool,/max: 5/);
  assert.match(pool,/maxUses: 1/);
  assert.match(budget,/VYNDI_OPTIMIZER_MAX_RUNTIME_MS = 12_000/);
});

test("H3 evidence remains isolated from production and preserves safe-degradation rules", async()=>{
  const [workflow,policy]=await Promise.all([
    read(".github/workflows/h3-performance-load.yml"),
    read("docs/VYNDI-H3-PERFORMANCE-LOAD-QUALIFICATION-REV1.md"),
  ]);
  assert.match(workflow,/postgresql:\/\/postgres:postgres@localhost:5432\/vyndi_h3/);
  assert.doesNotMatch(workflow,/production.*DATABASE_URL/i);
  assert.match(policy,/must never be converted into fabricated transaction success/i);
  assert.match(policy,/cannot grant transaction authority/i);
  assert.match(policy,/No automatic retry of a heavy optimizer request/i);
});
