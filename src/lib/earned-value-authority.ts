import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getSql } from "@/lib/db";
import { getCommandRole } from "@/lib/command-access";
import { canPerform } from "@/lib/page-access";
import { requireBusinessActor } from "@/lib/business-actor";
import { buildEarnedValueSnapshot, type EarnedValueTaskInput } from "@/lib/earned-value-model";

const PROGRAM_ID = "VYNDI-MASTER-PROGRAM";

type Row = Record<string, unknown>;

async function requireView() {
  const role = await getCommandRole();
  if (!role || !canPerform(role, "view")) throw new Error("Earned Value view permission denied.");
  return role;
}

function taskFromRow(row: Row): EarnedValueTaskInput {
  return {
    id: String(row.id),
    status: String(row.status) as EarnedValueTaskInput["status"],
    plannedStart: row.planned_start == null ? null : String(row.planned_start),
    plannedFinish: row.planned_finish == null ? null : String(row.planned_finish),
    actualStart: row.actual_start == null ? null : String(row.actual_start),
    budgetAtCompletionLakh: row.cost_lakh == null ? null : Number(row.cost_lakh),
    progressPct: row.progress_pct == null ? null : Number(row.progress_pct),
    progressSourceRef: row.progress_evidence_ref == null ? null : String(row.progress_evidence_ref),
    actualCostLakh: row.actual_cost_lakh == null ? null : Number(row.actual_cost_lakh),
    actualCostSourceRef: row.actual_cost_source_ref == null ? null : String(row.actual_cost_source_ref),
  };
}

async function loadBasis(asOfDate: string) {
  const sql = await getSql();
  const [taskRows, latestRows] = await Promise.all([
    sql.query<Row>(
      "select id,title,status,planned_start::text,planned_finish::text,actual_start::text,actual_finish::text," +
      " cost_lakh,progress_pct,progress_evidence_ref,actual_cost_lakh,actual_cost_source_ref," +
      " source_reference,record_revision from vyndi_program_tasks where program_id=$1 order by id",
      [PROGRAM_ID],
    ),
    sql.query<Row>(
      "select id,as_of_date::text,method,result_json,source_reference,actor_user_id,actor_role,created_at" +
      " from vyndi_earned_value_runs where program_id=$1 order by as_of_date desc,created_at desc,id desc limit 1",
      [PROGRAM_ID],
    ),
  ]);
  const tasks = taskRows.map(taskFromRow);
  const live = buildEarnedValueSnapshot({ asOfDate, tasks });
  const latest = latestRows[0]
    ? {
        id: String(latestRows[0].id),
        asOfDate: String(latestRows[0].as_of_date),
        method: String(latestRows[0].method),
        sourceReference: String(latestRows[0].source_reference),
        actorRole: String(latestRows[0].actor_role),
        createdAt: String(latestRows[0].created_at),
        result: latestRows[0].result_json as ReturnType<typeof buildEarnedValueSnapshot>,
      }
    : null;
  return { sql, taskRows: [...taskRows], tasks, live, latest };
}

export const getEarnedValueState = createServerFn({ method: "GET" }).handler(async () => {
  await requireView();
  const asOfDate = new Date().toISOString().slice(0, 10);
  const loaded = await loadBasis(asOfDate);
  return { tasks: loaded.taskRows, live: loaded.live, latest: loaded.latest };
});

const evidenceSchema = z.object({
  taskId: z.string().trim().min(1).max(120),
  progressPct: z.number().min(0).max(100).nullable(),
  progressEvidenceRef: z.string().trim().max(500).nullable(),
  actualCostLakh: z.number().min(0).nullable(),
  actualCostSourceRef: z.string().trim().max(500).nullable(),
  sourceReference: z.string().trim().min(1).max(500),
}).superRefine((value, ctx) => {
  if (value.progressPct != null && !value.progressEvidenceRef) {
    ctx.addIssue({ code: "custom", path: ["progressEvidenceRef"], message: "Progress evidence reference is required when physical progress is recorded." });
  }
  if (value.actualCostLakh != null && !value.actualCostSourceRef) {
    ctx.addIssue({ code: "custom", path: ["actualCostSourceRef"], message: "Actual-cost source reference is required when actual cost is recorded." });
  }
});

export const updateEarnedValueEvidence = createServerFn({ method: "POST" })
  .validator(evidenceSchema)
  .handler(async ({ data }) => {
    const actor = await requireBusinessActor("edit");
    const sql = await getSql();
    const rows = await sql.query<{ status: string; record_revision: number | string }>(
      "select status,record_revision from vyndi_program_tasks where id=$1 and program_id=$2 limit 1",
      [data.taskId, PROGRAM_ID],
    );
    const current = rows[0];
    if (!current) throw new Error("Program task not found.");
    if (data.progressPct != null && !["in_progress", "blocked"].includes(current.status)) {
      throw new Error("Physical progress percentage is editable only for in-progress or blocked work. Completed task EV is derived as 100%.");
    }
    const revision = Number(current.record_revision) + 1;
    await sql.query(
      "update vyndi_program_tasks set progress_pct=$1,progress_evidence_ref=$2," +
      " actual_cost_lakh=$3,actual_cost_source_ref=$4,record_revision=$5,updated_by=$6,updated_at=now()" +
      " where id=$7 and program_id=$8",
      [
        data.progressPct,
        data.progressPct == null ? null : data.progressEvidenceRef,
        data.actualCostLakh,
        data.actualCostLakh == null ? null : data.actualCostSourceRef,
        revision,
        actor.userId,
        data.taskId,
        PROGRAM_ID,
      ],
    );
    await sql.query(
      "insert into vyndi_audit_events(" +
      "id,entity_type,entity_id,entity_revision,action,actor_user_id,actor_role,source_reference,payload_json,correlation_id" +
      ") values($1,'program_task',$2,$3,'PROGRAM_EVM_EVIDENCE_UPDATED',$4,$5,$6,$7::jsonb,$8)",
      [
        crypto.randomUUID(),
        data.taskId,
        revision,
        actor.userId,
        actor.role,
        data.sourceReference,
        JSON.stringify({
          progressPct: data.progressPct,
          progressEvidenceRef: data.progressPct == null ? null : data.progressEvidenceRef,
          actualCostLakh: data.actualCostLakh,
          actualCostSourceRef: data.actualCostLakh == null ? null : data.actualCostSourceRef,
        }),
        "EVM_EVIDENCE|" + PROGRAM_ID + "|" + data.taskId,
      ],
    );
    return { ok: true, taskId: data.taskId, revision };
  });

export const captureEarnedValueSnapshot = createServerFn({ method: "POST" })
  .validator(z.object({
    asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    sourceReference: z.string().trim().min(1).max(500),
  }))
  .handler(async ({ data }) => {
    const actor = await requireBusinessActor("edit");
    const loaded = await loadBasis(data.asOfDate);
    const result = buildEarnedValueSnapshot({ asOfDate: data.asOfDate, tasks: loaded.tasks });
    if (!result.available) throw new Error(result.reason);
    const id = "EVM-" + crypto.randomUUID();
    await loaded.sql.query(
      "insert into vyndi_earned_value_runs(" +
      "id,program_id,as_of_date,method,input_json,result_json,source_reference,actor_user_id,actor_role" +
      ") values($1,$2,$3::date,$4,$5::jsonb,$6::jsonb,$7,$8,$9)",
      [
        id,
        PROGRAM_ID,
        data.asOfDate,
        result.method,
        JSON.stringify({ asOfDate: data.asOfDate, tasks: loaded.tasks }),
        JSON.stringify(result),
        data.sourceReference,
        actor.userId,
        actor.role,
      ],
    );
    await loaded.sql.query(
      "insert into vyndi_audit_events(" +
      "id,entity_type,entity_id,action,actor_user_id,actor_role,source_reference,payload_json,correlation_id" +
      ") values($1,'earned_value_run',$2,'PROGRAM_EVM_SNAPSHOT_CAPTURED',$3,$4,$5,$6::jsonb,$7)",
      [
        crypto.randomUUID(),
        id,
        actor.userId,
        actor.role,
        data.sourceReference,
        JSON.stringify({
          asOfDate: result.asOfDate,
          bacLakh: result.bacLakh,
          pvLakh: result.pvLakh,
          evLakh: result.evLakh,
          acLakh: result.acLakh,
          cpi: result.cpi,
          spi: result.spi,
        }),
        "EVM|" + PROGRAM_ID + "|" + data.asOfDate,
      ],
    );
    return { ok: true, id, result };
  });
