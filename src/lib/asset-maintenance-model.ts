export type AssetStatus = "available" | "in_use" | "maintenance" | "quarantined" | "retired";
export type MaintenanceWorkOrderType = "preventive" | "corrective" | "inspection" | "calibration";
export type MaintenanceWorkOrderStatus = "draft" | "scheduled" | "in_progress" | "completed" | "cancelled";

export type AssetMaintenanceAsset = {
  id: string;
  assetTag: string;
  equipmentType: string;
  status: AssetStatus;
  criticality?: "low" | "medium" | "high" | "critical" | null;
  maintenanceDueAt?: string | null;
  calibrationRequired: boolean;
  calibrationDueAt?: string | null;
};

export type AssetMaintenanceWorkOrder = {
  id: string;
  equipmentId: string;
  type: MaintenanceWorkOrderType;
  status: MaintenanceWorkOrderStatus;
  startedAt?: string | null;
  completedAt?: string | null;
  downtimeStartedAt?: string | null;
  downtimeEndedAt?: string | null;
};

export type AssetOperatingHours = {
  equipmentId: string;
  hours: number;
};

const round1=(value:number)=>Math.round(value*10)/10;
const round3=(value:number)=>Math.round(value*1000)/1000;

function time(value:string|null|undefined){
  if(!value) return null;
  const parsed=Date.parse(value);
  return Number.isFinite(parsed)?parsed:null;
}

function elapsedHours(start:string|null|undefined,end:string|null|undefined){
  const from=time(start);
  const to=time(end);
  if(from==null||to==null||to<from) return null;
  return (to-from)/3_600_000;
}

function assetMetrics(
  asset:AssetMaintenanceAsset,
  operatingHours:AssetOperatingHours[],
  workOrders:AssetMaintenanceWorkOrder[],
){
  const hours=operatingHours
    .filter((row)=>row.equipmentId===asset.id&&Number.isFinite(row.hours)&&row.hours>=0)
    .reduce((sum,row)=>sum+row.hours,0);

  const corrective=workOrders.filter((row)=>
    row.equipmentId===asset.id&&
    row.type==="corrective"&&
    row.status==="completed"
  );
  const repairDurations=corrective
    .map((row)=>elapsedHours(row.startedAt,row.completedAt))
    .filter((value):value is number=>value!=null);
  const downtimeDurations=workOrders
    .filter((row)=>row.equipmentId===asset.id&&row.status==="completed")
    .map((row)=>elapsedHours(row.downtimeStartedAt,row.downtimeEndedAt))
    .filter((value):value is number=>value!=null);

  const failures=corrective.length;
  const mtbfHours=failures>0&&hours>0?round3(hours/failures):null;
  const mttrHours=failures>0&&repairDurations.length===failures
    ? round3(repairDurations.reduce((sum,value)=>sum+value,0)/failures)
    : null;
  const observedAvailabilityPct=mtbfHours!=null&&mttrHours!=null&&(mtbfHours+mttrHours)>0
    ? round1((mtbfHours/(mtbfHours+mttrHours))*100)
    : null;

  return {
    equipmentId:asset.id,
    operatingHours:round3(hours),
    correctiveFailureCount:failures,
    mtbfHours,
    mttrHours,
    observedAvailabilityPct,
    downtimeHours:round3(downtimeDurations.reduce((sum,value)=>sum+value,0)),
  };
}

export function buildAssetMaintenanceIntelligence(input:{
  asOf:string;
  assets:AssetMaintenanceAsset[];
  operatingHours:AssetOperatingHours[];
  workOrders:AssetMaintenanceWorkOrder[];
}){
  const asOf=time(input.asOf)??Date.now();
  const activeAssets=input.assets.filter((asset)=>asset.status!=="retired");
  const overdueMaintenanceAssetIds=activeAssets
    .filter((asset)=>{
      const due=time(asset.maintenanceDueAt);
      return due!=null&&due<asOf;
    })
    .map((asset)=>asset.id)
    .sort();
  const overdueCalibrationAssetIds=activeAssets
    .filter((asset)=>{
      if(!asset.calibrationRequired) return false;
      const due=time(asset.calibrationDueAt);
      return due!=null&&due<asOf;
    })
    .map((asset)=>asset.id)
    .sort();
  const missingCalibrationDueAssetIds=activeAssets
    .filter((asset)=>asset.calibrationRequired&&!asset.calibrationDueAt)
    .map((asset)=>asset.id)
    .sort();
  const unavailableAssetIds=activeAssets
    .filter((asset)=>asset.status!=="available"&&asset.status!=="in_use")
    .map((asset)=>asset.id)
    .sort();
  const releaseBlockedAssetIds=[...new Set([
    ...unavailableAssetIds,
    ...overdueMaintenanceAssetIds,
    ...overdueCalibrationAssetIds,
    ...missingCalibrationDueAssetIds,
  ])].sort();

  const perAsset=activeAssets
    .map((asset)=>assetMetrics(asset,input.operatingHours,input.workOrders))
    .sort((a,b)=>a.equipmentId.localeCompare(b.equipmentId));
  const correctiveFailureCount=perAsset.reduce((sum,row)=>sum+row.correctiveFailureCount,0);
  const observedOperatingHours=round3(perAsset.reduce((sum,row)=>sum+row.operatingHours,0));
  const downtimeHours=round3(perAsset.reduce((sum,row)=>sum+row.downtimeHours,0));

  const completedCorrective=input.workOrders.filter((row)=>row.type==="corrective"&&row.status==="completed");
  const repairDurations=completedCorrective
    .map((row)=>elapsedHours(row.startedAt,row.completedAt))
    .filter((value):value is number=>value!=null);
  const mtbfHours=correctiveFailureCount>0&&observedOperatingHours>0
    ? round3(observedOperatingHours/correctiveFailureCount)
    : null;
  const mttrHours=correctiveFailureCount>0&&repairDurations.length===correctiveFailureCount
    ? round3(repairDurations.reduce((sum,value)=>sum+value,0)/correctiveFailureCount)
    : null;
  const observedAvailabilityPct=mtbfHours!=null&&mttrHours!=null&&(mtbfHours+mttrHours)>0
    ? round1((mtbfHours/(mtbfHours+mttrHours))*100)
    : null;

  const openWorkOrderCount=input.workOrders.filter((row)=>!["completed","cancelled"].includes(row.status)).length;

  return {
    method:"VYNDI_ASSET_MAINTENANCE_1" as const,
    asOf:input.asOf,
    totalAssets:activeAssets.length,
    unavailableAssetCount:unavailableAssetIds.length,
    unavailableAssetIds,
    overdueMaintenanceAssetIds,
    overdueCalibrationAssetIds,
    missingCalibrationDueAssetIds,
    releaseBlockedAssetCount:releaseBlockedAssetIds.length,
    releaseBlockedAssetIds,
    openWorkOrderCount,
    correctiveFailureCount,
    observedOperatingHours,
    downtimeHours,
    mtbfHours,
    mttrHours,
    observedAvailabilityPct,
    oeePct:null as number|null,
    oeeReason:"OEE WITHHELD: governed planned production time, ideal cycle/performance loss, and quality-loss evidence are not yet jointly available in the maintenance authority.",
    assets:perAsset,
    boundaries:[
      "epr_equipment remains the canonical asset/equipment master; this model does not create a parallel asset identity.",
      "Observed operating hours are limited to captured EPR operation-control execution.",
      "MTBF is reported only when captured operating hours and completed corrective-failure evidence both exist.",
      "MTTR is reported only when every counted corrective failure has valid started/completed timestamps.",
      "Observed availability is derived only when both MTBF and MTTR are available.",
      "OEE is withheld until availability, performance and quality-loss denominators are governed at the same production grain.",
    ],
  };
}
