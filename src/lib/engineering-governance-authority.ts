import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getSql } from "@/lib/db";
import { requireBusinessActor } from "@/lib/business-actor";
import type { CommandRole } from "@/lib/page-access";
import {
  applyEngineeringWaiver,
  evaluateEngineeringWorkflowTransition,
  type EngineeringActorAuthority,
  type EngineeringWorkflowState,
  type GovernedEngineeringWorkflow,
} from "@/lib/governed-engineering-workflow";
import {
  compileVedmAuthorityGraph,
  createVedmR3aSeed,
  VEDM_R3A_SOURCE_COMMIT,
  VEDM_R3A_SOURCE_REPOSITORY,
} from "@/lib/vedm-authority-graph";
import { evaluateEngineeringRelease, type ReleaseEvidenceReceipt } from "@/lib/engineering-release-readiness";
import { compileDigitalProductThread } from "@/lib/digital-product-thread";

type WorkflowRow = {
  id: string;
  subject_id: string;
  state: EngineeringWorkflowState;
  criticality: "ordinary" | "release";
  blocker_ids: unknown;
  supersedes_id: string | null;
  successor_id: string | null;
  created_by: string;
  record_revision: number;
};

function authorityForRole(role: CommandRole): EngineeringActorAuthority {
  if (role === "admin") return "configuration_authority";
  if (role === "qa") return "qa_authority";
  if (role === "engineering") return "engineering_authority";
  throw new Error("Engineering governance authority requires admin, engineering or QA role.");
}

function blockers(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function toWorkflow(row: WorkflowRow): GovernedEngineeringWorkflow {
  return {
    id: row.id,
    subjectId: row.subject_id,
    state: row.state,
    createdBy: row.created_by,
    criticality: row.criticality,
    blockers: blockers(row.blocker_ids),
    supersedesId: row.supersedes_id,
    successorId: row.successor_id,
  };
}

async function loadWorkflow(sql: Awaited<ReturnType<typeof getSql>>, id: string) {
  const rows = await sql.query<WorkflowRow>(
    "select id,subject_id,state,criticality,blocker_ids,supersedes_id,successor_id,created_by,record_revision from vyndi_engineering_workflows where id=$1 limit 1",
    [id],
  );
  if (!rows[0]) throw new Error("Engineering workflow not found.");
  return rows[0];
}

async function latestEvidence(sql: Awaited<ReturnType<typeof getSql>>) {
  const rows = await sql.query<{
    fingerprint: string;
    authority_node_id: string;
    authority_source_commit: string;
    decision: "accepted" | "rejected" | "superseded";
  }>(
    "select distinct on (a.receipt_fingerprint) a.receipt_fingerprint as fingerprint,a.authority_node_id,a.authority_source_commit,a.decision from vyndi_engineering_evidence_acceptances a order by a.receipt_fingerprint,a.created_at desc,a.id desc",
  );
  return rows.map((row): ReleaseEvidenceReceipt => ({
    fingerprint: row.fingerprint,
    nodeId: row.authority_node_id,
    sourceCommit: row.authority_source_commit,
    status: row.decision,
  }));
}

async function writeAudit(
  sql: Awaited<ReturnType<typeof getSql>>,
  entityType: string,
  entityId: string,
  action: string,
  actorUserId: string,
  actorRole: string,
  sourceRef: string,
  payload: unknown,
) {
  await sql.query(
    "insert into vyndi_audit_events(id,entity_type,entity_id,action,actor_user_id,actor_role,source_reference,payload_json) values($1,$2,$3,$4,$5,$6,$7,$8::jsonb)",
    [crypto.randomUUID(), entityType, entityId, action, actorUserId, actorRole, sourceRef, JSON.stringify(payload)],
  );
}

const createSchema = z.object({
  id: z.string().min(1).max(160),
  subjectId: z.string().min(1).max(200),
  criticality: z.enum(["ordinary", "release"]).default("release"),
  blockerIds: z.array(z.string().min(1).max(160)).max(100).default([]),
  supersedesId: z.string().max(200).nullable().optional(),
  sourceRef: z.string().min(1).max(800),
});

export const createGovernedEngineeringWorkflow = createServerFn({ method: "POST" })
  .validator(createSchema)
  .handler(async ({ data }) => {
    const actor = await requireBusinessActor("edit");
    const authority = authorityForRole(actor.role);
    const sql = await getSql();
    await sql.query(
      "insert into vyndi_engineering_workflows(id,subject_id,state,criticality,blocker_ids,supersedes_id,source_ref,created_by,created_role) values($1,$2,'draft',$3,$4::jsonb,$5,$6,$7,$8)",
      [data.id, data.subjectId, data.criticality, JSON.stringify(data.blockerIds), data.supersedesId ?? null, data.sourceRef, actor.userId, actor.role],
    );
    await sql.query(
      "insert into vyndi_engineering_workflow_events(id,workflow_id,from_state,to_state,decision_code,actor_user_id,actor_role,actor_authority,reason,source_ref) values($1,$2,null,'draft','ALLOWED',$3,$4,$5,'Workflow created',$6)",
      ["ENG-WF-EVT-" + crypto.randomUUID(), data.id, actor.userId, actor.role, authority, data.sourceRef],
    );
    await writeAudit(sql, "engineering_workflow", data.id, "ENGINEERING_WORKFLOW_CREATED", actor.userId, actor.role, data.sourceRef, { subjectId: data.subjectId, blockerIds: data.blockerIds });
    return { ok: true, id: data.id, state: "draft" as const };
  });

const transitionSchema = z.object({
  id: z.string().min(1).max(160),
  toState: z.enum(["draft","pending_approval","approved","released","superseded","rejected","blocked"]),
  reason: z.string().min(1).max(1200),
  sourceRef: z.string().min(1).max(800),
  successorId: z.string().max(200).nullable().optional(),
});

async function assessReleaseForWorkflow(
  sql: Awaited<ReturnType<typeof getSql>>,
  row: WorkflowRow,
  actorAuthority: EngineeringActorAuthority,
) {
  const graph = compileVedmAuthorityGraph(createVedmR3aSeed(), new Date().toISOString().slice(0, 10));
  const evidence = await latestEvidence(sql);
  return { graph, result: evaluateEngineeringRelease({ graph, workflowState: row.state, actorAuthority, evidence }) };
}

async function persistRelease(
  sql: Awaited<ReturnType<typeof getSql>>,
  row: WorkflowRow,
  actorUserId: string,
  actorRole: string,
  sourceRef: string,
  graph: ReturnType<typeof compileVedmAuthorityGraph>,
  result: ReturnType<typeof evaluateEngineeringRelease>,
) {
  const id = "ENG-REL-" + crypto.randomUUID();
  await sql.query(
    "insert into vyndi_engineering_release_decisions(id,workflow_id,subject_id,release_fingerprint,source_repository,source_commit,as_of_date,controlling_authority_id,releasable,blocker_ids,accepted_evidence_fingerprints,authority_snapshot_json,actor_user_id,actor_role,decision,source_ref) values($1,$2,$3,$4,$5,$6,$7::date,$8,$9,$10::jsonb,$11::jsonb,$12::jsonb,$13,$14,$15,$16) on conflict(release_fingerprint) do nothing",
    [id,row.id,row.subject_id,result.releaseFingerprint,graph.sourceRepository,graph.sourceCommit,graph.asOfDate,graph.authorityByDomain.frame_geometry?.id ?? null,result.releasable,JSON.stringify(result.blockers),JSON.stringify(result.acceptedEvidenceFingerprints),JSON.stringify({ schema: graph.schema, blockingGateIds: graph.blockingGateIds, issues: graph.issues }),actorUserId,actorRole,result.releasable ? "assessed" : "blocked",sourceRef],
  );
  return id;
}

export const transitionGovernedEngineeringWorkflow = createServerFn({ method: "POST" })
  .validator(transitionSchema)
  .handler(async ({ data }) => {
    const actor = await requireBusinessActor(["approved","released","superseded","rejected"].includes(data.toState) ? "approve" : "edit");
    const actorAuthority = authorityForRole(actor.role);
    const sql = await getSql();
    const row = await loadWorkflow(sql, data.id);
    const workflow = toWorkflow({ ...row, successor_id: data.successorId ?? row.successor_id });
    const decision = evaluateEngineeringWorkflowTransition(workflow, { actorUserId: actor.userId, actorAuthority, toState: data.toState, reason: data.reason });
    if (!decision.allowed) throw new Error(decision.code);

    if (data.toState === "released") {
      const release = await assessReleaseForWorkflow(sql, row, actorAuthority);
      await persistRelease(sql, row, actor.userId, actor.role, data.sourceRef, release.graph, release.result);
      if (!release.result.releasable) throw new Error("ENGINEERING_RELEASE_BLOCKED: " + release.result.blockers.join(", "));
    }

    const nextRevision = row.record_revision + 1;
    await sql.query(
      "update vyndi_engineering_workflows set state=$1,successor_id=coalesce($2,successor_id),record_revision=$3,updated_at=now() where id=$4",
      [data.toState, data.successorId ?? null, nextRevision, data.id],
    );
    await sql.query(
      "insert into vyndi_engineering_workflow_events(id,workflow_id,from_state,to_state,decision_code,actor_user_id,actor_role,actor_authority,reason,source_ref,payload_json) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)",
      ["ENG-WF-EVT-" + crypto.randomUUID(), data.id, row.state, data.toState, decision.code, actor.userId, actor.role, actorAuthority, data.reason, data.sourceRef, JSON.stringify({ successorId: data.successorId ?? null })],
    );
    await writeAudit(sql, "engineering_workflow", data.id, "ENGINEERING_WORKFLOW_STATUS_CHANGED", actor.userId, actor.role, data.sourceRef, { from: row.state, to: data.toState, decisionCode: decision.code, recordRevision: nextRevision });
    return { ok: true, fromState: row.state, toState: data.toState, recordRevision: nextRevision };
  });

const waiverSchema = z.object({
  workflowId: z.string().min(1).max(160),
  blockerId: z.string().min(1).max(160),
  blockerClass: z.enum(["release_critical","safety","regulatory","administrative","documentation","commercial"]),
  requestedBy: z.string().min(1).max(200),
  reason: z.string().min(1).max(1200),
  evidenceRef: z.string().min(1).max(800),
  expiresAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sourceRef: z.string().min(1).max(800),
});

export const approveEngineeringWaiver = createServerFn({ method: "POST" })
  .validator(waiverSchema)
  .handler(async ({ data }) => {
    const actor = await requireBusinessActor("approve");
    authorityForRole(actor.role);
    const sql = await getSql();
    const row = await loadWorkflow(sql, data.workflowId);
    const result = applyEngineeringWaiver(toWorkflow(row), { blockerId: data.blockerId, blockerClass: data.blockerClass, requestedBy: data.requestedBy, approvedBy: actor.userId, reason: data.reason, evidenceRef: data.evidenceRef, expiresAt: data.expiresAt });
    if (!result.allowed) throw new Error(result.code);
    const id = "ENG-WAIVER-" + crypto.randomUUID();
    await sql.query(
      "insert into vyndi_engineering_waivers(id,workflow_id,blocker_id,blocker_class,requested_by,approved_by,reason,evidence_ref,expires_at,source_ref) values($1,$2,$3,$4,$5,$6,$7,$8,$9::date,$10)",
      [id,data.workflowId,data.blockerId,data.blockerClass,data.requestedBy,actor.userId,data.reason,data.evidenceRef,data.expiresAt,data.sourceRef],
    );
    await sql.query("update vyndi_engineering_workflows set blocker_ids=$1::jsonb,record_revision=record_revision+1,updated_at=now() where id=$2", [JSON.stringify(result.remainingBlockers),data.workflowId]);
    await writeAudit(sql, "engineering_waiver", id, "ENGINEERING_WAIVER_APPROVED", actor.userId, actor.role, data.sourceRef, { blockerId: data.blockerId, expiresAt: data.expiresAt });
    return { ok: true, waiverId: id, remainingBlockers: result.remainingBlockers };
  });

const evidenceDecisionSchema = z.object({
  fingerprint: z.string().min(1).max(100),
  authorityNodeId: z.string().min(1).max(200),
  decision: z.enum(["accepted","rejected","superseded"]),
  reason: z.string().min(1).max(1200),
  sourceRef: z.string().min(1).max(800),
});

export const decideEngineeringEvidence = createServerFn({ method: "POST" })
  .validator(evidenceDecisionSchema)
  .handler(async ({ data }) => {
    const actor = await requireBusinessActor("approve");
    authorityForRole(actor.role);
    const sql = await getSql();
    const receipts = await sql.query<{actor_user_id:string;authority_source_commit:string|null}>(
      "select actor_user_id,authority_source_commit from vyndi_engineering_evidence_receipts where fingerprint=$1 limit 1",
      [data.fingerprint],
    );
    if (!receipts[0]) throw new Error("Engineering evidence receipt not found.");
    if (receipts[0].actor_user_id === actor.userId) throw new Error("SOD_MAKER_CHECKER");
    if (receipts[0].authority_source_commit && receipts[0].authority_source_commit !== VEDM_R3A_SOURCE_COMMIT) throw new Error("STALE_EVIDENCE_SOURCE");
    const id = "ENG-EVID-DEC-" + crypto.randomUUID();
    await sql.query(
      "insert into vyndi_engineering_evidence_acceptances(id,receipt_fingerprint,authority_node_id,authority_source_commit,decision,reason,actor_user_id,actor_role,source_ref) values($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [id,data.fingerprint,data.authorityNodeId,VEDM_R3A_SOURCE_COMMIT,data.decision,data.reason,actor.userId,actor.role,data.sourceRef],
    );
    await writeAudit(sql, "engineering_evidence_acceptance", id, "ENGINEERING_EVIDENCE_DECIDED", actor.userId, actor.role, data.sourceRef, { fingerprint: data.fingerprint, authorityNodeId: data.authorityNodeId, decision: data.decision });
    return { ok: true, id, decision: data.decision };
  });

const assessSchema = z.object({ workflowId: z.string().min(1).max(160), sourceRef: z.string().min(1).max(800) });

export const assessGovernedEngineeringRelease = createServerFn({ method: "POST" })
  .validator(assessSchema)
  .handler(async ({ data }) => {
    const actor = await requireBusinessActor("approve");
    const actorAuthority = authorityForRole(actor.role);
    const sql = await getSql();
    const row = await loadWorkflow(sql, data.workflowId);
    const release = await assessReleaseForWorkflow(sql, row, actorAuthority);
    const decisionId = await persistRelease(sql, row, actor.userId, actor.role, data.sourceRef, release.graph, release.result);
    return { ok: true, decisionId, ...release.result };
  });

const threadSchema = z.object({
  subjectId: z.string().min(1).max(200),
  engineeringBaselineId: z.string().max(200).nullable().optional(),
  bomRevisionId: z.string().max(200).nullable().optional(),
  jobCardIds: z.array(z.string().min(1).max(200)).max(500).default([]),
  qualityReleaseIds: z.array(z.string().min(1).max(200)).max(500).default([]),
  shipmentIds: z.array(z.string().min(1).max(200)).max(500).default([]),
  sourceRef: z.string().min(1).max(800),
});

export const captureEngineeringDigitalThread = createServerFn({ method: "POST" })
  .validator(threadSchema)
  .handler(async ({ data }) => {
    const actor = await requireBusinessActor("edit");
    authorityForRole(actor.role);
    const sql = await getSql();
    const graph = compileVedmAuthorityGraph(createVedmR3aSeed(), new Date().toISOString().slice(0, 10));
    const thread = compileDigitalProductThread(graph, data);
    const snapshotId = "ENG-THREAD-" + crypto.randomUUID();
    const nodes = [...thread.nodeById.values()];
    await sql.query(
      "insert into vyndi_engineering_thread_snapshots(id,subject_id,source_repository,source_commit,node_count,edge_count,gap_count,snapshot_json,actor_user_id,actor_role,source_ref) values($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11)",
      [snapshotId,data.subjectId,VEDM_R3A_SOURCE_REPOSITORY,VEDM_R3A_SOURCE_COMMIT,nodes.length,thread.edges.length,thread.gaps.length,JSON.stringify({nodes,edges:thread.edges,gaps:thread.gaps}),actor.userId,actor.role,data.sourceRef],
    );
    for (const edge of thread.edges) {
      await sql.query(
        "insert into vyndi_engineering_thread_links(id,snapshot_id,from_node_id,to_node_id,relation) values($1,$2,$3,$4,$5)",
        ["ENG-THREAD-LINK-" + crypto.randomUUID(),snapshotId,edge.from,edge.to,edge.relation],
      );
    }
    await writeAudit(sql, "engineering_thread_snapshot", snapshotId, "ENGINEERING_THREAD_CAPTURED", actor.userId, actor.role, data.sourceRef, { nodeCount:nodes.length,edgeCount:thread.edges.length,gapCount:thread.gaps.length });
    return { ok: true, snapshotId, gapCount: thread.gaps.length, gaps: thread.gaps };
  });

// Explicit R3 governance tokens used by static assurance and audit reporting.
export const R3_ENGINEERING_GOVERNANCE = {
  sourceRepository: VEDM_R3A_SOURCE_REPOSITORY,
  sourceCommit: VEDM_R3A_SOURCE_COMMIT,
  releaseAuthority: "HUMAN_APPROVAL_REQUIRED",
  sodFailure: "SOD_MAKER_CHECKER",
} as const;
