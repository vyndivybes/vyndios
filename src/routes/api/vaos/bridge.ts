import { createOntologyReadReceipt } from "@/lib/vaos-ontology-read-receipt";
import {A01_SINGLE_VENTURE_GUARD_CTE,assertSingleVentureSource} from "@/lib/vaos-single-venture-source-guard";
import { createFileRoute } from "@tanstack/react-router";
import { getSql } from "@/lib/db";
import {readEnterpriseBi} from "@/lib/vaos-enterprise-bi-read";
import {projectVedmAuthorityGraphForVaos} from "@/lib/vaos-knowledge-graph-export";
import { readVaosFinancialStatements } from "@/lib/finance/vaos-financial-statements-export";
import {classifyEngineeringBaselines, type BaselineSourceRow} from "@/lib/engineering-baseline-reconciliation";
import {normalizeVaosScheduleExport,validateScheduleProjectInput} from "@/lib/vaos-schedule-export";
import {
  sha256Hex,
  validateVaosBridgeSignedContext,
  verifyVaosBridgeSignature,
  VAOS_BRIDGE_MAX_SKEW_SECONDS,
} from "@/lib/vaos-bridge-auth";

const WRITE_QUALIFICATION_PROFILE = "COMMERCIAL_WRITE_CANARY_V1";

const READ_ACTIONS = new Set([
  "ORCHESTRATOR.OBSERVE_ENTERPRISE_BI",
  "KNOWLEDGE.OBSERVE_VEDM_GRAPH",
  "COMMERCIAL.OBSERVE_PIPELINE",
  "PROCUREMENT.OBSERVE_SHORTAGE",
  "PROCUREMENT.OBSERVE_OPEN_POS",
  "INVENTORY.OBSERVE_STOCK",
  "PRODUCTION.OBSERVE_WIP",
  "MAINTENANCE.OBSERVE_ASSET",
  "FINANCE.OBSERVE_LEDGER",
  "FINANCE.OBSERVE_STATEMENTS",
  "PEOPLE.OBSERVE_WORKFORCE",
  "ENGINEERING.OBSERVE_CONFIGURATION",
  "PROJECT.OBSERVE_SCHEDULE",
]);

const EXPECTED_EMPLOYEE: Record<string, string> = {
  "ORCHESTRATOR.OBSERVE_ENTERPRISE_BI": "orchestrator",
  "KNOWLEDGE.OBSERVE_VEDM_GRAPH": "engineering-configuration",
  "COMMERCIAL.OBSERVE_PIPELINE": "commercial",
  "PROCUREMENT.OBSERVE_SHORTAGE": "procurement",
  "PROCUREMENT.OBSERVE_OPEN_POS": "procurement",
  "INVENTORY.OBSERVE_STOCK": "inventory",
  "PRODUCTION.OBSERVE_WIP": "production",
  "MAINTENANCE.OBSERVE_ASSET": "maintenance",
  "FINANCE.OBSERVE_LEDGER": "finance",
  "FINANCE.OBSERVE_STATEMENTS": "finance",
  "PEOPLE.OBSERVE_WORKFORCE": "people",
  "ENGINEERING.OBSERVE_CONFIGURATION": "engineering-configuration",
  "PROJECT.OBSERVE_SCHEDULE": "project",
};

const SOURCE_AUTHORITY: Record<string, string> = {
  "ORCHESTRATOR.OBSERVE_ENTERPRISE_BI": "getEnterpriseBusinessIntelligence",
  "KNOWLEDGE.OBSERVE_VEDM_GRAPH": "compileVedmAuthorityGraph",
  "COMMERCIAL.OBSERVE_PIPELINE": "listSalesOrders",
  "PROCUREMENT.OBSERVE_SHORTAGE": "getConfiguredDemandShortages",
  "PROCUREMENT.OBSERVE_OPEN_POS": "listOpenPurchaseOrders",
  "INVENTORY.OBSERVE_STOCK": "getAuthoritativeInventory",
  "PRODUCTION.OBSERVE_WIP": "getProductionJobCards",
  "MAINTENANCE.OBSERVE_ASSET": "getAssetMaintenanceState",
  "FINANCE.OBSERVE_LEDGER": "getAccountingWorkbench",
  "FINANCE.OBSERVE_STATEMENTS": "buildFinancialStatements",
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
  if (actionType === "KNOWLEDGE.OBSERVE_VEDM_GRAPH") {
    // Repository-pinned engineering authority graph; never current ERP release authority.
    return projectVedmAuthorityGraphForVaos(new Date().toISOString().slice(0,10));
  }
  if (actionType === "ORCHESTRATOR.OBSERVE_ENTERPRISE_BI") return readEnterpriseBi(sql,input);

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
    // One statement gives the bounded page and source count the same SQL snapshot.
    const [snapshot] = await sql.query<{source_count: number; records: unknown[]; extracted_at: string; venture_count:number}>(
      `WITH ${A01_SINGLE_VENTURE_GUARD_CTE}, eligible AS MATERIALIZED (
         SELECT job_card_id,job_card_line_id,sales_order_id,product_label,variant_id,
                units,due_month,sku,category,item,required_quantity,
                physical_quantity AS available_quantity,reserved_quantity,
                shortage_quantity,available_to_promise,unit,bom_revision,sales_order_revision
           from vyndi_live_job_card_requirements
          where job_card_status in ('released','in_progress')
            and sku is not null and shortage_quantity > 0
       ), page AS (
         SELECT * FROM eligible ORDER BY due_month,shortage_quantity DESC,sku,job_card_line_id limit $1
       )
       SELECT (SELECT count(*)::integer FROM eligible) AS source_count,
              (SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.due_month,p.shortage_quantity DESC,p.sku,p.job_card_line_id),'[]'::jsonb) FROM page p) AS records,
              (SELECT venture_count FROM venture_guard) AS venture_count,
              transaction_timestamp() AS extracted_at`,
      [limit],
    );
    assertSingleVentureSource(snapshot?.venture_count);
    if (!snapshot || !Array.isArray(snapshot.records)) throw Error("VYNDI_ONTOLOGY_SHORTAGE_SOURCE_INVALID");
    return createOntologyReadReceipt({sourceKind:"shortages",records:snapshot.records,
      sourceCount:Number(snapshot.source_count),limit,asOf:new Date(snapshot.extracted_at).toISOString()});
  }

  if (actionType === "PROCUREMENT.OBSERVE_OPEN_POS") {
    // One SQL snapshot: deterministic bounded page and exact scoped row count.
    const [snapshot] = await sql.query<{source_count:number;records:unknown[];extracted_at:string}>(
      `WITH eligible AS MATERIALIZED (
         SELECT p.id,p.supplier_id,p.source_action_id,p.requirement_month,p.sku,p.unit,
                p.quantity,p.unit_price_inr,p.order_date,p.expected_receipt_on,
                p.payment_terms_days,p.status,p.source_reference,p.job_card_id,
                p.record_revision,p.created_at,p.updated_at,
                j.status AS job_card_status,s.status AS sales_order_status,
                CASE WHEN j.status='cancelled' OR s.status='cancelled'
                  THEN 'CANCELLED_UPSTREAM_DEMAND'
                  ELSE 'UPSTREAM_DEMAND_UNVERIFIED' END AS demand_lineage_state
           FROM vyndi_purchase_orders p
           LEFT JOIN epr_production_job_cards j ON j.id=p.job_card_id
           LEFT JOIN vyndi_sales_orders s ON s.id=j.sales_order_id
          WHERE p.status IN ('draft','pending_approval','approved','issued','part_received')
       ), page AS (
         SELECT * FROM eligible ORDER BY updated_at DESC,id LIMIT $1
       )
       SELECT (SELECT count(*)::integer FROM eligible) AS source_count,
              (SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.updated_at DESC,p.id),'[]'::jsonb) FROM page p) AS records,
              transaction_timestamp() AS extracted_at`,
      [limit],
    );
    if (!snapshot || !Array.isArray(snapshot.records)) throw Error("VYNDI_ONTOLOGY_PO_SOURCE_INVALID");
    return createOntologyReadReceipt({sourceKind:"purchaseOrders",records:snapshot.records,
      sourceCount:Number(snapshot.source_count),limit,asOf:new Date(snapshot.extracted_at).toISOString()});
  }
  if (actionType === "INVENTORY.OBSERVE_STOCK") {
    const [snapshot] = await sql.query<{source_count: number; records: unknown[]; extracted_at: string; venture_count:number}>(
      `WITH ${A01_SINGLE_VENTURE_GUARD_CTE}, eligible AS MATERIALIZED (
         SELECT sku,unit,quantity_balance,inventory_value_inr,weighted_average_cost_inr,
                first_movement_at,last_movement_at FROM vyndi_inventory_balance
       ), page AS (
         SELECT * FROM eligible ORDER BY sku,unit limit $1
       )
       SELECT (SELECT count(*)::integer FROM eligible) AS source_count,
              (SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.sku,p.unit),'[]'::jsonb) FROM page p) AS records,
              (SELECT venture_count FROM venture_guard) AS venture_count,
              transaction_timestamp() AS extracted_at`,
      [limit],
    );
    assertSingleVentureSource(snapshot?.venture_count);
    if (!snapshot || !Array.isArray(snapshot.records)) throw Error("VYNDI_ONTOLOGY_INVENTORY_SOURCE_INVALID");
    return createOntologyReadReceipt({sourceKind:"inventory",records:snapshot.records,
      sourceCount:Number(snapshot.source_count),limit,asOf:new Date(snapshot.extracted_at).toISOString()});
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

  if (actionType === "FINANCE.OBSERVE_STATEMENTS") {
    return readVaosFinancialStatements(sql, input);
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
    const [changeOrders, baselines, bomReleases, manifests] = await Promise.all([
      sql.query<{ record: unknown }>(
        "select to_jsonb(e) as record from vyndi_engineering_change_orders e order by e.updated_at desc limit $1",
        [limit],
      ),
      sql.query<{ record: BaselineSourceRow }>(
        "select to_jsonb(b) as record from vyndi_engineering_baselines b order by b.updated_at desc limit $1",
        [limit],
      ),
      sql.query<{ id:string;bom_revision:string }>(
        "select id,bom_revision from vyndi_bom_revision_releases order by released_at desc limit $1",[limit]
      ),
      sql.query<{ baseline_id:string;bom_release_id:string|null;finalized:boolean }>(
        "select baseline_id,bom_release_id,finalized from vyndi_engineering_configuration_manifests order by created_at desc limit $1",[limit]
      ),
    ]);
    const dispositions=classifyEngineeringBaselines({
      baselines:baselines.map(row=>row.record),bomReleases,manifests
    });
    return {
      changeOrders: changeOrders.map((row) => row.record),
      baselines: baselines.map((row,index) => ({
        ...row.record,
        release_disposition:dispositions[index].releaseDisposition,
        record_origin:dispositions[index].recordOrigin,
        bom_link_qualified:dispositions[index].bomLinkQualified,
        production_release_qualified:false,
      })),
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
        if (purpose === "write-execute") {
          return json({ ok: false, error: "write_execution_not_commissioned" }, 403);
        }

        const expectedPurpose = purpose === "write-qualify" ? "write-qualify" : "read-observe";
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
        let data: Awaited<ReturnType<typeof executeRead>>;
        try{
          data = await executeRead(sql, actionType, boundedLimit(input.limit), input);
        }catch(error){
          if(error instanceof Error && error.message === "VYNDI_ONTOLOGY_VENTURE_SCOPE_UNVERIFIED"){
            return json({ok:false,error:"source_venture_scope_unverified"},409);
          }
          throw error;
        }

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
