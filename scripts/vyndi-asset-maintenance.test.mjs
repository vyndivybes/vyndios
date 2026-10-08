import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read=(path)=>readFile(new URL(`../${path}`,import.meta.url),"utf8");
const [migration,model,authority,panel,route,fiveM,vibpe,pkg]=await Promise.all([
  read("migrations/0111_vyndi_asset_maintenance.sql"),
  read("src/lib/asset-maintenance-model.ts"),
  read("src/lib/asset-maintenance-authority.ts"),
  read("src/components/asset-maintenance-panel.tsx"),
  read("src/routes/command/manufacturing.tsx"),
  read("src/lib/epr/five-m.ts"),
  read("src/lib/vibpe-governance-queries.ts"),
  read("package.json"),
]);

test("Package L extends the existing EPR equipment authority instead of creating a competing asset master",()=>{
  assert.match(migration,/alter table epr_equipment/);
  assert.doesNotMatch(migration,/create table if not exists vyndi_assets\b/i);
  assert.match(migration,/vyndi_maintenance_plans/);
  assert.match(migration,/vyndi_maintenance_work_orders/);
  assert.match(migration,/vyndi_maintenance_parts/);
});

test("maintenance model exposes evidence-backed reliability and withholds unsupported OEE",()=>{
  for(const token of ["mtbfHours","mttrHours","observedAvailabilityPct","downtimeHours","oeePct","oeeReason"]) assert.ok(model.includes(token),token);
  assert.match(model,/WITHHELD/i);
  assert.doesNotMatch(model,/Math\.random/);
});

test("maintenance authority governs asset plans work orders completion and return to service",async()=>{
  for(const token of ["registerEquipmentAsset","createMaintenancePlan","createMaintenanceWorkOrder","startMaintenanceWorkOrder","cancelMaintenanceWorkOrder","completeMaintenanceWorkOrder"]) assert.match(authority,new RegExp(token));
  assert.match(authority,/ASSET_REGISTERED/);
  assert.match(authority,/MAINTENANCE_PLAN_CREATED/);
  assert.match(authority,/MAINTENANCE_WORK_ORDER_CANCELLED/);
  assert.match(authority,/select \* from complete_vyndi_maintenance_work_order/);
  const closure=await read("migrations/0139_quality_maintenance_authority_closure.sql");
  assert.match(closure,/MAINTENANCE_WORK_ORDER_COMPLETED/);
  assert.match(closure,/RETURN_TO_SERVICE/);
  assert.match(authority,/epr_operation_controls/);
});

test("manufacturing workspace hosts Asset & Maintenance Intelligence",()=>{
  assert.match(route,/AssetMaintenancePanel/);
  assert.match(panel,/Asset & Maintenance Intelligence/);
  assert.match(panel,/MTBF/);
  assert.match(panel,/MTTR/);
  assert.match(panel,/Return to service/);
});

test("controlled EPR operations have a canonical completion writer so operating hours can be measured",()=>{
  assert.match(fiveM,/export const blockControlledOperation/);
  assert.match(fiveM,/export const completeControlledOperation/);
  assert.match(fiveM,/completed_at=now\(\)/);
  assert.match(fiveM,/status='blocked'/);
  assert.match(fiveM,/status='completed'/);
});

test("existing EPR execution remains fail-closed on unavailable overdue or uncalibrated equipment",()=>{
  assert.match(fiveM,/status='available'/);
  assert.match(fiveM,/calibration_due_at/);
  assert.match(fiveM,/maintenance_due_at/);
  assert.match(fiveM,/overdue for calibration, or overdue for maintenance/);
});

test("VIBPE exposes governed maintenance status without claiming unsupported OEE",()=>{
  assert.match(vibpe,/isAssetMaintenanceQuestion/);
  assert.match(vibpe,/assetMaintenanceAnswer/);
  assert.match(vibpe,/MTBF/);
  assert.match(vibpe,/MTTR/);
  assert.match(vibpe,/OEE.*WITHHELD/i);
});

test("aggregate test gate includes Package L model and integration tests",()=>{
  assert.match(pkg,/vyndi-asset-maintenance\.test\.mjs/);
  assert.match(pkg,/asset-maintenance-model\.test\.ts/);
});


test("Asset maintenance GET state crosses the server boundary with JSON-serializable rows",()=>{
  assert.match(authority,/type SerializableRow/);
  assert.match(authority,/toSerializableRow/);
  assert.match(authority,/assets: .*toSerializableRow/);
  assert.match(authority,/plans: .*toSerializableRow/);
  assert.match(authority,/workOrders: .*toSerializableRow/);
  assert.match(authority,/parts: .*toSerializableRow/);
  assert.doesNotMatch(authority,/return \{ sql, assets: \[\.\.\.assets\], plans: \[\.\.\.plans\], workOrders: \[\.\.\.workOrders\], parts: \[\.\.\.parts\]/);
});

