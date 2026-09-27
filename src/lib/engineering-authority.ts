import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getSql } from "@/lib/db";
import { getCommandRole } from "@/lib/command-access";
import { canPerform, type CommandPermission } from "@/lib/page-access";
import { CURRENT_VEDM_AUTHORITY } from "@/lib/engineering-current-authority";
import { compileVedmAuthorityGraph, createVedmR3aSeed } from "@/lib/vedm-authority-graph";

const familySchema = z.enum(["longitude", "latitude", "altitude"]);
const baselineStatusSchema = z.enum(["draft", "pending_approval", "released", "superseded"]);
const ecrStatusSchema = z.enum(["open", "pending_approval", "approved", "implemented", "rejected"]);

async function assertSameSiteRequest() {
  const { getRequest } = await import("@tanstack/react-start/server");
  const request = getRequest();
  if (!request) return;
  const site = request.headers.get("sec-fetch-site");
  if (!site || site === "same-origin" || site === "none") return;
  const isTopLevelGet = request.headers.get("sec-fetch-mode") === "navigate" && request.method === "GET";
  if (!isTopLevelGet) throw new Error("Forbidden: cross-site request blocked");
}

async function requirePermission(permission: CommandPermission) {
  const role = await getCommandRole();
  if (!role || !canPerform(role, permission)) throw new Error(`Engineering ${permission} permission denied.`);
  return role;
}

function actor(role: string) {
  return `command:${role}`;
}

async function assertVariantBelongsToFamily(
  sql: Awaited<ReturnType<typeof getSql>>,
  familyCode: string,
  variantId?: string | null,
) {
  if (!variantId) return;
  const rows = await sql<{ id: string }>`
    select variant_id as id
    from vyndi_product_variants
    where variant_id=${variantId} and family_code=${familyCode} and active=true
    limit 1
  `;
  if (!rows[0]) throw new Error("Selected variant does not belong to the selected canonical product family.");
}

export const listEngineeringAuthority = createServerFn({ method: "GET" }).handler(async () => {
  await assertSameSiteRequest();
  await requirePermission("view");
  const sql = await getSql();
  const [baselines, changes, evidenceReceipts, workflows, releaseDecisions, threadSnapshots] = await Promise.all([
    sql`
      select b.*, f.display_name as family_name, v.display_name as variant_name
      from vyndi_engineering_baselines b
      join vyndi_product_families f on f.family_code=b.family_code
      left join vyndi_product_variants v on v.variant_id=b.variant_id
      order by b.family_code, b.updated_at desc
    `,
    sql`
      select e.*, f.display_name as family_name, v.display_name as variant_name
      from vyndi_engineering_change_requests e
      join vyndi_product_families f on f.family_code=e.family_code
      left join vyndi_product_variants v on v.variant_id=e.variant_id
      order by e.updated_at desc
    `,
    sql`
      select id,fingerprint,schema_id,configuration_id,revision,readiness_status,
             release_authority,authority_node_id,authority_source_commit,
             actor_user_id,actor_role,source_origin,received_at
      from vyndi_engineering_evidence_receipts
      order by received_at desc
      limit 25
    `,
    sql`
      select id,subject_id,state,criticality,blocker_ids,supersedes_id,successor_id,
             source_ref,created_by,created_role,record_revision,created_at,updated_at
      from vyndi_engineering_workflows
      order by updated_at desc
      limit 50
    `,
    sql`
      select id,workflow_id,subject_id,release_fingerprint,source_repository,source_commit,
             as_of_date,controlling_authority_id,releasable,blocker_ids,
             accepted_evidence_fingerprints,actor_user_id,actor_role,decision,source_ref,created_at
      from vyndi_engineering_release_decisions
      order by created_at desc
      limit 50
    `,
    sql`
      select id,subject_id,source_repository,source_commit,node_count,edge_count,gap_count,
             actor_user_id,actor_role,source_ref,created_at
      from vyndi_engineering_thread_snapshots
      order by created_at desc
      limit 25
    `,
  ]);
  const vedmGraph = compileVedmAuthorityGraph(
    createVedmR3aSeed(),
    new Date().toISOString().slice(0, 10),
  );
  return {
    vedmAuthority: CURRENT_VEDM_AUTHORITY,
    vedmAuthorityGraph: {
      schema: vedmGraph.schema,
      sourceRepository: vedmGraph.sourceRepository,
      sourceCommit: vedmGraph.sourceCommit,
      asOfDate: vedmGraph.asOfDate,
      valid: vedmGraph.valid,
      releaseReady: vedmGraph.releaseReady,
      authorityByDomain: Object.fromEntries(
        Object.entries(vedmGraph.authorityByDomain).filter(([, node]) => Boolean(node)),
      ),
      blockingGateIds: vedmGraph.blockingGateIds,
      issues: vedmGraph.issues,
      mutationAuthority: "HUMAN_APPROVAL_REQUIRED",
    },
    baselines: Array.isArray(baselines) ? [...baselines] : [],
    changes: Array.isArray(changes) ? [...changes] : [],
    evidenceReceipts: Array.isArray(evidenceReceipts) ? [...evidenceReceipts] : [],
    r3Governance: {
      workflows: Array.isArray(workflows) ? [...workflows] : [],
      releaseDecisions: Array.isArray(releaseDecisions) ? [...releaseDecisions] : [],
      threadSnapshots: Array.isArray(threadSnapshots) ? [...threadSnapshots] : [],
    },
  };
});

const baselineDraftSchema = z.object({
  familyCode: familySchema,
  variantId: z.string().min(1).max(100).nullable().optional(),
  revisionCode: z.string().min(1).max(40),
  geometryRef: z.string().min(1).max(500),
  materialSpec: z.string().min(1).max(500),
  layupRef: z.string().max(500).nullable().optional(),
  alloySpec: z.string().max(500).nullable().optional(),
  toolingRef: z.string().max(500).nullable().optional(),
  drawingRef: z.string().min(1).max(500),
  bomRevision: z.string().max(100).nullable().optional(),
  sourceReference: z.string().min(1).max(500),
});

export const createEngineeringBaselineDraft = createServerFn({ method: "POST" })
  .validator(baselineDraftSchema)
  .handler(async ({ data }) => {
    await assertSameSiteRequest();
    const role = await requirePermission("edit");
    const sql = await getSql();
    await assertVariantBelongsToFamily(sql, data.familyCode, data.variantId);
    const id = `ENG-${crypto.randomUUID()}`;
    await sql`
      insert into vyndi_engineering_baselines (
        id,family_code,variant_id,revision_code,status,geometry_ref,material_spec,
        layup_ref,alloy_spec,tooling_ref,drawing_ref,bom_revision,source_ref,created_by
      ) values (
        ${id},${data.familyCode},${data.variantId ?? null},${data.revisionCode},'draft',
        ${data.geometryRef},${data.materialSpec},${data.layupRef ?? null},${data.alloySpec ?? null},
        ${data.toolingRef ?? null},${data.drawingRef},${data.bomRevision ?? null},
        ${data.sourceReference},${actor(role)}
      )
    `;
    await sql`
      insert into vyndi_audit_events (
        id,entity_type,entity_id,entity_revision,action,actor_user_id,actor_role,
        source_reference,payload_json,correlation_id,previous_state,new_state,reason
      ) values (
        ${crypto.randomUUID()},'engineering_baseline',${id},1,'ENGINEERING_BASELINE_DRAFT_CREATED',
        ${actor(role)},${role},${data.sourceReference},
        ${JSON.stringify({
          familyCode: data.familyCode,
          variantId: data.variantId ?? null,
          revisionCode: data.revisionCode,
          drawingRef: data.drawingRef,
          bomRevision: data.bomRevision ?? null,
        })}::jsonb,
        ${`ENGINEERING|${data.familyCode}|${data.revisionCode}`},null,'draft','Engineering baseline draft created.'
      )
    `;
    return { ok: true, id, status: "draft" as const };
  });

const baselineTransitionSchema = z.object({
  id: z.string().min(1).max(120),
  toStatus: baselineStatusSchema,
  sourceReference: z.string().min(1).max(500),
  note: z.string().max(1000).optional(),
});

export const transitionEngineeringBaseline = createServerFn({ method: "POST" })
  .validator(baselineTransitionSchema)
  .handler(async ({ data }) => {
    await assertSameSiteRequest();
    const permission: CommandPermission =
      data.toStatus === "released" || data.toStatus === "superseded" ? "approve" : "edit";
    const role = await requirePermission(permission);
    const sql = await getSql();
    const rows = await sql<{
      status: string;
      recordRevision: number;
      familyCode: string;
      revisionCode: string;
    }>`
      select
        status,
        record_revision as "recordRevision",
        family_code as "familyCode",
        revision_code as "revisionCode"
      from vyndi_engineering_baselines
      where id=${data.id}
      limit 1
    `;
    const current = rows[0];
    if (!current) throw new Error("Engineering baseline not found.");
    const allowed =
      (current.status === "draft" && data.toStatus === "pending_approval") ||
      (current.status === "pending_approval" &&
        (data.toStatus === "draft" || data.toStatus === "released")) ||
      (current.status === "released" && data.toStatus === "superseded");
    if (!allowed) {
      throw new Error(`Invalid Engineering baseline transition: ${current.status} → ${data.toStatus}`);
    }
    const nextRevision = current.recordRevision + 1;
    await sql`
      update vyndi_engineering_baselines set
        status=${data.toStatus},
        record_revision=${nextRevision},
        approved_by=case when ${data.toStatus}='released' then ${actor(role)} else approved_by end,
        released_at=case when ${data.toStatus}='released' then now() else released_at end,
        updated_at=now()
      where id=${data.id}
    `;
    await sql`
      insert into vyndi_audit_events (
        id,entity_type,entity_id,entity_revision,action,actor_user_id,actor_role,
        source_reference,payload_json,correlation_id,previous_state,new_state,reason
      ) values (
        ${crypto.randomUUID()},'engineering_baseline',${data.id},${nextRevision},
        'ENGINEERING_BASELINE_STATUS_CHANGED',${actor(role)},${role},${data.sourceReference},
        '{}'::jsonb,${`ENGINEERING|${current.familyCode}|${current.revisionCode}`},
        ${current.status},${data.toStatus},${data.note ?? null}
      )
    `;
    return {
      ok: true,
      fromStatus: current.status,
      toStatus: data.toStatus,
      recordRevision: nextRevision,
    };
  });

const ecrDraftSchema = z.object({
  id: z.string().min(1).max(120),
  familyCode: familySchema,
  variantId: z.string().min(1).max(100).nullable().optional(),
  fromBaselineId: z.string().min(1).max(120).nullable().optional(),
  targetRevisionCode: z.string().min(1).max(40),
  targetBomRevision: z.string().max(100).nullable().optional(),
  title: z.string().min(1).max(300),
  reason: z.string().min(1).max(1000),
  bomCostDeltaInr: z.number().finite().default(0),
  weightDeltaG: z.number().finite().default(0),
  productionImpactPct: z.number().finite().default(0),
  inventoryImpactLakh: z.number().finite().default(0),
  affectedSkus: z.array(z.string().min(1).max(120)).max(200).default([]),
  sourceReference: z.string().min(1).max(500),
});

export const createEngineeringChange = createServerFn({ method: "POST" })
  .validator(ecrDraftSchema)
  .handler(async ({ data }) => {
    await assertSameSiteRequest();
    const role = await requirePermission("edit");
    const sql = await getSql();
    await assertVariantBelongsToFamily(sql, data.familyCode, data.variantId);
    if (data.fromBaselineId) {
      const basis = await sql<{ id: string }>`
        select id
        from vyndi_engineering_baselines
        where id=${data.fromBaselineId} and family_code=${data.familyCode}
        limit 1
      `;
      if (!basis[0]) throw new Error("ECR baseline does not belong to the selected product family.");
    }
    await sql`
      insert into vyndi_engineering_change_requests (
        id,family_code,variant_id,from_baseline_id,target_revision_code,target_bom_revision,
        title,reason,bom_cost_delta_inr,weight_delta_g,production_impact_pct,inventory_impact_lakh,
        affected_skus,status,source_ref,created_by
      ) values (
        ${data.id},${data.familyCode},${data.variantId ?? null},${data.fromBaselineId ?? null},
        ${data.targetRevisionCode},${data.targetBomRevision ?? null},${data.title},${data.reason},
        ${data.bomCostDeltaInr},${data.weightDeltaG},${data.productionImpactPct},${data.inventoryImpactLakh},
        ${JSON.stringify(data.affectedSkus)}::jsonb,'open',${data.sourceReference},${actor(role)}
      )
    `;
    await sql`
      insert into vyndi_audit_events (
        id,entity_type,entity_id,entity_revision,action,actor_user_id,actor_role,
        source_reference,payload_json,correlation_id,previous_state,new_state,reason
      ) values (
        ${crypto.randomUUID()},'engineering_change_request',${data.id},1,'ECR_CREATED',
        ${actor(role)},${role},${data.sourceReference},
        ${JSON.stringify({
          familyCode: data.familyCode,
          variantId: data.variantId ?? null,
          fromBaselineId: data.fromBaselineId ?? null,
          targetRevisionCode: data.targetRevisionCode,
          targetBomRevision: data.targetBomRevision ?? null,
          affectedSkus: data.affectedSkus,
        })}::jsonb,
        ${`ECR|${data.id}`},null,'open',${data.reason}
      )
    `;
    return { ok: true, id: data.id, status: "open" as const };
  });

const ecrTransitionSchema = z.object({
  id: z.string().min(1).max(120),
  toStatus: ecrStatusSchema,
  sourceReference: z.string().min(1).max(500),
  note: z.string().max(1000).optional(),
  implementedBaselineId: z.string().min(1).max(120).nullable().optional(),
});

export const transitionEngineeringChange = createServerFn({ method: "POST" })
  .validator(ecrTransitionSchema)
  .handler(async ({ data }) => {
    await assertSameSiteRequest();
    const approvalDecision =
      data.toStatus === "approved" || data.toStatus === "rejected" || data.toStatus === "implemented";
    const role = await requirePermission(approvalDecision ? "approve" : "edit");
    const sql = await getSql();
    const rows = await sql<{ status: string; recordRevision: number; familyCode: string }>`
      select
        status,
        record_revision as "recordRevision",
        family_code as "familyCode"
      from vyndi_engineering_change_requests
      where id=${data.id}
      limit 1
    `;
    const current = rows[0];
    if (!current) throw new Error("Engineering change request not found.");
    const allowed =
      (current.status === "open" && data.toStatus === "pending_approval") ||
      (current.status === "pending_approval" &&
        (data.toStatus === "open" || data.toStatus === "approved" || data.toStatus === "rejected")) ||
      (current.status === "approved" && data.toStatus === "implemented");
    if (!allowed) throw new Error(`Invalid ECR transition: ${current.status} → ${data.toStatus}`);
    if (data.toStatus === "implemented") {
      if (!data.implementedBaselineId) {
        throw new Error("Implemented ECR requires the released Engineering baseline created by the change.");
      }
      const baseline = await sql<{ id: string }>`
        select id
        from vyndi_engineering_baselines
        where id=${data.implementedBaselineId}
          and family_code=${current.familyCode}
          and status='released'
        limit 1
      `;
      if (!baseline[0]) {
        throw new Error("Implemented ECR baseline must be a released baseline for the same product family.");
      }
    }
    const nextRevision = current.recordRevision + 1;
    await sql`
      update vyndi_engineering_change_requests set
        status=${data.toStatus},
        record_revision=${nextRevision},
        submitted_by=case
          when ${data.toStatus}='pending_approval' then ${actor(role)}
          else submitted_by
        end,
        decided_by=case
          when ${data.toStatus} in ('approved','rejected') then ${actor(role)}
          else decided_by
        end,
        implemented_by=case
          when ${data.toStatus}='implemented' then ${actor(role)}
          else implemented_by
        end,
        implemented_baseline_id=case
          when ${data.toStatus}='implemented' then ${data.implementedBaselineId ?? null}
          else implemented_baseline_id
        end,
        updated_at=now()
      where id=${data.id}
    `;
    await sql`
      insert into vyndi_audit_events (
        id,entity_type,entity_id,entity_revision,action,actor_user_id,actor_role,
        source_reference,payload_json,correlation_id,previous_state,new_state,reason
      ) values (
        ${crypto.randomUUID()},'engineering_change_request',${data.id},${nextRevision},
        'ECR_STATUS_CHANGED',${actor(role)},${role},${data.sourceReference},
        ${JSON.stringify({ implementedBaselineId: data.implementedBaselineId ?? null })}::jsonb,
        ${`ECR|${data.id}`},${current.status},${data.toStatus},${data.note ?? null}
      )
    `;
    return {
      ok: true,
      fromStatus: current.status,
      toStatus: data.toStatus,
      recordRevision: nextRevision,
    };
  });
