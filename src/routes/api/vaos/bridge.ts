import { createFileRoute } from "@tanstack/react-router";
import { getSql } from "@/lib/db";
import {
  sha256Hex,
  verifyVaosBridgeSignature,
  VAOS_BRIDGE_MAX_SKEW_SECONDS,
} from "@/lib/vaos-bridge-auth";

const READ_ACTIONS = new Set([
  "COMMERCIAL.OBSERVE_PIPELINE",
  "PROCUREMENT.OBSERVE_SHORTAGE",
  "INVENTORY.OBSERVE_STOCK",
  "PRODUCTION.OBSERVE_WIP",
  "MAINTENANCE.OBSERVE_ASSET",
  "FINANCE.OBSERVE_LEDGER",
  "PEOPLE.OBSERVE_WORKFORCE",
  "ENGINEERING.OBSERVE_CONFIGURATION",
]);

const SOURCE_AUTHORITY: Record<string, string> = {
  "COMMERCIAL.OBSERVE_PIPELINE": "listSalesOrders",
  "PROCUREMENT.OBSERVE_SHORTAGE": "getConfiguredDemandShortages",
  "INVENTORY.OBSERVE_STOCK": "getAuthoritativeInventory",
  "PRODUCTION.OBSERVE_WIP": "getProductionJobCards",
  "MAINTENANCE.OBSERVE_ASSET": "getAssetMaintenanceState",
  "FINANCE.OBSERVE_LEDGER": "getAccountingWorkbench",
  "PEOPLE.OBSERVE_WORKFORCE": "listPeopleOfficeAuthority",
  "ENGINEERING.OBSERVE_CONFIGURATION": "getEngineeringChangeControlState",
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
) {
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

        const payload = JSON.parse(bodyText || "{}") as Record<string, unknown>;
        const actionType = String(payload.actionType ?? "").trim();
        if (!READ_ACTIONS.has(actionType)) {
          return json({ ok: false, error: "action_not_commissioned" }, 403);
        }

        const sql = await getSql();
        const timestampMs = Number(timestamp.length === 10 ? Number(timestamp) * 1000 : Number(timestamp));
        const expiresAt = new Date(timestampMs + VAOS_BRIDGE_MAX_SKEW_SECONDS * 1000).toISOString();
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
        const data = await executeRead(sql, actionType, boundedLimit(input.limit));

        return json({
          ok: true,
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
