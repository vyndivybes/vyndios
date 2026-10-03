import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getSql } from "@/lib/db";
import { getCommandRole } from "@/lib/command-access";
import { canPerform } from "@/lib/page-access";
import { requireBusinessActor } from "@/lib/business-actor";
import {
  buildProgramNetwork,
  type ProgramDependencyInput,
  type ProgramTaskInput,
} from "@/lib/program-planning-model";

const PROGRAM_ID = "VYNDI-MASTER-PROGRAM";

const taskStatus = z.enum([
  "planned","ready","in_progress","blocked","complete","waived",
]);

async function requireView() {
  const role = await getCommandRole();
  if (!role || !canPerform(role, "view")) {
    throw new Error("Program planning view permission denied.");
  }
  return role;
}

const textList = z.array(z.string().trim().min(1).max(240)).max(100);

const taskInput = z.object({
  id: z.string().trim().min(2).max(120),
  title: z.string().trim().min(2).max(300),
  domain: z.string().trim().min(1).max(120).default("program"),
  workPackage: z.string().trim().max(200).default(""),
  owner: z.string().trim().max(200).default(""),
  status: taskStatus.default("planned"),
  durationDays: z.number().int().min(1).max(3650),
  plannedStart: z.string().trim().max(10).default(""),
  plannedFinish: z.string().trim().max(10).default(""),
  actualStart: z.string().trim().max(10).default(""),
  actualFinish: z.string().trim().max(10).default(""),
  gateId: z.string().trim().max(120).default(""),
  requiredInputs: textList.default([]),
  requiredEvidence: textList.default([]),
  riskIds: textList.default([]),
  estimatedEffortHours: z.number().min(0).nullable().default(null),
  actualEffortHours: z.number().min(0).nullable().default(null),
  costLakh: z.number().min(0).nullable().default(null),
  confidence: z.number().min(0).max(1).nullable().default(null),
  technicalMaturity: z.number().int().min(0).max(100).nullable().default(null),
  sourceReference: z.string().trim().min(1).max(500),
});

type TaskRow = Record<string, unknown>;
type DependencyRow = {
  predecessor_id: string;
  successor_id: string;
  lag_days: number | string;
};

function networkFromRows(tasks: TaskRow[], dependencies: DependencyRow[]) {
  const modelTasks: ProgramTaskInput[] = tasks.map((row) => ({
    id: String(row.id),
    title: String(row.title),
    durationDays: Number(row.duration_days),
    status: String(row.status) as ProgramTaskInput["status"],
  }));
  const modelDependencies: ProgramDependencyInput[] = dependencies.map((row) => ({
    predecessorId: row.predecessor_id,
    successorId: row.successor_id,
    lagDays: Number(row.lag_days),
  }));
  return buildProgramNetwork(modelTasks, modelDependencies);
}

async function loadRows() {
  const sql = await getSql();
  const programs = await sql<Record<string, unknown>>`
    select * from vyndi_programs where id=${PROGRAM_ID} limit 1
  `;
  const tasks = await sql<TaskRow>`
    select * from vyndi_program_tasks
     where program_id=${PROGRAM_ID}
     order by id
  `;
  const dependencies = await sql<DependencyRow>`
    select predecessor_id,successor_id,lag_days,source_reference,created_by,created_at
      from vyndi_program_dependencies
     where program_id=${PROGRAM_ID}
     order by predecessor_id,successor_id
  `;
  return { sql, program: programs[0] ?? null, tasks: [...tasks], dependencies: [...dependencies] };
}

export const getProgramPlanningState = createServerFn({ method: "GET" }).handler(async () => {
  await requireView();
  const { program, tasks, dependencies } = await loadRows();
  return {
    program,
    tasks,
    dependencies,
    network: networkFromRows(tasks, dependencies),
  };
});

export const createProgramTask = createServerFn({ method: "POST" })
  .validator(taskInput)
  .handler(async ({ data }) => {
    const actor = await requireBusinessActor("edit");
    const { sql } = await loadRows();
    const existing = await sql<{ id: string }>`
      select id from vyndi_program_tasks where id=${data.id} limit 1
    `;
    if (existing[0]) throw new Error("Program task already exists.");

    await sql`
      insert into vyndi_program_tasks (
        id,program_id,title,domain,work_package,owner,status,duration_days,
        planned_start,planned_finish,actual_start,actual_finish,gate_id,
        required_inputs,required_evidence,risk_ids,estimated_effort_hours,actual_effort_hours,
        cost_lakh,confidence,technical_maturity,source_reference,record_revision,updated_by
      ) values (
        ${data.id},${PROGRAM_ID},${data.title},${data.domain},${data.workPackage},
        ${data.owner || null},${data.status},${data.durationDays},
        ${data.plannedStart || null}::date,${data.plannedFinish || null}::date,
        ${data.actualStart || null}::date,${data.actualFinish || null}::date,
        ${data.gateId || null},${JSON.stringify(data.requiredInputs)}::jsonb,
        ${JSON.stringify(data.requiredEvidence)}::jsonb,${JSON.stringify(data.riskIds)}::jsonb,
        ${data.estimatedEffortHours},${data.actualEffortHours},${data.costLakh},
        ${data.confidence},${data.technicalMaturity},${data.sourceReference},1,${actor.userId}
      )
    `;

    await sql`
      insert into vyndi_audit_events (
        id,entity_type,entity_id,entity_revision,action,actor_user_id,actor_role,
        source_reference,payload_json,correlation_id,new_state
      ) values (
        ${crypto.randomUUID()},'program_task',${data.id},1,'PROGRAM_TASK_CREATED',
        ${actor.userId},${actor.role},${data.sourceReference},
        ${JSON.stringify({
          programId: PROGRAM_ID,
          domain: data.domain,
          workPackage: data.workPackage,
          durationDays: data.durationDays,
          gateId: data.gateId || null,
          requiredEvidence: data.requiredEvidence,
          riskIds: data.riskIds,
        })}::jsonb,${`PROGRAM|${PROGRAM_ID}|${data.id}`},${data.status}
      )
    `;
    return { ok: true, id: data.id, revision: 1 };
  });

export const updateProgramTask = createServerFn({ method: "POST" })
  .validator(taskInput)
  .handler(async ({ data }) => {
    const actor = await requireBusinessActor("edit");
    const { sql } = await loadRows();
    const current = await sql<{ record_revision: number | string; status: string }>`
      select record_revision,status from vyndi_program_tasks where id=${data.id} and program_id=${PROGRAM_ID} limit 1
    `;
    if (!current[0]) throw new Error("Program task not found.");
    const revision = Number(current[0].record_revision) + 1;

    await sql`
      update vyndi_program_tasks
         set title=${data.title},domain=${data.domain},work_package=${data.workPackage},
             owner=${data.owner || null},status=${data.status},duration_days=${data.durationDays},
             planned_start=${data.plannedStart || null}::date,planned_finish=${data.plannedFinish || null}::date,
             actual_start=${data.actualStart || null}::date,actual_finish=${data.actualFinish || null}::date,
             gate_id=${data.gateId || null},required_inputs=${JSON.stringify(data.requiredInputs)}::jsonb,
             required_evidence=${JSON.stringify(data.requiredEvidence)}::jsonb,
             risk_ids=${JSON.stringify(data.riskIds)}::jsonb,
             estimated_effort_hours=${data.estimatedEffortHours},actual_effort_hours=${data.actualEffortHours},
             cost_lakh=${data.costLakh},confidence=${data.confidence},
             technical_maturity=${data.technicalMaturity},source_reference=${data.sourceReference},
             record_revision=${revision},updated_by=${actor.userId},updated_at=now()
       where id=${data.id} and program_id=${PROGRAM_ID}
    `;

    await sql`
      insert into vyndi_audit_events (
        id,entity_type,entity_id,entity_revision,action,actor_user_id,actor_role,
        source_reference,payload_json,correlation_id,previous_state,new_state
      ) values (
        ${crypto.randomUUID()},'program_task',${data.id},${revision},'PROGRAM_TASK_UPDATED',
        ${actor.userId},${actor.role},${data.sourceReference},
        ${JSON.stringify({
          durationDays: data.durationDays,
          plannedStart: data.plannedStart || null,
          plannedFinish: data.plannedFinish || null,
          actualStart: data.actualStart || null,
          actualFinish: data.actualFinish || null,
          owner: data.owner || null,
          gateId: data.gateId || null,
        })}::jsonb,${`PROGRAM|${PROGRAM_ID}|${data.id}`},
        ${current[0].status},${data.status}
      )
    `;
    return { ok: true, id: data.id, revision };
  });

export const transitionProgramTaskStatus = createServerFn({ method: "POST" })
  .validator(z.object({
    id: z.string().trim().min(1).max(120),
    status: taskStatus,
    actualStart: z.string().trim().max(10).default(""),
    actualFinish: z.string().trim().max(10).default(""),
    sourceReference: z.string().trim().min(1).max(500),
  }))
  .handler(async ({ data }) => {
    const actor = await requireBusinessActor("edit");
    const { sql } = await loadRows();
    const current = await sql<{ record_revision: number | string; status: string }>`
      select record_revision,status from vyndi_program_tasks
       where id=${data.id} and program_id=${PROGRAM_ID} limit 1
    `;
    if (!current[0]) throw new Error("Program task not found.");
    if (data.status === "complete" && !data.actualFinish) {
      throw new Error("Completed program tasks require an actual finish date.");
    }
    const revision = Number(current[0].record_revision) + 1;
    await sql`
      update vyndi_program_tasks
         set status=${data.status},
             actual_start=coalesce(${data.actualStart || null}::date,actual_start),
             actual_finish=case when ${data.status}='complete' then ${data.actualFinish || null}::date else actual_finish end,
             source_reference=${data.sourceReference},record_revision=${revision},
             updated_by=${actor.userId},updated_at=now()
       where id=${data.id} and program_id=${PROGRAM_ID}
    `;
    await sql`
      insert into vyndi_audit_events (
        id,entity_type,entity_id,entity_revision,action,actor_user_id,actor_role,
        source_reference,payload_json,correlation_id,previous_state,new_state
      ) values (
        ${crypto.randomUUID()},'program_task',${data.id},${revision},'PROGRAM_TASK_STATUS_CHANGED',
        ${actor.userId},${actor.role},${data.sourceReference},
        ${JSON.stringify({ actualStart: data.actualStart || null, actualFinish: data.actualFinish || null })}::jsonb,
        ${`PROGRAM|${PROGRAM_ID}|${data.id}`},${current[0].status},${data.status}
      )
    `;
    return { ok: true, id: data.id, revision, status: data.status };
  });

export const createProgramDependency = createServerFn({ method: "POST" })
  .validator(z.object({
    predecessorId: z.string().trim().min(1).max(120),
    successorId: z.string().trim().min(1).max(120),
    lagDays: z.number().int().min(0).max(3650).default(0),
    sourceReference: z.string().trim().min(1).max(500),
  }))
  .handler(async ({ data }) => {
    const actor = await requireBusinessActor("edit");
    const { sql, tasks, dependencies } = await loadRows();
    const candidate = [
      ...dependencies,
      {
        predecessor_id: data.predecessorId,
        successor_id: data.successorId,
        lag_days: data.lagDays,
      },
    ];
    const network = networkFromRows(tasks, candidate);
    if (!network.valid) {
      throw new Error(network.issues.map((issue) => issue.message).join(" "));
    }

    await sql`
      insert into vyndi_program_dependencies (
        program_id,predecessor_id,successor_id,dependency_type,lag_days,source_reference,created_by
      ) values (
        ${PROGRAM_ID},${data.predecessorId},${data.successorId},'finish_to_start',
        ${data.lagDays},${data.sourceReference},${actor.userId}
      )
    `;

    await sql`
      insert into vyndi_audit_events (
        id,entity_type,entity_id,action,actor_user_id,actor_role,source_reference,
        payload_json,correlation_id
      ) values (
        ${crypto.randomUUID()},'program_dependency',
        ${`${data.predecessorId}->${data.successorId}`},'PROGRAM_DEPENDENCY_CREATED',
        ${actor.userId},${actor.role},${data.sourceReference},
        ${JSON.stringify({ programId: PROGRAM_ID, lagDays: data.lagDays })}::jsonb,
        ${`PROGRAM|${PROGRAM_ID}`}
      )
    `;
    return { ok: true };
  });
