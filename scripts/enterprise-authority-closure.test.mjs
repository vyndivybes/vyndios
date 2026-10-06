import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function text(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Quality release uses one canonical latest-effective gate across native Quality and EPR evidence", async () => {
  const migration = await text("migrations/0139_quality_maintenance_authority_closure.sql");
  const authority = await text("src/lib/quality-authority.ts");

  assert.match(migration, /create or replace function vyndi_quality_release_gate/i);
  assert.match(migration, /inspection_stage='final'/i);
  assert.match(migration, /order by recorded_at desc\s*,\s*id desc/i);
  assert.match(migration, /epr_inspections/i);
  assert.match(migration, /inspected_at\s*>\s*v_final_recorded_at/i);
  assert.match(migration, /result in \('fail','conditional','pending'\)/i);
  assert.match(migration, /epr_ncr_capa/i);
  assert.match(migration, /vyndi_quality_ncrs/i);

  assert.match(authority, /vyndi_quality_release_gate/);
  assert.doesNotMatch(authority, /count\(\*\).*inspection_stage='final'.*result='pass'/is);
  assert.match(authority, /latest effective final inspection/i);
});

test("Maintenance completion is one database transaction and posts canonical FIFO inventory issues", async () => {
  const migration = await text("migrations/0139_quality_maintenance_authority_closure.sql");
  const authority = await text("src/lib/asset-maintenance-authority.ts");

  assert.match(migration, /create or replace function complete_vyndi_maintenance_work_order/i);
  assert.match(migration, /select .* from vyndi_maintenance_work_orders .* for update/is);
  assert.match(migration, /jsonb_array_elements/i);
  assert.match(migration, /post_vyndi_inventory_issue/i);
  assert.match(migration, /insert into vyndi_maintenance_parts/i);
  assert.match(migration, /inventory_movement_id/i);
  assert.match(migration, /inventory_ledger_id/i);
  assert.match(migration, /fifo_cost_inr/i);
  assert.match(migration, /MAINTENANCE_WORK_ORDER_COMPLETED/i);
  assert.match(migration, /RETURN_TO_SERVICE/i);

  assert.match(authority, /complete_vyndi_maintenance_work_order/);
  assert.doesNotMatch(authority, /for\s*\(const part of data\.parts\)/);
  assert.doesNotMatch(authority, /insert into vyndi_maintenance_parts/);
  assert.doesNotMatch(authority, /update vyndi_maintenance_work_orders set status='completed'/);
});

test("Maintenance UI no longer treats an operator-entered unit cost as authoritative", async () => {
  const panel = await text("src/components/asset-maintenance-panel.tsx");
  assert.doesNotMatch(panel, /partUnitCost/);
  assert.match(panel, /FIFO|canonical inventory/i);
});
