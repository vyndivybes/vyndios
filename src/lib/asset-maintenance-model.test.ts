import test from "node:test";
import assert from "node:assert/strict";
import { buildAssetMaintenanceIntelligence, type AssetMaintenanceAsset } from "./asset-maintenance-model.ts";

const asset=(id:string,overrides:Partial<AssetMaintenanceAsset>={}):AssetMaintenanceAsset=>({
  id,
  assetTag:id,
  equipmentType:"test-rig",
  status:"available",
  criticality:"high",
  maintenanceDueAt:"2026-11-01T00:00:00Z",
  calibrationRequired:false,
  calibrationDueAt:null,
  ...overrides,
});

test("asset maintenance intelligence derives MTBF MTTR and observed availability from governed execution evidence",()=>{
  const result=buildAssetMaintenanceIntelligence({
    asOf:"2026-10-04T00:00:00Z",
    assets:[asset("EQ-1")],
    operatingHours:[{equipmentId:"EQ-1",hours:600}],
    workOrders:[
      {id:"WO-1",equipmentId:"EQ-1",type:"corrective",status:"completed",startedAt:"2026-09-01T00:00:00Z",completedAt:"2026-09-01T04:00:00Z",downtimeStartedAt:"2026-09-01T00:00:00Z",downtimeEndedAt:"2026-09-01T04:00:00Z"},
      {id:"WO-2",equipmentId:"EQ-1",type:"corrective",status:"completed",startedAt:"2026-09-20T00:00:00Z",completedAt:"2026-09-20T02:00:00Z",downtimeStartedAt:"2026-09-20T00:00:00Z",downtimeEndedAt:"2026-09-20T02:00:00Z"},
    ],
  });
  assert.equal(result.totalAssets,1);
  assert.equal(result.correctiveFailureCount,2);
  assert.equal(result.observedOperatingHours,600);
  assert.equal(result.mtbfHours,300);
  assert.equal(result.mttrHours,3);
  assert.equal(result.observedAvailabilityPct,99);
  assert.equal(result.downtimeHours,6);
  assert.equal(result.oeePct,null);
  assert.match(result.oeeReason,/WITHHELD/i);
});

test("maintenance intelligence never invents reliability when no corrective failure evidence exists",()=>{
  const result=buildAssetMaintenanceIntelligence({
    asOf:"2026-10-04T00:00:00Z",
    assets:[asset("EQ-1")],
    operatingHours:[{equipmentId:"EQ-1",hours:120}],
    workOrders:[],
  });
  assert.equal(result.correctiveFailureCount,0);
  assert.equal(result.mtbfHours,null);
  assert.equal(result.mttrHours,null);
  assert.equal(result.observedAvailabilityPct,null);
});

test("overdue maintenance and calibration are reported separately from equipment status",()=>{
  const result=buildAssetMaintenanceIntelligence({
    asOf:"2026-10-04T00:00:00Z",
    assets:[
      asset("EQ-M",{maintenanceDueAt:"2026-10-01T00:00:00Z"}),
      asset("EQ-C",{calibrationRequired:true,calibrationDueAt:"2026-09-30T00:00:00Z"}),
      asset("EQ-R",{status:"retired",maintenanceDueAt:"2026-01-01T00:00:00Z"}),
    ],
    operatingHours:[],
    workOrders:[],
  });
  assert.deepEqual(result.overdueMaintenanceAssetIds,["EQ-M"]);
  assert.deepEqual(result.overdueCalibrationAssetIds,["EQ-C"]);
  assert.equal(result.releaseBlockedAssetCount,2);
});

test("open maintenance work orders and unavailable assets are visible without fabricating OEE",()=>{
  const result=buildAssetMaintenanceIntelligence({
    asOf:"2026-10-04T00:00:00Z",
    assets:[asset("EQ-1",{status:"maintenance"})],
    operatingHours:[],
    workOrders:[{id:"WO-1",equipmentId:"EQ-1",type:"preventive",status:"in_progress",startedAt:"2026-10-04T00:00:00Z",completedAt:null,downtimeStartedAt:"2026-10-04T00:00:00Z",downtimeEndedAt:null}],
  });
  assert.equal(result.openWorkOrderCount,1);
  assert.equal(result.unavailableAssetCount,1);
  assert.equal(result.oeePct,null);
});
