import { createFileRoute } from "@tanstack/react-router";
import { requireBusinessActor } from "@/lib/business-actor";
import { UnauthorizedError } from "@/lib/auth/verify.server";
import { getSql } from "@/lib/db";

const LOCAL_WORKBENCH_ORIGINS = new Set([
  "http://127.0.0.1:8793",
  "http://localhost:8793",
]);

function allowedOrigin(request: Request): string | null {
  const origin = request.headers.get("origin");
  if (!origin) return null;
  if (LOCAL_WORKBENCH_ORIGINS.has(origin)) return origin;
  try {
    const req = new URL(request.url);
    if (origin === req.origin) return origin;
  } catch {
    return null;
  }
  return null;
}

function corsHeaders(request: Request): Record<string,string> {
  const origin = allowedOrigin(request);
  return origin ? {
    "access-control-allow-origin": origin,
    "access-control-allow-credentials": "true",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "vary": "Origin",
  } : {};
}

function json(request: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...corsHeaders(request),
    },
  });
}

function authError(request: Request) {
  return json(request, { ok: false, error: "authentication_required" }, 401);
}

function parsePacket(payload: Record<string, unknown>) {
  const schema = String(payload.schema ?? "");
  const configurationId = String(payload.configurationId ?? "").trim().slice(0, 160);
  const revision = String(payload.revision ?? "").trim().slice(0, 160);
  const fingerprint = String(payload.fingerprint ?? "").trim().slice(0, 80);
  const releaseAuthority = String(payload.releaseAuthority ?? "").trim().slice(0, 120);
  const authorityNodeId = payload.authorityNodeId ? String(payload.authorityNodeId).trim().slice(0, 200) : null;
  const authoritySourceCommit = payload.authoritySourceCommit ? String(payload.authoritySourceCommit).trim().slice(0, 80) : null;
  const readiness = payload.readiness && typeof payload.readiness === "object"
    ? payload.readiness as Record<string, unknown>
    : null;
  const readinessStatus = readiness ? String(readiness.status ?? "").trim().slice(0, 120) : null;

  const errors: string[] = [];
  if (schema !== "VYNDI_ENGINEERING_EVIDENCE_V1") errors.push("unsupported_schema");
  if (!configurationId) errors.push("configuration_id_required");
  if (!revision) errors.push("revision_required");
  if (!/^fnv1a32-[0-9a-f]{8}$/i.test(fingerprint)) errors.push("invalid_fingerprint");
  if (releaseAuthority !== "HUMAN_APPROVAL_REQUIRED") errors.push("invalid_release_authority");
  if (Boolean(authorityNodeId) !== Boolean(authoritySourceCommit)) errors.push("authority_provenance_pair_required");
  if (authoritySourceCommit && !/^[0-9a-f]{40}$/i.test(authoritySourceCommit)) errors.push("invalid_authority_source_commit");

  // Receipt ingestion is never evidence acceptance. Human evidence acceptance is
  // recorded separately by R3-C after maker/checker review.
  return { schema, configurationId, revision, fingerprint, releaseAuthority, readinessStatus, authorityNodeId, authoritySourceCommit, errors };
}

export const Route = createFileRoute("/api/engineering/evidence")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => {
        if (!allowedOrigin(request)) return new Response(null, { status: 403 });
        return new Response(null, { status: 204, headers: corsHeaders(request) });
      },
      GET: async ({ request }) => {
        let actor;
        try {
          actor = await requireBusinessActor("view");
        } catch (error) {
          if (error instanceof UnauthorizedError || (error instanceof Error && error.message === "Unauthorized")) {
            return authError(request);
          }
          throw error;
        }
        const sql = await getSql();
        const rows = await sql.query(
          `select id,fingerprint,schema_id,configuration_id,revision,readiness_status,
                  release_authority,actor_user_id,actor_role,source_origin,received_at
             from vyndi_engineering_evidence_receipts
            order by received_at desc
            limit 100`,
        );
        return json(request, { ok: true, actor: { userId: actor.userId, role: actor.role }, receipts: rows });
      },
      POST: async ({ request }) => {
        let actor;
        try {
          actor = await requireBusinessActor("edit");
        } catch (error) {
          if (error instanceof UnauthorizedError || (error instanceof Error && error.message === "Unauthorized")) {
            return authError(request);
          }
          throw error;
        }

        if (request.headers.get("origin") && !allowedOrigin(request)) {
          return json(request, { ok: false, error: "origin_not_allowed" }, 403);
        }

        const payload = (await request.json().catch(() => null)) as Record<string, unknown> | null;
        if (!payload) return json(request, { ok: false, error: "invalid_json" }, 400);

        const parsed = parsePacket(payload);
        if (parsed.errors.length) {
          return json(request, { ok: false, error: "invalid_engineering_evidence", details: parsed.errors }, 400);
        }

        const sql = await getSql();
        const existing = await sql.query<{id:string; received_at:string}>(
          "select id,received_at from vyndi_engineering_evidence_receipts where fingerprint=$1",
          [parsed.fingerprint],
        );
        if (existing[0]) {
          return json(request, {
            ok: true,
            duplicate: true,
            receiptId: existing[0].id,
            fingerprint: parsed.fingerprint,
            receivedAt: existing[0].received_at,
          }, 200);
        }

        const id = `ENG-EVID-${crypto.randomUUID()}`;
        const origin = request.headers.get("origin")?.slice(0, 240) || null;
        await sql.query(
          `insert into vyndi_engineering_evidence_receipts
            (id,fingerprint,schema_id,configuration_id,revision,readiness_status,
             release_authority,authority_node_id,authority_source_commit,
             actor_user_id,actor_role,source_origin,payload_json)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)`,
          [
            id,
            parsed.fingerprint,
            parsed.schema,
            parsed.configurationId,
            parsed.revision,
            parsed.readinessStatus,
            parsed.releaseAuthority,
            parsed.authorityNodeId,
            parsed.authoritySourceCommit,
            actor.userId,
            actor.role,
            origin,
            JSON.stringify(payload),
          ],
        );

        return json(request, {
          ok: true,
          duplicate: false,
          receiptId: id,
          fingerprint: parsed.fingerprint,
          configurationId: parsed.configurationId,
          revision: parsed.revision,
          readinessStatus: parsed.readinessStatus,
          releaseAuthority: parsed.releaseAuthority,
          authorityNodeId: parsed.authorityNodeId,
          authoritySourceCommit: parsed.authoritySourceCommit,
          evidenceAcceptance: "HUMAN_APPROVAL_REQUIRED",
        }, 201);
      },
    },
  },
});
