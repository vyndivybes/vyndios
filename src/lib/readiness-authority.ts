import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getSql, type SqlRow } from "@/lib/db";
import { getCommandRole } from "@/lib/command-access";
import { canPerform } from "@/lib/page-access";
import { requireBusinessActor } from "@/lib/business-actor";
import { compileVedmAuthorityGraph, createVedmR3aSeed } from "@/lib/vedm-authority-graph";
import { classifyVedmIssueDomain } from "@/lib/vyndi-risk-model";
import {
  buildReadinessAssessment,
  type ReadinessEvidence,
  type ReadinessRisk,
  type ReadinessTask,
} from "@/lib/readiness-model";

const PROGRAM_ID = "VYNDI-MASTER-PROGRAM";

async function requireView() {
  const role = await getCommandRole();
  if (!role || !canPerform(role, "view")) {
    throw new Error("Readiness intelligence view permission denied.");
  }
  return role;
}

const stateSchema = z.enum(["sufficient","insufficient","unrated","not_applicable"]);
const provenanceSchema = z.enum(["measured","calculated","derived","assumed","predicted","ai_interpreted"]);

export const getReadinessIntelligenceState = createServerFn({ method: "GET" }).handler(async () => {
  await requireView();
  const sql = await getSql();

  const [taskRows, evidenceRows, riskRows] = await Promise.all([
    sql.query<SqlRow>(
      `select id,domain,status from vyndi_program_tasks
        where program_id=$1 order by id`,
      [PROGRAM_ID],
    ),
    sql.query<SqlRow>(
      `select * from vyndi_readiness_evidence
        where program_id=$1 order by domain,id`,
      [PROGRAM_ID],
    ),
    sql.query<SqlRow>(
      `select id,exposure_score,status from vyndi_risk_intelligence
        where status<>'closed' order by exposure_score desc,id`,
    ),
  ]);

  const graph = compileVedmAuthorityGraph(
    createVedmR3aSeed(),
    new Date().toISOString().slice(0, 10),
  );
  const requiredVedmEvidence = new Set(
    [...graph.nodeById.values()]
      .filter((node) => node.kind === "release_gate")
      .flatMap((node) => node.requiredEvidenceIds ?? []),
  );

  const persistedEvidence: ReadinessEvidence[] = evidenceRows.map((row) => ({
    id: String(row.id),
    domain: String(row.domain),
    state: String(row.evidence_state) as ReadinessEvidence["state"],
    confidence: row.confidence == null ? null : Number(row.confidence),
    required: Boolean(row.required),
  }));

  const vedmNodes = [...graph.nodeById.values()]
    .filter((node) => node.kind === "evidence" && requiredVedmEvidence.has(node.id));
  const vedmEvidence: ReadinessEvidence[] = vedmNodes.map((node) => ({
    id: node.id,
    domain: node.domain,
    state: node.evidenceState === "sufficient" ? "sufficient"
      : node.evidenceState === "not_applicable" ? "not_applicable"
        : "insufficient",
    confidence: null,
    required: true,
  }));

  const tasks: ReadinessTask[] = taskRows.map((row) => ({
    id: String(row.id),
    domain: String(row.domain || "program"),
    status: String(row.status),
    readinessRequired: true,
  }));
  const risks: ReadinessRisk[] = riskRows.map((row) => ({
    id: String(row.id),
    exposureScore: row.exposure_score == null ? null : Number(row.exposure_score),
    status: String(row.status),
  }));
  const configurationBlockers = graph.issues.filter(
    (issue) => classifyVedmIssueDomain(issue.code) === "configuration"
      && issue.severity !== "warning",
  ).length;

  return {
    assessment: buildReadinessAssessment({
      tasks,
      evidence: [...persistedEvidence, ...vedmEvidence],
      activeRisks: risks,
      configurationBlockers,
    }),
    persistedEvidence,
    vedmEvidence: vedmNodes.map((node) => ({
      id: node.id,
      domain: node.domain,
      title: node.title,
      evidenceState: node.evidenceState ?? "insufficient",
      sourceReference: node.sourceRef,
    })),
    source: {
      vedmRepository: graph.sourceRepository,
      vedmCommit: graph.sourceCommit,
      programId: PROGRAM_ID,
    },
  };
});

export const upsertReadinessEvidence = createServerFn({ method: "POST" })
  .validator(z.object({
    id: z.string().trim().min(2).max(120),
    subjectType: z.enum(["program_task","vedm_node","release_gate","risk","other"]),
    subjectId: z.string().trim().min(1).max(200),
    domain: z.string().trim().min(1).max(120),
    title: z.string().trim().min(2).max(500),
    required: z.boolean().default(true),
    evidenceState: stateSchema,
    confidence: z.number().min(0).max(1).nullable().default(null),
    authority: z.string().trim().min(1).max(120).default("governed-internal"),
    provenanceClass: provenanceSchema,
    sourceReference: z.string().trim().min(1).max(500),
    notes: z.string().trim().max(2000).default(""),
  }))
  .handler(async ({ data }) => {
    const actor = await requireBusinessActor("edit");
    const sql = await getSql();
    const current = await sql.query<{ record_revision: number | string }>(
      `select record_revision from vyndi_readiness_evidence where id=$1 limit 1`,
      [data.id],
    );
    const revision = Number(current[0]?.record_revision ?? 0) + 1;

    await sql.query(
      `insert into vyndi_readiness_evidence (
        id,program_id,subject_type,subject_id,domain,title,required,evidence_state,
        confidence,authority,provenance_class,source_reference,notes,record_revision,updated_by,updated_at
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,now())
      on conflict(id) do update set
        subject_type=excluded.subject_type,subject_id=excluded.subject_id,domain=excluded.domain,
        title=excluded.title,required=excluded.required,evidence_state=excluded.evidence_state,
        confidence=excluded.confidence,authority=excluded.authority,
        provenance_class=excluded.provenance_class,source_reference=excluded.source_reference,
        notes=excluded.notes,record_revision=excluded.record_revision,
        updated_by=excluded.updated_by,updated_at=now()`,
      [
        data.id,PROGRAM_ID,data.subjectType,data.subjectId,data.domain,data.title,data.required,
        data.evidenceState,data.confidence,data.authority,data.provenanceClass,
        data.sourceReference,data.notes,revision,actor.userId,
      ],
    );

    await sql.query(
      `insert into vyndi_audit_events (
        id,entity_type,entity_id,entity_revision,action,actor_user_id,actor_role,
        source_reference,payload_json,correlation_id,new_state
      ) values ($1,'readiness_evidence',$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)`,
      [
        crypto.randomUUID(),data.id,revision,current[0] ? "READINESS_EVIDENCE_UPDATED" : "READINESS_EVIDENCE_CREATED",
        actor.userId,actor.role,data.sourceReference,
        JSON.stringify({
          subjectType:data.subjectType,subjectId:data.subjectId,domain:data.domain,
          required:data.required,evidenceState:data.evidenceState,confidence:data.confidence,
          authority:data.authority,provenanceClass:data.provenanceClass,
        }),
        `READINESS|${PROGRAM_ID}|${data.id}`,data.evidenceState,
      ],
    );

    return { ok:true, id:data.id, revision };
  });
