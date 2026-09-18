import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "@/lib/auth/middleware";
import { getAssignedCommandRole } from "@/lib/command-user-role.server";
import { getSql } from "@/lib/db";
import { runtimeSourceSha } from "@/lib/observability/server";

const reference = z.string().trim().min(3).max(500);
const requestId = z.string().trim().min(3).max(160);
const entityType = z.enum(["sales_order","monthly_actual"]);
const sourceKind = z.enum(["revision_history","external_backup"]);
const checkpointType = z.enum(["neon_history","neon_branch","pg_dump","managed_snapshot"]);

async function requireAdmin(userId:string,email?:string|null) {
  const role=await getAssignedCommandRole(userId,email);
  if(role!=="admin") throw new Error("Admin access is required.");
  return { userId,role } as const;
}

export type RecoveryCheckpointRow = {
  id:string;
  checkpoint_type:string;
  captured_at:string;
  source_sha:string;
  source_reference:string;
  storage_reference:string;
  checksum:string;
  size_bytes:number|null;
  notes:string;
  recorded_by:string;
  created_at:string;
};

export type RecoveryRequestRow = {
  id:string;
  mode:string;
  source_kind:string;
  checkpoint_id:string|null;
  entity_type:string|null;
  entity_id:string|null;
  source_revision:number|null;
  impact_preview_json:string;
  reason:string;
  evidence_reference:string;
  status:string;
  requested_by:string;
  requested_at:string;
  decided_by:string|null;
  decided_at:string|null;
  decision_note:string|null;
  validated_by:string|null;
  validated_at:string|null;
  executed_by:string|null;
  executed_at:string|null;
  result_revision:number|null;
  cutover_reference:string|null;
};

export type RecoveryEventRow = {
  id:string;
  request_id:string|null;
  checkpoint_id:string|null;
  event_type:string;
  actor_user_id:string;
  actor_role:string;
  evidence_reference:string;
  payload_json:string;
  created_at:string;
};

export type RecoverySupportRow = {
  entityType:string;
  label:string;
  mode:"executable"|"compare_only";
  canonicalRoute:string;
  authorityNote:string;
};

export type RecoveryCentreWorkspace = {
  checkpoints:RecoveryCheckpointRow[];
  requests:RecoveryRequestRow[];
  events:RecoveryEventRow[];
  summary:{
    latest_checkpoint_at:string|null;
    checkpoint_count:number;
    pending_requests:number;
    cutover_ready_requests:number;
    executed_requests:number;
  };
  runtime:{
    sourceSha:string;
    databaseHealth:"ok";
  };
  backupStatus:{
    externalBackupState:"registered"|"missing";
    latestExternalBackupAt:string|null;
    latestExternalBackupId:string|null;
  };
  me:{id:string};
  policy:{
    rpoHours:number;
    rtoMinutes:number;
    productionOverwriteAllowed:false;
    selectiveRecoveryEntities:string[];
    selectiveRecoverySupport:RecoverySupportRow[];
    externalBackupsRequired:true;
  };
};

const selectiveRecoverySupport:RecoverySupportRow[]=[
  {
    entityType:"sales_order",
    label:"Sales Order",
    mode:"executable",
    canonicalRoute:"/command/sales",
    authorityNote:"Revisioned recovery replays through save_vyndi_sales_order and creates a new canonical revision.",
  },
  {
    entityType:"monthly_actual",
    label:"Monthly Actual",
    mode:"executable",
    canonicalRoute:"/command/actuals",
    authorityNote:"Management-controlled fields replay through save_vyndi_monthly_actual; transaction-derived revenue, units and receivables remain canonical.",
  },
  {
    entityType:"purchase_order",
    label:"Purchase Order",
    mode:"compare_only",
    canonicalRoute:"/command/purchase-execution",
    authorityNote:"Use Procurement owning amendment/cancellation authority; generic row replacement is prohibited.",
  },
  {
    entityType:"grn_receipt",
    label:"GRN / Receipt",
    mode:"compare_only",
    canonicalRoute:"/command/receiving",
    authorityNote:"Use Receiving correction/reversal authority so inventory and inspection lineage remain intact.",
  },
  {
    entityType:"production_job_card",
    label:"Production Job Card",
    mode:"compare_only",
    canonicalRoute:"/command/production",
    authorityNote:"Use Production supersession/correction authority; genealogy and issued-material lineage must not be rewritten.",
  },
  {
    entityType:"inventory_identity",
    label:"Inventory lot / serial / identity",
    mode:"compare_only",
    canonicalRoute:"/command/inventory",
    authorityNote:"Use Inventory movement, stocktake, return or controlled adjustment authority so FIFO and identity history remain intact.",
  },
  {
    entityType:"invoice",
    label:"Customer Invoice",
    mode:"compare_only",
    canonicalRoute:"/command/sales-ledger",
    authorityNote:"Use credit/debit/reversal authority; invoice and receivable history is not generically overwritten.",
  },
  {
    entityType:"supplier_payment",
    label:"Supplier Payment",
    mode:"compare_only",
    canonicalRoute:"/command/payables",
    authorityNote:"Use Payables/payment reconciliation authority so canonical cash and finance evidence remain consistent.",
  },
  {
    entityType:"quality_record",
    label:"Quality Record",
    mode:"compare_only",
    canonicalRoute:"/command/quality",
    authorityNote:"Use Quality disposition/retest/correction authority; inspection genealogy and release evidence remain append-only.",
  },
];

async function readWorkspace(sql:Awaited<ReturnType<typeof getSql>>) {
  const [checkpoints,requests,events,summary]=await Promise.all([
    sql.query<RecoveryCheckpointRow>(
      `select id,checkpoint_type,captured_at::text,source_sha,source_reference,storage_reference,
              checksum,size_bytes,notes,recorded_by,created_at::text
         from vyndi_recovery_checkpoints
        order by captured_at desc,created_at desc limit 100`,
    ),
    sql.query<RecoveryRequestRow>(
      `select id,mode,source_kind,checkpoint_id,entity_type,entity_id,source_revision,
              impact_preview::text as impact_preview_json,reason,evidence_reference,status,requested_by,requested_at::text,
              decided_by,decided_at::text,decision_note,validated_by,validated_at::text,
              executed_by,executed_at::text,result_revision,cutover_reference
         from vyndi_recovery_requests
        order by requested_at desc limit 100`,
    ),
    sql.query<RecoveryEventRow>(
      `select id,request_id,checkpoint_id,event_type,actor_user_id,actor_role,evidence_reference,
              payload_json::text as payload_json,created_at::text
         from vyndi_recovery_events
        order by created_at desc limit 150`,
    ),
    sql.query<{
      latest_checkpoint_at:string|null;
      checkpoint_count:number;
      pending_requests:number;
      cutover_ready_requests:number;
      executed_requests:number;
    }>(
      `select latest_checkpoint_at::text,checkpoint_count::int,pending_requests::int,
              cutover_ready_requests::int,executed_requests::int
         from vyndi_recovery_control_summary`,
    ),
  ]);
  return {
    checkpoints,
    requests,
    events,
    summary:summary[0] ?? {
      latest_checkpoint_at:null,
      checkpoint_count:0,
      pending_requests:0,
      cutover_ready_requests:0,
      executed_requests:0,
    },
  };
}

export const getVindyRecoveryCentre = createServerFn({method:"GET"})
  .middleware([authMiddleware])
  .handler(async({context})=>{
    const actor=await requireAdmin(context.userId,context.userEmail);
    const sql=await getSql();
    const workspace=await readWorkspace(sql);
    const sourceSha=await runtimeSourceSha();
    const latestExternal=workspace.checkpoints.find(row=>row.checkpoint_type==="pg_dump") ?? null;
    return {
      ...workspace,
      runtime:{sourceSha,databaseHealth:"ok" as const},
      backupStatus:{
        externalBackupState:latestExternal ? "registered" as const : "missing" as const,
        latestExternalBackupAt:latestExternal?.captured_at ?? null,
        latestExternalBackupId:latestExternal?.id ?? null,
      },
      me:{id:actor.userId},
      policy:{
        rpoHours:24,
        rtoMinutes:60,
        productionOverwriteAllowed:false as const,
        selectiveRecoveryEntities:["sales_order","monthly_actual"],
        selectiveRecoverySupport,
        externalBackupsRequired:true as const,
      },
    } satisfies RecoveryCentreWorkspace;
  });

export const previewVindySelectiveRecovery = createServerFn({method:"POST"})
  .validator(z.object({
    entityType,
    entityId:z.string().trim().min(1).max(160),
    sourceKind,
    sourceRevision:z.number().int().positive().nullable().optional(),
    recoverySnapshotJson:z.string().trim().max(20000).nullable().optional(),
  }))
  .middleware([authMiddleware])
  .handler(async({data,context})=>{
    await requireAdmin(context.userId,context.userEmail);
    const sql=await getSql();
    const currentRows=await sql.query<{snapshot:unknown}>(
      `select vyndi_recovery_current_snapshot($1,$2) as snapshot`,
      [data.entityType,data.entityId],
    );
    let recovery:unknown=null;
    if(data.sourceKind==="external_backup" && data.recoverySnapshotJson){
      try{
        recovery=JSON.parse(data.recoverySnapshotJson);
      }catch{
        throw new Error("Recovered snapshot JSON is invalid.");
      }
      if(!recovery||typeof recovery!=="object"||Array.isArray(recovery)){
        throw new Error("Recovered snapshot must be a JSON object.");
      }
    }
    if(data.sourceKind==="revision_history") {
      if(!data.sourceRevision) throw new Error("Source revision is required.");
      const rows=await sql.query<{snapshot:unknown}>(
        `select vyndi_recovery_revision_snapshot($1,$2,$3) as snapshot`,
        [data.entityType,data.entityId,data.sourceRevision],
      );
      recovery=rows[0]?.snapshot ?? null;
    }
    if(!recovery) throw new Error("Recovery snapshot is required.");
    return {
      currentJson:JSON.stringify(currentRows[0]?.snapshot ?? null),
      recoveryJson:JSON.stringify(recovery),
      destructiveOverwrite:false,
      willCreateNewRevision:true,
      canonicalWriter:data.entityType==="sales_order" ? "save_vyndi_sales_order" : "save_vyndi_monthly_actual",
    };
  });

export const registerVindyRecoveryCheckpoint = createServerFn({method:"POST"})
  .validator(z.object({
    id:requestId,
    checkpointType,
    capturedAt:z.string().datetime(),
    sourceSha:z.string().trim().max(80).optional(),
    sourceReference:reference,
    storageReference:z.string().trim().max(500).optional(),
    checksum:z.string().trim().max(256).optional(),
    sizeBytes:z.number().int().nonnegative().nullable().optional(),
    notes:z.string().trim().max(1000).optional(),
  }))
  .middleware([authMiddleware])
  .handler(async({data,context})=>{
    const actor=await requireAdmin(context.userId,context.userEmail);
    const sql=await getSql();
    const rows=await sql.query<{id:string}>(
      `select register_vyndi_recovery_checkpoint($1,$2,$3::timestamptz,$4,$5,$6,$7,$8,$9,$10,$11) as id`,
      [data.id,data.checkpointType,data.capturedAt,data.sourceSha ?? "",data.sourceReference,
       data.storageReference ?? "",data.checksum ?? "",data.sizeBytes ?? null,data.notes ?? "",
       actor.userId,actor.role],
    );
    return {ok:true,id:rows[0]?.id ?? data.id.toUpperCase()};
  });

export const requestVindySelectiveRecovery = createServerFn({method:"POST"})
  .validator(z.object({
    id:requestId,
    entityType,
    entityId:z.string().trim().min(1).max(160),
    sourceKind,
    sourceRevision:z.number().int().positive().nullable().optional(),
    recoverySnapshotJson:z.string().trim().max(20000).nullable().optional(),
    checkpointId:z.string().trim().max(160).nullable().optional(),
    reason:z.string().trim().min(8).max(1000),
    evidenceReference:reference,
  }))
  .middleware([authMiddleware])
  .handler(async({data,context})=>{
    const actor=await requireAdmin(context.userId,context.userEmail);
    const sql=await getSql();
    let recoverySnapshotJson:string|null=null;
    if(data.sourceKind==="external_backup"){
      if(!data.recoverySnapshotJson) throw new Error("Recovered snapshot JSON is required.");
      try{
        const parsed=JSON.parse(data.recoverySnapshotJson);
        if(!parsed||typeof parsed!=="object"||Array.isArray(parsed)) throw new Error();
        recoverySnapshotJson=JSON.stringify(parsed);
      }catch{
        throw new Error("Recovered snapshot must be a valid JSON object.");
      }
    }
    const rows=await sql.query<{id:string}>(
      `select request_vyndi_selective_recovery($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11) as id`,
      [data.id,data.entityType,data.entityId,data.sourceKind,data.sourceRevision ?? null,
       recoverySnapshotJson,
       data.checkpointId ?? null,data.reason,data.evidenceReference,actor.userId,actor.role],
    );
    return {ok:true,id:rows[0]?.id ?? data.id.toUpperCase()};
  });

export const requestVindyFullRestore = createServerFn({method:"POST"})
  .validator(z.object({
    id:requestId,
    checkpointId:z.string().trim().min(1).max(160),
    reason:z.string().trim().min(8).max(1000),
    evidenceReference:reference,
  }))
  .middleware([authMiddleware])
  .handler(async({data,context})=>{
    const actor=await requireAdmin(context.userId,context.userEmail);
    const sql=await getSql();
    const rows=await sql.query<{id:string}>(
      `select request_vyndi_full_restore($1,$2,$3,$4,$5,$6) as id`,
      [data.id,data.checkpointId,data.reason,data.evidenceReference,actor.userId,actor.role],
    );
    return {ok:true,id:rows[0]?.id ?? data.id.toUpperCase()};
  });

async function decide(input:{requestId:string;decision:"approve"|"reject";note:string},actor:{userId:string;role:"admin"}) {
  const sql=await getSql();
  const rows=await sql.query<{status:string}>(
    `select decide_vyndi_recovery_request($1,$2,$3,$4,$5) as status`,
    [input.requestId,input.decision,input.note,actor.userId,actor.role],
  );
  return {ok:true,status:rows[0]?.status ?? input.decision};
}

export const approveVindyRecoveryRequest = createServerFn({method:"POST"})
  .validator(z.object({requestId, note:z.string().trim().max(1000).optional()}))
  .middleware([authMiddleware])
  .handler(async({data,context})=>{
    const actor=await requireAdmin(context.userId,context.userEmail);
    return decide({requestId:data.requestId,decision:"approve",note:data.note ?? ""},actor);
  });

export const rejectVindyRecoveryRequest = createServerFn({method:"POST"})
  .validator(z.object({requestId, note:z.string().trim().min(3).max(1000)}))
  .middleware([authMiddleware])
  .handler(async({data,context})=>{
    const actor=await requireAdmin(context.userId,context.userEmail);
    return decide({requestId:data.requestId,decision:"reject",note:data.note},actor);
  });

export const executeVindySelectiveRecovery = createServerFn({method:"POST"})
  .validator(z.object({requestId, executionReference:reference}))
  .middleware([authMiddleware])
  .handler(async({data,context})=>{
    const actor=await requireAdmin(context.userId,context.userEmail);
    const sql=await getSql();
    const rows=await sql.query<{entity_type:string;entity_id:string;new_revision:number}>(
      `select * from execute_vyndi_selective_recovery($1,$2,$3,$4)`,
      [data.requestId,data.executionReference,actor.userId,actor.role],
    );
    return {ok:true,entityType:rows[0]?.entity_type,entityId:rows[0]?.entity_id,newRevision:Number(rows[0]?.new_revision ?? 0)};
  });

export const validateVindyFullRestore = createServerFn({method:"POST"})
  .validator(z.object({
    requestId,
    evidenceReference:reference,
    hashMatch:z.boolean(),
    databaseHealth:z.boolean(),
    goldenOrder:z.boolean(),
    authenticatedSmoke:z.boolean(),
    restoredSourceSha:z.string().trim().min(7).max(80),
    restoredTargetReference:z.string().trim().min(3).max(500),
  }))
  .middleware([authMiddleware])
  .handler(async({data,context})=>{
    const actor=await requireAdmin(context.userId,context.userEmail);
    const sql=await getSql();
    const evidence={
      hashMatch:data.hashMatch,
      databaseHealth:data.databaseHealth,
      goldenOrder:data.goldenOrder,
      authenticatedSmoke:data.authenticatedSmoke,
      restoredSourceSha:data.restoredSourceSha,
      restoredTargetReference:data.restoredTargetReference,
    };
    const rows=await sql.query<{status:string}>(
      `select validate_vyndi_full_restore($1,$2::jsonb,$3,$4,$5) as status`,
      [data.requestId,JSON.stringify(evidence),data.evidenceReference,actor.userId,actor.role],
    );
    return {ok:true,status:rows[0]?.status ?? "cutover_ready"};
  });

export const recordVindyFullRestoreCutover = createServerFn({method:"POST"})
  .validator(z.object({requestId,cutoverReference:reference}))
  .middleware([authMiddleware])
  .handler(async({data,context})=>{
    const actor=await requireAdmin(context.userId,context.userEmail);
    const sql=await getSql();
    const rows=await sql.query<{status:string}>(
      `select record_vyndi_full_restore_cutover($1,$2,$3,$4) as status`,
      [data.requestId,data.cutoverReference,actor.userId,actor.role],
    );
    return {ok:true,status:rows[0]?.status ?? "executed"};
  });
