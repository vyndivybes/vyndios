import { createFileRoute } from "@tanstack/react-router";
import { getSql } from "@/lib/db";
import {normalizeVaosScheduleExport,validateScheduleProjectInput} from "@/lib/vaos-schedule-export";
import {
  sha256Hex,
  validateVaosBridgeSignedContext,
  verifyVaosBridgeSignature,
  VAOS_BRIDGE_MAX_SKEW_SECONDS,
} from "@/lib/vaos-bridge-auth";

const WRITE_QUALIFICATION_PROFILE = "COMMERCIAL_WRITE_CANARY_V1";
const OPERATIONAL_WRITE_PROFILE = "PEOPLE_DRAFT_MASTER_V1";

const READ_ACTIONS = new Set([
  "COMMERCIAL.OBSERVE_PIPELINE",
  "PROCUREMENT.OBSERVE_SHORTAGE",
  "INVENTORY.OBSERVE_STOCK",
  "PRODUCTION.OBSERVE_WIP",
  "MAINTENANCE.OBSERVE_ASSET",
  "FINANCE.OBSERVE_LEDGER",
  "PEOPLE.OBSERVE_WORKFORCE",
  "ENGINEERING.OBSERVE_CONFIGURATION",
  "PROJECT.OBSERVE_SCHEDULE",
]);

const EXPECTED_EMPLOYEE: Record<string, string> = {
  "COMMERCIAL.OBSERVE_PIPELINE": "commercial",
  "PROCUREMENT.OBSERVE_SHORTAGE": "procurement",
  "INVENTORY.OBSERVE_STOCK": "inventory",
  "PRODUCTION.OBSERVE_WIP": "production",
  "MAINTENANCE.OBSERVE_ASSET": "maintenance",
  "FINANCE.OBSERVE_LEDGER": "finance",
  "PEOPLE.OBSERVE_WORKFORCE": "people",
  "ENGINEERING.OBSERVE_CONFIGURATION": "engineering-configuration",
  "PROJECT.OBSERVE_SCHEDULE": "project",
};

const SOURCE_AUTHORITY: Record<string, string> = {
  "COMMERCIAL.OBSERVE_PIPELINE": "listSalesOrders",
  "PROCUREMENT.OBSERVE_SHORTAGE": "getConfiguredDemandShortages",
  "INVENTORY.OBSERVE_STOCK": "getAuthoritativeInventory",
  "PRODUCTION.OBSERVE_WIP": "getProductionJobCards",
  "MAINTENANCE.OBSERVE_ASSET": "getAssetMaintenanceState",
  "FINANCE.OBSERVE_LEDGER": "getAccountingWorkbench",
  "PEOPLE.OBSERVE_WORKFORCE": "listPeopleOfficeAuthority",
  "ENGINEERING.OBSERVE_CONFIGURATION": "getEngineeringChangeControlState",
  "PROJECT.OBSERVE_SCHEDULE": "readGovernedProgramSchedule",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function boundedLimit(value: unknown) {
  const candidate = Number(value ?? 50);
  if (!Number.isInteger(candidate)) return 50;
  return Math.max(1, Math.min(100, candidate));
}

async function executeRead(
  sql: Awaited<ReturnType<typeof getSql>>,
  actionType: string,
  limit: number,
  input: Record<string, unknown> = {},
) {
  if (actionType === "PROJECT.OBSERVE_SCHEDULE") {
    const {projectId}=validateScheduleProjectInput(input);
    const rows=await sql.query<{record:Record<string,unknown>;captured_at:string}>(
      `select to_jsonb(t) as record, current_timestamp as captured_at
         from vyndi_program_tasks t where t.program_id=$1
         order by t.id limit $2`,
      [projectId,limit],
    );
    const capturedAt=rows.length?new Date(rows[0].captured_at).toISOString():new Date().toISOString();
    return normalizeVaosScheduleExport({projectId,capturedAt,records:rows.map(row=>row.record)});
  }

  if (actionType === "COMMERCIAL.OBSERVE_PIPELINE") {
    const rows = await sql.query<{ record: unknown }>(
      "select to_jsonb(s) as record from vyndi_sales_orders s order by s.updated_at desc limit $1",
      [limit],
    );
    return { records: rows.map((row) => row.record) };
  }

  if (actionType === "PROCUREMENT.OBSERVE_SHORTAGE") {
    const rows = await sql.query<{ record: unknown }>(
      `select to_jsonb(l) as record
         from epr_production_job_card_lines l
        where l.shortage_quantity > 0
        order by l.shortage_quantity desc,l.created_at desc
        limit $1`,
      [limit],
    );
    return { records: rows.map((row) => row.record) };
  }

  if (actionType === "INVENTORY.OBSERVE_STOCK") {
    const rows = await sql.query<{ record: unknown }>(
      "select to_jsonb(v) as record from vyndi_inventory_balance v limit $1",
      [limit],
    );
    return { records: rows.map((row) => row.record) };
  }

  if (actionType === "PRODUCTION.OBSERVE_WIP") {
    const rows = await sql.query<{ record: unknown }>(
      "select to_jsonb(j) as record from epr_production_job_cards j order by j.created_at desc limit $1",
      [limit],
    );
    return { records: rows.map((row) => row.record) };
  }

  if (actionType === "MAINTENANCE.OBSERVE_ASSET") {
    const [equipment, workOrders] = await Promise.all([
      sql.query<{ record: unknown }>("select to_jsonb(e) as record from epr_equipment e limit $1", [limit]),
      sql.query<{ record: unknown }>("select to_jsonb(w) as record from vyndi_maintenance_work_orders w limit $1", [limit]),
    ]);
    return {
      equipment: equipment.map((row) => row.record),
      workOrders: workOrders.map((row) => row.record),
    };
  }

  if (actionType === "FINANCE.OBSERVE_LEDGER") {
    const [ledger, journals] = await Promise.all([
      sql.query<{ record: unknown }>("select to_jsonb(g) as record from epr_finance_general_ledger g limit $1", [limit]),
      sql.query<{ record: unknown }>("select to_jsonb(j) as record from epr_finance_journals j limit $1", [limit]),
    ]);
    return {
      ledger: ledger.map((row) => row.record),
      journals: journals.map((row) => row.record),
    };
  }

  if (actionType === "PEOPLE.OBSERVE_WORKFORCE") {
    const [people, authority] = await Promise.all([
      sql.query<{ record: unknown }>("select to_jsonb(p) as record from vyndi_people_records p limit $1", [limit]),
      sql.query<{ record: unknown }>("select to_jsonb(a) as record from vyndi_people_office_authority_summary a limit $1", [limit]),
    ]);
    return {
      people: people.map((row) => row.record),
      authority: authority.map((row) => row.record),
    };
  }

  if (actionType === "ENGINEERING.OBSERVE_CONFIGURATION") {
    const [changeOrders, baselines] = await Promise.all([
      sql.query<{ record: unknown }>(
        "select to_jsonb(e) as record from vyndi_engineering_change_orders e order by e.updated_at desc limit $1",
        [limit],
      ),
      sql.query<{ record: unknown }>(
        "select to_jsonb(b) as record from vyndi_engineering_baselines b order by b.updated_at desc limit $1",
        [limit],
      ),
    ]);
    return {
      changeOrders: changeOrders.map((row) => row.record),
      baselines: baselines.map((row) => row.record),
    };
  }

  throw new Error("READ_ACTION_NOT_COMMISSIONED");
}

export const Route = createFileRoute("/api/vaos/bridge")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const keyId = request.headers.get("x-vaos-key-id")?.trim() ?? "";
        const timestamp = request.headers.get("x-vaos-timestamp")?.trim() ?? "";
        const nonce = request.headers.get("x-vaos-nonce")?.trim() ?? "";
        const signature = request.headers.get("x-vaos-signature")?.trim() ?? "";
        const declaredHash = request.headers.get("x-vaos-body-sha256")?.trim().toLowerCase() ?? "";

        const bodyText = await request.text();
        const bodySha256 = await sha256Hex(bodyText);
        if (!declaredHash || declaredHash !== bodySha256) {
          return json({ ok: false, error: "body_hash_mismatch" }, 401);
        }

        const signatureCheck = await verifyVaosBridgeSignature({
          keyId,
          timestamp,
          nonce,
          signature,
          bodySha256,
        });
        if (!signatureCheck.ok) {
          return json({ ok: false, error: signatureCheck.error }, 401);
        }

        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(bodyText || "{}") as Record<string, unknown>;
        } catch {
          return json({ ok: false, error: "invalid_json" }, 400);
        }

        const purpose = String(payload.purpose ?? "").trim();
        const expectedPurpose =
          purpose === "write-qualify"
            ? "write-qualify"
            : purpose === "write-execute"
              ? "write-execute"
              : "read-observe";
        const signedContext = validateVaosBridgeSignedContext({
          payload,
          requestMethod: request.method,
          requestPath: new URL(request.url).pathname,
          expectedPurpose,
        });
        if (!signedContext.ok) {
          return json({ ok: false, error: "signed_context_invalid" }, 401);
        }

        const actionType = String(payload.actionType ?? "").trim();
        const sql = await getSql();
        const timestampMs = Number(timestamp.length === 10 ? Number(timestamp) * 1000 : Number(timestamp));
        const expiresAt = new Date(timestampMs + VAOS_BRIDGE_MAX_SKEW_SECONDS * 1000).toISOString();

        if (purpose === "write-execute") {
          if (
            actionType !== "PEOPLE.CHANGE_EMPLOYEE_MASTER"
            || String(payload.employeeId ?? "").trim() !== "people"
            || payload.operationalWriteProfile !== OPERATIONAL_WRITE_PROFILE
          ) {
            return json({ ok: false, error: "operational_write_scope_denied" }, 403);
          }

          const executionJobId = String(payload.executionJobId ?? "").trim();
          const intentId = String(payload.intentId ?? "").trim();
          const approvalId = String(payload.approvalId ?? "").trim();
          const idempotencyKey = String(payload.idempotencyKey ?? "").trim();
          const requestedByHash = String(payload.requestedByHash ?? "").trim().toLowerCase();
          const approvedByHash = String(payload.approvedByHash ?? "").trim().toLowerCase();
          const input = payload.input && typeof payload.input === "object" && !Array.isArray(payload.input)
            ? payload.input as Record<string, unknown>
            : {};

          const expectedKeys = [
            "displayName","endMonth","engagementType","expectedRevision","functionName",
            "id","notes","roleTitle","sourceReference","startMonth",
          ].sort().join(",");
          const inputKeys = Object.keys(input).sort().join(",");
          const expectedRevision = Number(input.expectedRevision);
          const startMonth = input.startMonth == null ? null : Number(input.startMonth);
          const endMonth = input.endMonth == null ? null : Number(input.endMonth);
          const expectedSourceReference = `VAOS|${intentId}|${executionJobId}`;

          if (
            !executionJobId
            || !intentId
            || !approvalId
            || idempotencyKey.length < 4
            || idempotencyKey.length > 160
            || !/^[0-9a-f]{64}$/.test(requestedByHash)
            || !/^[0-9a-f]{64}$/.test(approvedByHash)
            || requestedByHash === approvedByHash
            || inputKeys !== expectedKeys
            || typeof input.id !== "string"
            || !input.id.trim()
            || !Number.isInteger(expectedRevision)
            || expectedRevision < 1
            || typeof input.displayName !== "string"
            || !input.displayName.trim()
            || typeof input.functionName !== "string"
            || !input.functionName.trim()
            || typeof input.roleTitle !== "string"
            || !input.roleTitle.trim()
            || !["employee","contractor","consultant","planned_role"].includes(String(input.engagementType ?? ""))
            || (startMonth !== null && (!Number.isInteger(startMonth) || startMonth < 1 || startMonth > 36))
            || (endMonth !== null && (!Number.isInteger(endMonth) || endMonth < 1 || endMonth > 36))
            || (startMonth !== null && endMonth !== null && endMonth < startMonth)
            || input.sourceReference !== expectedSourceReference
            || typeof input.notes !== "string"
          ) {
            return json({ ok: false, error: "operational_write_input_invalid" }, 422);
          }

          const claimed = await sql.query<{ claimed: boolean }>(
            "select claim_vyndi_vaos_bridge_nonce($1,$2,$3,$4,$5::timestamptz) as claimed",
            [nonce, keyId, bodySha256, actionType, expiresAt],
          );
          if (claimed[0]?.claimed !== true) {
            return json({ ok: false, error: "replay_detected" }, 409);
          }

          const rows = await sql.query<{ result: Record<string, unknown> }>(
            `select execute_vaos_people_master_draft_change(
              $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17
            ) as result`,
            [
              executionJobId,
              intentId,
              approvalId,
              idempotencyKey,
              requestedByHash,
              approvedByHash,
              OPERATIONAL_WRITE_PROFILE,
              String(input.id).trim(),
              expectedRevision,
              String(input.displayName),
              String(input.functionName),
              String(input.roleTitle),
              String(input.engagementType),
              startMonth,
              endMonth,
              String(input.sourceReference),
              String(input.notes),
            ],
          );
          const result = rows[0]?.result;
          if (
            !result
            || result.outcome !== "EXECUTED"
            || result.finalState !== "draft"
            || result.resourceId !== String(input.id).trim()
            || Number(result.initialRevision) !== expectedRevision
            || Number(result.finalRevision) <= expectedRevision
          ) {
            return json({ ok: false, error: "operational_write_verification_failed" }, 500);
          }

          return json({
            ok: true,
            protocolVersion: payload.protocolVersion,
            actionType,
            effectClass: "operational-mutation",
            sourceAuthority: "savePeopleRecordDraft",
            operationalWrite: true,
            operationalWriteProfile: OPERATIONAL_WRITE_PROFILE,
            readOnly: false,
            nonce,
            bodySha256,
            resourceId: result.resourceId,
            outcome: result.outcome,
            finalState: result.finalState,
            initialRevision: result.initialRevision,
            finalRevision: result.finalRevision,
            replay: result.replay === true,
          });
        }

        if (purpose === "write-qualify") {
          if (
            actionType !== "COMMERCIAL.COMMIT_ORDER"
            || String(payload.employeeId ?? "").trim() !== "commercial"
            || payload.qualificationProfile !== WRITE_QUALIFICATION_PROFILE
          ) {
            return json({ ok: false, error: "write_qualification_scope_denied" }, 403);
          }

          const executionJobId = String(payload.executionJobId ?? "").trim();
          const intentId = String(payload.intentId ?? "").trim();
          const approvalId = String(payload.approvalId ?? "").trim();
          const idempotencyKey = String(payload.idempotencyKey ?? "").trim();
          const requestedByHash = String(payload.requestedByHash ?? "").trim().toLowerCase();
          const approvedByHash = String(payload.approvedByHash ?? "").trim().toLowerCase();
          const input = payload.input && typeof payload.input === "object" && !Array.isArray(payload.input)
            ? payload.input as Record<string, unknown>
            : {};
          const canaryId = `VAOS-CANARY-SO-${executionJobId}`;
          const inputKeys = Object.keys(input).sort().join(",");
          const expectedKeys = ["aspLakh","channel","id","month","product","status","units"].sort().join(",");

          if (
            !executionJobId
            || !intentId
            || !approvalId
            || idempotencyKey.length < 4
            || idempotencyKey.length > 160
            || !/^[0-9a-f]{64}$/.test(requestedByHash)
            || !/^[0-9a-f]{64}$/.test(approvedByHash)
            || requestedByHash === approvedByHash
            || inputKeys !== expectedKeys
            || input.id !== canaryId
            || input.month !== 36
            || input.product !== "aluminium"
            || input.units !== 1
            || input.aspLakh !== 0
            || input.channel !== "direct"
            || input.status !== "lead"
          ) {
            return json({ ok: false, error: "write_qualification_input_invalid" }, 422);
          }

          const claimed = await sql.query<{ claimed: boolean }>(
            "select claim_vyndi_vaos_bridge_nonce($1,$2,$3,$4,$5::timestamptz) as claimed",
            [nonce, keyId, bodySha256, actionType, expiresAt],
          );
          if (claimed[0]?.claimed !== true) {
            return json({ ok: false, error: "replay_detected" }, 409);
          }

          const rows = await sql.query<{ result: Record<string, unknown> }>(
            "select qualify_vaos_commercial_write_canary($1,$2,$3,$4,$5,$6,$7,$8) as result",
            [
              executionJobId,
              intentId,
              approvalId,
              idempotencyKey,
              requestedByHash,
              approvedByHash,
              canaryId,
              WRITE_QUALIFICATION_PROFILE,
            ],
          );
          const result = rows[0]?.result;
          if (
            !result
            || result.outcome !== "COMPENSATED"
            || result.finalState !== "cancelled"
            || result.canaryId !== canaryId
          ) {
            return json({ ok: false, error: "write_qualification_verification_failed" }, 500);
          }

          return json({
            ok: true,
            protocolVersion: payload.protocolVersion,
            actionType,
            effectClass: "qualification-mutation",
            sourceAuthority: "saveSalesOrder",
            qualificationOnly: true,
            qualificationProfile: WRITE_QUALIFICATION_PROFILE,
            readOnly: false,
            nonce,
            bodySha256,
            canaryId,
            outcome: result.outcome,
            finalState: result.finalState,
            initialRevision: result.initialRevision,
            finalRevision: result.finalRevision,
          });
        }

        if (!READ_ACTIONS.has(actionType)) {
          return json({ ok: false, error: "action_not_commissioned" }, 403);
        }
        if (String(payload.employeeId ?? "").trim() !== EXPECTED_EMPLOYEE[actionType]) {
          return json({ ok: false, error: "employee_context_mismatch" }, 403);
        }

        const claimed = await sql.query<{ claimed: boolean }>(
          "select claim_vyndi_vaos_bridge_nonce($1,$2,$3,$4,$5::timestamptz) as claimed",
          [nonce, keyId, bodySha256, actionType, expiresAt],
        );
        if (claimed[0]?.claimed !== true) {
          return json({ ok: false, error: "replay_detected" }, 409);
        }

        const input = payload.input && typeof payload.input === "object" && !Array.isArray(payload.input)
          ? payload.input as Record<string, unknown>
          : {};
        const data = await executeRead(sql, actionType, boundedLimit(input.limit), input);

        return json({
          ok: true,
          protocolVersion: payload.protocolVersion,
          actionType,
          effectClass: "read",
          sourceAuthority: SOURCE_AUTHORITY[actionType],
          readOnly: true,
          nonce,
          bodySha256,
          data,
        });
      },
    },
  },
});
