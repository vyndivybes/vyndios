import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getSql } from "@/lib/db";
import { getCommandRole } from "@/lib/command-access";
import { canPerform } from "@/lib/page-access";
import { requireBusinessActor } from "@/lib/business-actor";
import { buildAssetMaintenanceIntelligence } from "@/lib/asset-maintenance-model";

type Sql = Awaited<ReturnType<typeof getSql>>;
type Row = Record<string, unknown>;

async function requireView() {
  const role = await getCommandRole();
  if (!role || !canPerform(role, "view")) throw new Error("Asset maintenance view permission denied.");
  return role;
}

async function audit(
  sql: Sql,
  entityType: string,
  entityId: string,
  action: string,
  actorUserId: string,
  actorRole: string,
  sourceReference: string,
  payload: unknown,
) {
  await sql.query(
    "insert into vyndi_audit_events(id,entity_type,entity_id,action,actor_user_id,actor_role,source_reference,payload_json) values($1,$2,$3,$4,$5,$6,$7,$8::jsonb)",
    [crypto.randomUUID(), entityType, entityId, action, actorUserId, actorRole, sourceReference, JSON.stringify(payload)],
  );
}

async function refreshEquipmentDueState(sql: Sql, equipmentId: string) {
  const dueRows = await sql.query<{
    maintenance_due_at: string | null;
    calibration_due_at: string | null;
  }>(
    "select " +
    "min(next_due_at) filter (where strategy<>'calibration' and next_due_at is not null) as maintenance_due_at," +
    "min(next_due_at) filter (where strategy='calibration' and next_due_at is not null) as calibration_due_at " +
    "from vyndi_maintenance_plans where equipment_id=$1 and active=true",
    [equipmentId],
  );

  const maintenanceDue = dueRows[0]?.maintenance_due_at ?? null;
  const calibrationDue = dueRows[0]?.calibration_due_at ?? null;

  if (maintenanceDue) {
    await sql.query("update epr_equipment set maintenance_due_at=$1 where id=$2", [maintenanceDue, equipmentId]);
  }
  if (calibrationDue) {
    await sql.query("update epr_equipment set calibration_required=true,calibration_due_at=$1 where id=$2", [calibrationDue, equipmentId]);
  }
}

async function refreshEquipmentReleaseState(sql: Sql, equipmentId: string) {
  await refreshEquipmentDueState(sql, equipmentId);
  const rows = await sql.query<{
    status: string;
    calibration_required: boolean;
    calibration_due_at: string | null;
    maintenance_due_at: string | null;
  }>(
    "select status,calibration_required,calibration_due_at,maintenance_due_at from epr_equipment where id=$1 limit 1",
    [equipmentId],
  );
  const equipment = rows[0];
  if (!equipment || equipment.status === "retired") return "retired";

  const active = await sql.query<{ active_count: string; corrective_pending_count: string }>(
    "select " +
    "count(*) filter (where status='in_progress')::text as active_count," +
    "count(*) filter (where work_order_type='corrective' and status in ('draft','scheduled'))::text as corrective_pending_count " +
    "from vyndi_maintenance_work_orders where equipment_id=$1",
    [equipmentId],
  );
  if (Number(active[0]?.active_count ?? 0) > 0) {
    await sql.query("update epr_equipment set status='maintenance' where id=$1 and status<>'retired'", [equipmentId]);
    return "maintenance";
  }
  if (Number(active[0]?.corrective_pending_count ?? 0) > 0) {
    await sql.query("update epr_equipment set status='quarantined' where id=$1 and status<>'retired'", [equipmentId]);
    return "quarantined";
  }

  const now = Date.now();
  const maintenanceDue = equipment.maintenance_due_at ? Date.parse(equipment.maintenance_due_at) : null;
  const calibrationDue = equipment.calibration_due_at ? Date.parse(equipment.calibration_due_at) : null;
  const calibrationBlocked = equipment.calibration_required && (
    calibrationDue == null || !Number.isFinite(calibrationDue) || calibrationDue <= now
  );
  const maintenanceBlocked = maintenanceDue != null && Number.isFinite(maintenanceDue) && maintenanceDue <= now;
  const nextStatus = calibrationBlocked || maintenanceBlocked ? "quarantined" : "available";
  await sql.query("update epr_equipment set status=$1 where id=$2 and status<>'retired'", [nextStatus, equipmentId]);
  return nextStatus;
}

async function loadState() {
  const sql = await getSql();
  const [assets, plans, workOrders, parts, operatingRows] = await Promise.all([
    sql.query<Row>(
      "select id,asset_tag,equipment_type,description,status,calibration_required,calibration_due_at,last_calibrated_at,maintenance_due_at," +
      " manufacturer,model_number,serial_number,location,criticality,owner_ref,commissioned_at,last_maintained_at,created_at" +
      " from epr_equipment order by criticality desc,asset_tag",
    ),
    sql.query<Row>(
      "select * from vyndi_maintenance_plans order by active desc,next_due_at nulls last,id",
    ),
    sql.query<Row>(
      "select * from vyndi_maintenance_work_orders order by opened_at desc,id desc limit 500",
    ),
    sql.query<Row>(
      "select * from vyndi_maintenance_parts order by created_at desc,id desc limit 1000",
    ),
    sql.query<{ equipment_id: string; hours: number | string }>(
      "select equipment_id,coalesce(sum(extract(epoch from (completed_at-started_at))/3600.0),0) as hours " +
      "from epr_operation_controls where equipment_id is not null and started_at is not null and completed_at is not null " +
      "group by equipment_id order by equipment_id",
    ),
  ]);

  const intelligence = buildAssetMaintenanceIntelligence({
    asOf: new Date().toISOString(),
    assets: assets.map((row) => ({
      id: String(row.id),
      assetTag: String(row.asset_tag),
      equipmentType: String(row.equipment_type),
      status: String(row.status) as "available" | "in_use" | "maintenance" | "quarantined" | "retired",
      criticality: row.criticality == null ? null : String(row.criticality) as "low" | "medium" | "high" | "critical",
      maintenanceDueAt: row.maintenance_due_at == null ? null : String(row.maintenance_due_at),
      calibrationRequired: Boolean(row.calibration_required),
      calibrationDueAt: row.calibration_due_at == null ? null : String(row.calibration_due_at),
    })),
    operatingHours: operatingRows.map((row) => ({ equipmentId: row.equipment_id, hours: Number(row.hours) })),
    workOrders: workOrders.map((row) => ({
      id: String(row.id),
      equipmentId: String(row.equipment_id),
      type: String(row.work_order_type) as "preventive" | "corrective" | "inspection" | "calibration",
      status: String(row.status) as "draft" | "scheduled" | "in_progress" | "completed" | "cancelled",
      startedAt: row.started_at == null ? null : String(row.started_at),
      completedAt: row.completed_at == null ? null : String(row.completed_at),
      downtimeStartedAt: row.downtime_started_at == null ? null : String(row.downtime_started_at),
      downtimeEndedAt: row.downtime_ended_at == null ? null : String(row.downtime_ended_at),
    })),
  });

  return { sql, assets: [...assets], plans: [...plans], workOrders: [...workOrders], parts: [...parts], intelligence };
}

export const getAssetMaintenanceState = createServerFn({ method: "GET" }).handler(async () => {
  await requireView();
  const loaded = await loadState();
  return {
    assets: loaded.assets,
    plans: loaded.plans,
    workOrders: loaded.workOrders,
    parts: loaded.parts,
    intelligence: loaded.intelligence,
  };
});

const dateTime = z.string().datetime().nullable().optional();

export const registerEquipmentAsset = createServerFn({ method: "POST" })
  .validator(z.object({
    assetTag: z.string().trim().min(1).max(120),
    equipmentType: z.string().trim().min(1).max(160),
    description: z.string().trim().max(500).default(""),
    manufacturer: z.string().trim().max(160).nullable().optional(),
    modelNumber: z.string().trim().max(160).nullable().optional(),
    serialNumber: z.string().trim().max(160).nullable().optional(),
    location: z.string().trim().max(200).nullable().optional(),
    criticality: z.enum(["low","medium","high","critical"]).default("medium"),
    ownerRef: z.string().trim().max(200).nullable().optional(),
    commissionedAt: dateTime,
    calibrationRequired: z.boolean().default(false),
    calibrationDueAt: dateTime,
    sourceReference: z.string().trim().min(1).max(800),
  }))
  .handler(async ({ data }) => {
    const actor = await requireBusinessActor("edit");
    if (data.calibrationRequired && !data.calibrationDueAt) {
      throw new Error("Calibration-required equipment must have a governed calibration due date.");
    }
    const sql = await getSql();
    const id = "ASSET-" + crypto.randomUUID();
    await sql.query(
      "insert into epr_equipment(id,asset_tag,equipment_type,description,status,calibration_required,calibration_due_at," +
      "manufacturer,model_number,serial_number,location,criticality,owner_ref,commissioned_at) " +
      "values($1,$2,$3,$4,'available',$5,$6,$7,$8,$9,$10,$11,$12,$13)",
      [
        id,data.assetTag,data.equipmentType,data.description,data.calibrationRequired,data.calibrationDueAt ?? null,
        data.manufacturer ?? null,data.modelNumber ?? null,data.serialNumber ?? null,data.location ?? null,
        data.criticality,data.ownerRef ?? null,data.commissionedAt ?? null,
      ],
    );
    await audit(sql,"asset",id,"ASSET_REGISTERED",actor.userId,actor.role,data.sourceReference,{
      assetTag:data.assetTag,equipmentType:data.equipmentType,criticality:data.criticality,calibrationRequired:data.calibrationRequired,
    });
    return { ok:true,id };
  });

export const createMaintenancePlan = createServerFn({ method: "POST" })
  .validator(z.object({
    equipmentId: z.string().min(1).max(160),
    title: z.string().trim().min(1).max(300),
    strategy: z.enum(["preventive","inspection","calibration","condition_based"]),
    intervalDays: z.number().int().positive().max(3650).nullable().optional(),
    nextDueAt: dateTime,
    instructions: z.string().trim().max(2000).default(""),
    sourceReference: z.string().trim().min(1).max(800),
  }))
  .handler(async ({ data }) => {
    const actor = await requireBusinessActor("edit");
    if (data.strategy !== "condition_based" && (!data.intervalDays || !data.nextDueAt)) {
      throw new Error("Scheduled maintenance plans require interval days and next due date.");
    }
    const sql = await getSql();
    const equipment = await sql.query<{ id:string }>("select id from epr_equipment where id=$1 and status<>'retired'",[data.equipmentId]);
    if (!equipment[0]) throw new Error("Active equipment not found.");
    const id = "MPLAN-" + crypto.randomUUID();
    await sql.query(
      "insert into vyndi_maintenance_plans(id,equipment_id,title,strategy,interval_days,next_due_at,instructions,source_reference,created_by,updated_by) " +
      "values($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)",
      [id,data.equipmentId,data.title,data.strategy,data.intervalDays ?? null,data.nextDueAt ?? null,data.instructions,data.sourceReference,actor.userId],
    );
    if (data.strategy === "calibration") {
      await sql.query("update epr_equipment set calibration_required=true where id=$1",[data.equipmentId]);
    }
    await refreshEquipmentDueState(sql,data.equipmentId);
    await refreshEquipmentReleaseState(sql,data.equipmentId);
    await audit(sql,"maintenance_plan",id,"MAINTENANCE_PLAN_CREATED",actor.userId,actor.role,data.sourceReference,{
      equipmentId:data.equipmentId,strategy:data.strategy,intervalDays:data.intervalDays ?? null,nextDueAt:data.nextDueAt ?? null,
    });
    return { ok:true,id };
  });

export const createMaintenanceWorkOrder = createServerFn({ method: "POST" })
  .validator(z.object({
    equipmentId: z.string().min(1).max(160),
    planId: z.string().max(160).nullable().optional(),
    type: z.enum(["preventive","corrective","inspection","calibration"]),
    priority: z.enum(["low","normal","high","critical"]).default("normal"),
    title: z.string().trim().min(1).max(300),
    description: z.string().trim().max(2000).default(""),
    failureCode: z.string().trim().max(120).nullable().optional(),
    failureMode: z.string().trim().max(500).nullable().optional(),
    scheduledFor: dateTime,
    sourceReference: z.string().trim().min(1).max(800),
  }))
  .handler(async ({ data }) => {
    const actor = await requireBusinessActor("edit");
    const sql = await getSql();
    const equipment = await sql.query<{ id:string;status:string }>("select id,status from epr_equipment where id=$1 and status<>'retired'",[data.equipmentId]);
    if (!equipment[0]) throw new Error("Active equipment not found.");
    if (data.planId) {
      const plan=await sql.query<{ id:string }>("select id from vyndi_maintenance_plans where id=$1 and equipment_id=$2 and active=true",[data.planId,data.equipmentId]);
      if(!plan[0]) throw new Error("Maintenance plan does not belong to this equipment or is inactive.");
    }
    if (data.type === "corrective" && !data.failureMode) throw new Error("Corrective maintenance requires a recorded failure mode.");
    const id = "MWO-" + crypto.randomUUID();
    await sql.query(
      "insert into vyndi_maintenance_work_orders(id,equipment_id,plan_id,work_order_type,priority,status,title,description,failure_code,failure_mode,scheduled_for,created_by,source_reference) " +
      "values($1,$2,$3,$4,$5,'scheduled',$6,$7,$8,$9,$10,$11,$12)",
      [id,data.equipmentId,data.planId ?? null,data.type,data.priority,data.title,data.description,data.failureCode ?? null,data.failureMode ?? null,data.scheduledFor ?? null,actor.userId,data.sourceReference],
    );
    if (data.type === "corrective") {
      await sql.query("update epr_equipment set status='quarantined' where id=$1 and status<>'retired'",[data.equipmentId]);
    }
    await audit(sql,"maintenance_work_order",id,"MAINTENANCE_WORK_ORDER_CREATED",actor.userId,actor.role,data.sourceReference,{
      equipmentId:data.equipmentId,type:data.type,priority:data.priority,planId:data.planId ?? null,
    });
    return { ok:true,id };
  });

export const cancelMaintenanceWorkOrder = createServerFn({ method: "POST" })
  .validator(z.object({
    workOrderId:z.string().min(1).max(160),
    reason:z.string().trim().min(3).max(1000),
    sourceReference:z.string().trim().min(1).max(800),
  }))
  .handler(async ({ data }) => {
    const actor=await requireBusinessActor("edit");
    const sql=await getSql();
    const rows=await sql.query<{equipment_id:string;status:string}>(
      "select equipment_id,status from vyndi_maintenance_work_orders where id=$1 limit 1",[data.workOrderId]
    );
    const row=rows[0];
    if(!row) throw new Error("Maintenance work order not found.");
    if(!["draft","scheduled"].includes(row.status)) throw new Error("Only draft or scheduled maintenance work may be cancelled.");
    await sql.query(
      "update vyndi_maintenance_work_orders set status='cancelled',record_revision=record_revision+1,updated_at=now() where id=$1",
      [data.workOrderId],
    );
    const releaseStatus=await refreshEquipmentReleaseState(sql,row.equipment_id);
    await audit(sql,"maintenance_work_order",data.workOrderId,"MAINTENANCE_WORK_ORDER_CANCELLED",actor.userId,actor.role,data.sourceReference,{
      equipmentId:row.equipment_id,reason:data.reason,releaseStatus,
    });
    return {ok:true,status:"cancelled" as const,releaseStatus};
  });

export const startMaintenanceWorkOrder = createServerFn({ method: "POST" })
  .validator(z.object({
    workOrderId:z.string().min(1).max(160),
    sourceReference:z.string().trim().min(1).max(800),
  }))
  .handler(async ({ data }) => {
    const actor=await requireBusinessActor("edit");
    const sql=await getSql();
    const rows=await sql.query<{equipment_id:string;status:string}>(
      "select equipment_id,status from vyndi_maintenance_work_orders where id=$1 limit 1",[data.workOrderId]
    );
    const row=rows[0];
    if(!row) throw new Error("Maintenance work order not found.");
    if(!["draft","scheduled"].includes(row.status)) throw new Error("Only draft or scheduled maintenance work may be started.");
    const openOperations=await sql.query<{count:string}>(
      "select count(*)::text as count from epr_operation_controls where equipment_id=$1 and status='open'",
      [row.equipment_id],
    );
    if(Number(openOperations[0]?.count??0)>0) {
      throw new Error("Equipment still belongs to an open controlled production operation. Complete or block that operation before maintenance starts.");
    }
    await sql.query(
      "update vyndi_maintenance_work_orders set status='in_progress',started_at=now(),downtime_started_at=coalesce(downtime_started_at,now()),record_revision=record_revision+1,updated_at=now() where id=$1",
      [data.workOrderId],
    );
    await sql.query("update epr_equipment set status='maintenance' where id=$1 and status<>'retired'",[row.equipment_id]);
    await audit(sql,"maintenance_work_order",data.workOrderId,"MAINTENANCE_WORK_ORDER_STARTED",actor.userId,actor.role,data.sourceReference,{equipmentId:row.equipment_id});
    return {ok:true,status:"in_progress" as const};
  });

const partSchema=z.object({
  sku:z.string().trim().min(1).max(160),
  quantity:z.number().positive(),
  unitCostInr:z.number().min(0),
  sourceReference:z.string().trim().min(1).max(800),
});

export const completeMaintenanceWorkOrder = createServerFn({ method: "POST" })
  .validator(z.object({
    workOrderId:z.string().min(1).max(160),
    rootCause:z.string().trim().max(1000).nullable().optional(),
    actionTaken:z.string().trim().min(1).max(2000),
    labourHours:z.number().min(0).nullable().optional(),
    externalCostInr:z.number().min(0).default(0),
    evidenceReference:z.string().trim().min(1).max(800),
    returnToServiceReference:z.string().trim().min(1).max(800),
    parts:z.array(partSchema).max(100).default([]),
    sourceReference:z.string().trim().min(1).max(800),
  }))
  .handler(async ({ data }) => {
    const actor=await requireBusinessActor("approve");
    const sql=await getSql();
    const rows=await sql.query<{equipment_id:string;plan_id:string|null;work_order_type:string;status:string}>(
      "select equipment_id,plan_id,work_order_type,status from vyndi_maintenance_work_orders where id=$1 limit 1",[data.workOrderId]
    );
    const row=rows[0];
    if(!row) throw new Error("Maintenance work order not found.");
    if(row.status!=="in_progress") throw new Error("Only in-progress maintenance work may be completed.");
    if(row.work_order_type==="corrective"&&!data.rootCause) throw new Error("Corrective maintenance completion requires root-cause evidence.");

    const partsCost=data.parts.reduce((sum,part)=>sum+part.quantity*part.unitCostInr,0);
    await sql.query(
      "update vyndi_maintenance_work_orders set status='completed',root_cause=$1,action_taken=$2,completed_at=now(),downtime_ended_at=coalesce(downtime_ended_at,now())," +
      "labour_hours=$3,parts_cost_inr=$4,external_cost_inr=$5,evidence_reference=$6,return_to_service_reference=$7,completed_by=$8,record_revision=record_revision+1,updated_at=now() where id=$9",
      [data.rootCause ?? null,data.actionTaken,data.labourHours ?? null,partsCost,data.externalCostInr,data.evidenceReference,data.returnToServiceReference,actor.userId,data.workOrderId],
    );
    for(const part of data.parts){
      await sql.query(
        "insert into vyndi_maintenance_parts(id,work_order_id,sku,quantity,unit_cost_inr,source_reference,recorded_by) values($1,$2,$3,$4,$5,$6,$7)",
        [crypto.randomUUID(),data.workOrderId,part.sku,part.quantity,part.unitCostInr,part.sourceReference,actor.userId],
      );
    }

    if(row.plan_id){
      const plans=await sql.query<{strategy:string;interval_days:number|null}>(
        "select strategy,interval_days from vyndi_maintenance_plans where id=$1 and equipment_id=$2 and active=true limit 1",
        [row.plan_id,row.equipment_id],
      );
      const plan=plans[0];
      if(plan?.interval_days){
        await sql.query(
          "update vyndi_maintenance_plans set next_due_at=now()+($1::text||' days')::interval,record_revision=record_revision+1,updated_by=$2,updated_at=now() where id=$3",
          [plan.interval_days,actor.userId,row.plan_id],
        );
      }
      if(plan?.strategy==="calibration"){
        await sql.query("update epr_equipment set last_calibrated_at=now() where id=$1",[row.equipment_id]);
      } else {
        await sql.query("update epr_equipment set last_maintained_at=now() where id=$1",[row.equipment_id]);
      }
    } else if(row.work_order_type==="calibration"){
      await sql.query("update epr_equipment set last_calibrated_at=now() where id=$1",[row.equipment_id]);
    } else {
      await sql.query("update epr_equipment set last_maintained_at=now() where id=$1",[row.equipment_id]);
    }

    const releaseStatus=await refreshEquipmentReleaseState(sql,row.equipment_id);
    await sql.query(
      "update vyndi_maintenance_work_orders set returned_to_service_by=case when $1='available' then $2 else null end where id=$3",
      [releaseStatus,actor.userId,data.workOrderId],
    );

    await audit(sql,"maintenance_work_order",data.workOrderId,"MAINTENANCE_WORK_ORDER_COMPLETED",actor.userId,actor.role,data.sourceReference,{
      equipmentId:row.equipment_id,rootCause:data.rootCause ?? null,partsCostInr:partsCost,releaseStatus,
    });
    if(releaseStatus==="available"){
      await audit(sql,"asset",row.equipment_id,"RETURN_TO_SERVICE",actor.userId,actor.role,data.returnToServiceReference,{
        workOrderId:data.workOrderId,evidenceReference:data.evidenceReference,
      });
    }
    return {ok:true,status:"completed" as const,releaseStatus,returnedToService:releaseStatus==="available"};
  });
