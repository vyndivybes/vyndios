import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireBusinessActor } from "@/lib/business-actor";
import { getSql, type SqlRow } from "@/lib/db";

const ref = z.string().trim().min(1).max(500);
const id = z.string().trim().min(1).max(180);
const domain = z.enum(["accounting","supplier","logistics","commerce"]);
const direction = z.enum(["inbound","outbound","bidirectional"]);

async function requireIntegrationAdmin(permission: "view" | "edit" | "approve") {
  const actor = await requireBusinessActor(permission);
  if (actor.role !== "admin") throw new Error("H5 integration control requires Admin role.");
  return actor;
}

export const getIntegrationControl = createServerFn({ method: "GET" }).handler(async () => {
  await requireIntegrationAdmin("view");
  const sql = await getSql();
  const [contracts,inbox,outbox,replays,events] = await Promise.all([
    sql.query<SqlRow>(`select * from vyndi_integration_control_summary`),
    sql.query<SqlRow>(`select id,contract_id,external_event_id,event_type,status,signature_verified,received_at::text as received_at,processed_at::text as processed_at,linked_entity_type,linked_entity_id,evidence_reference from vyndi_integration_inbox order by received_at desc limit 100`),
    sql.query<SqlRow>(`select id,contract_id,idempotency_key,event_type,aggregate_type,aggregate_id,status,attempt_count,replay_count,next_attempt_at::text as next_attempt_at,delivered_at::text as delivered_at,created_at::text as created_at from vyndi_integration_outbox order by created_at desc limit 100`),
    sql.query<SqlRow>(`select id,outbox_id,reason,evidence_reference,status,requested_by,requested_at::text as requested_at,approved_by,approved_at::text as approved_at,executed_at::text as executed_at from vyndi_integration_replay_requests order by requested_at desc limit 100`),
    sql.query<SqlRow>(`select id,contract_id,entity_type,entity_id,event_type,actor_user_id,actor_role,evidence_reference,created_at::text as created_at from vyndi_integration_events order by created_at desc limit 150`),
  ]);
  return { contracts,inbox,outbox,replays,events };
});

export const proposeIntegrationContract = createServerFn({ method: "POST" })
  .validator(z.object({
    domain,
    providerCode: id,
    direction,
    schemaVersion: id,
    authorityOwner: id,
    configReference: ref,
    secretBindingReference: z.string().trim().max(500).optional(),
    signatureRequired: z.boolean().default(true),
    maxDeliveryAttempts: z.number().int().min(1).max(20).default(5),
  }))
  .handler(async ({ data }) => {
    const actor = await requireIntegrationAdmin("edit");
    const sql = await getSql();
    const contractId = `INT-${data.domain}-${crypto.randomUUID()}`;
    await sql.query(
      `select propose_vyndi_integration_contract($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [contractId,data.domain,data.providerCode,data.direction,data.schemaVersion,data.authorityOwner,
       data.configReference,data.secretBindingReference ?? null,data.signatureRequired,data.maxDeliveryAttempts,
       actor.userId,actor.role],
    );
    return { ok: true, contractId };
  });

export const approveIntegrationContract = createServerFn({ method: "POST" })
  .validator(z.object({ contractId: id, evidenceReference: ref }))
  .handler(async ({ data }) => {
    const actor = await requireIntegrationAdmin("approve");
    const sql = await getSql();
    await sql.query(
      `select approve_vyndi_integration_contract($1,$2,$3,$4)`,
      [data.contractId,data.evidenceReference,actor.userId,actor.role],
    );
    return { ok: true, status: "approved" as const };
  });

export const disableIntegrationContract = createServerFn({ method: "POST" })
  .validator(z.object({ contractId: id, evidenceReference: ref }))
  .handler(async ({ data }) => {
    const actor = await requireIntegrationAdmin("approve");
    const sql = await getSql();
    await sql.query(
      `select disable_vyndi_integration_contract($1,$2,$3,$4)`,
      [data.contractId,data.evidenceReference,actor.userId,actor.role],
    );
    return { ok: true, status: "disabled" as const };
  });

export const requestIntegrationReplay = createServerFn({ method: "POST" })
  .validator(z.object({ outboxId: id, reason: ref, evidenceReference: ref }))
  .handler(async ({ data }) => {
    const actor = await requireIntegrationAdmin("edit");
    const sql = await getSql();
    const requestId = `INT-REPLAY-${crypto.randomUUID()}`;
    await sql.query(
      `select request_vyndi_integration_replay($1,$2,$3,$4,$5,$6)`,
      [requestId,data.outboxId,data.reason,data.evidenceReference,actor.userId,actor.role],
    );
    return { ok: true, requestId };
  });

export const approveIntegrationReplay = createServerFn({ method: "POST" })
  .validator(z.object({ requestId: id, evidenceReference: ref }))
  .handler(async ({ data }) => {
    const actor = await requireIntegrationAdmin("approve");
    const sql = await getSql();
    await sql.query(
      `select approve_vyndi_integration_replay($1,$2,$3,$4)`,
      [data.requestId,data.evidenceReference,actor.userId,actor.role],
    );
    return { ok: true, status: "approved" as const };
  });
