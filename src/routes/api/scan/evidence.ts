import { createFileRoute } from "@tanstack/react-router";
import { requireBusinessActor } from "@/lib/business-actor";
import { UnauthorizedError } from "@/lib/auth/verify.server";
import { getSql } from "@/lib/db";
import { canAccessRoute } from "@/lib/page-access";
import { scanRouteForKind, type UniversalScanTargetType } from "@/lib/universal-scan";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const TARGET_TYPES = new Set<UniversalScanTargetType>([
  "sales_order",
  "job_card",
  "traveller",
  "purchase_order",
  "grn",
  "inventory_item",
  "quality_ncr",
  "quality_capa",
  "equipment",
  "maintenance_work_order",
]);
const DOCUMENT_TYPES = new Set([
  "certificate",
  "inspection_report",
  "invoice",
  "receipt",
  "delivery_document",
  "photo",
  "other",
]);
const SOURCE_KINDS = new Set(["document_scan", "camera_capture", "file_upload"]);
const MIME_TYPES = new Set(["application/pdf", "image/jpeg", "image/png"]);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function authError() {
  return json({ ok: false, error: "authentication_required" }, 401);
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

function detectedMime(bytes: Uint8Array): string | null {
  if (bytes.length >= 5
      && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d) {
    return "application/pdf";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8
      && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
      && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
    return "image/png";
  }
  return null;
}

function safeFilename(value: string) {
  const cleaned = value.replace(/[\r\n"]/g, "_").trim().slice(0, 240);
  return cleaned || "scan-evidence";
}

function hex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes), (value) => value.toString(16).padStart(2, "0")).join("");
}

function hexBytes(value: string): Uint8Array {
  const hexValue = value.startsWith("\\x") ? value.slice(2) : value;
  if (hexValue.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(hexValue)) throw new Error("Invalid bytea hex payload.");
  const bytes = new Uint8Array(hexValue.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hexValue.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function responseArrayBuffer(value: unknown): ArrayBuffer {
  let source: Uint8Array;
  if (value instanceof Uint8Array) source = value;
  else if (value instanceof ArrayBuffer) return value.slice(0);
  else if (ArrayBuffer.isView(value)) source = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  else if (typeof value === "string" && value.startsWith("\\x")) source = hexBytes(value);
  else throw new Error("Unsupported scan-evidence byte payload.");
  const copy = new Uint8Array(source.byteLength);
  copy.set(source);
  return copy.buffer;
}

async function targetExists(
  sql: Awaited<ReturnType<typeof getSql>>,
  targetType: UniversalScanTargetType,
  targetId: string,
) {
  switch (targetType) {
    case "sales_order":
      return Boolean((await sql.query("select id from vyndi_sales_orders where id=$1 limit 1", [targetId]))[0]);
    case "job_card":
      return Boolean((await sql.query("select id from epr_production_job_cards where id=$1 limit 1", [targetId]))[0]);
    case "traveller":
      return Boolean((await sql.query("select id from epr_travellers where id=$1 limit 1", [targetId]))[0]);
    case "purchase_order":
      return Boolean((await sql.query("select id from vyndi_purchase_orders where id=$1 limit 1", [targetId]))[0]);
    case "grn":
      return Boolean((await sql.query("select id from vyndi_goods_receipts where id=$1 limit 1", [targetId]))[0]);
    case "inventory_item":
      return Boolean((await sql.query("select id from master_inventory_items where id=$1 limit 1", [targetId]))[0]);
    case "quality_ncr":
      return Boolean((await sql.query("select id from vyndi_quality_ncrs where id=$1 limit 1", [targetId]))[0]);
    case "quality_capa":
      return Boolean((await sql.query("select id from vyndi_quality_capas where id=$1 limit 1", [targetId]))[0]);
    case "equipment":
      return Boolean((await sql.query("select id from epr_equipment where id=$1 limit 1", [targetId]))[0]);
    case "maintenance_work_order":
      return Boolean((await sql.query("select id from vyndi_maintenance_work_orders where id=$1 limit 1", [targetId]))[0]);
  }
}

function targetType(value: FormDataEntryValue | null): UniversalScanTargetType | null {
  const candidate = String(value ?? "").trim() as UniversalScanTargetType;
  return TARGET_TYPES.has(candidate) ? candidate : null;
}

export const Route = createFileRoute("/api/scan/evidence")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        let actor;
        try {
          actor = await requireBusinessActor("view");
        } catch (error) {
          if (error instanceof UnauthorizedError || (error instanceof Error && error.message === "Unauthorized")) return authError();
          throw error;
        }

        const attachmentId = new URL(request.url).searchParams.get("attachmentId")?.trim();
        if (!attachmentId) return json({ ok: false, error: "attachment_id_required" }, 400);

        const sql = await getSql();
        const metaRows = await sql.query<{
          id: string;
          target_type: UniversalScanTargetType;
          target_id: string;
          file_name: string;
          mime_type: string;
          file_size_bytes: number;
          sha256_hex: string;
        }>(
          "select id,target_type,target_id,file_name,mime_type,file_size_bytes,sha256_hex from vyndi_scan_evidence_attachments where id=$1",
          [attachmentId],
        );
        const meta = metaRows[0];
        if (!meta) return json({ ok: false, error: "attachment_not_found" }, 404);
        const route = scanRouteForKind(meta.target_type);
        if (!route || !canAccessRoute(actor.role, route)) return json({ ok: false, error: "forbidden" }, 403);

        const rows = await sql.query<{ content_bytes: unknown }>(
          "select content_bytes from vyndi_scan_evidence_attachments where id=$1",
          [attachmentId],
        );
        const bytes = responseArrayBuffer(rows[0]?.content_bytes);
        return new Response(bytes, {
          status: 200,
          headers: {
            "content-type": meta.mime_type,
            "content-length": String(meta.file_size_bytes),
            "content-disposition": `inline; filename="${safeFilename(meta.file_name)}"`,
            "cache-control": "private, no-store",
            "x-content-type-options": "nosniff",
            "x-vyndi-evidence-sha256": meta.sha256_hex,
          },
        });
      },

      POST: async ({ request }) => {
        let actor;
        try {
          actor = await requireBusinessActor("edit");
        } catch (error) {
          if (error instanceof UnauthorizedError || (error instanceof Error && error.message === "Unauthorized")) return authError();
          throw error;
        }
        if (!sameOrigin(request)) return json({ ok: false, error: "origin_not_allowed" }, 403);

        const form = await request.formData();
        const resolvedTargetType = targetType(form.get("targetType"));
        const targetId = String(form.get("targetId") ?? "").trim().slice(0, 160);
        const documentType = String(form.get("documentType") ?? "").trim();
        const sourceKind = String(form.get("sourceKind") ?? "").trim();
        const file = form.get("file");

        if (!resolvedTargetType) return json({ ok: false, error: "invalid_target_type" }, 400);
        if (!targetId) return json({ ok: false, error: "target_id_required" }, 400);
        if (!DOCUMENT_TYPES.has(documentType)) return json({ ok: false, error: "invalid_document_type" }, 400);
        if (!SOURCE_KINDS.has(sourceKind)) return json({ ok: false, error: "invalid_source_kind" }, 400);
        if (!(file instanceof File)) return json({ ok: false, error: "file_required" }, 400);
        if (file.size <= 0) return json({ ok: false, error: "empty_file" }, 400);
        if (file.size > MAX_FILE_BYTES) return json({ ok: false, error: "file_too_large", maxBytes: MAX_FILE_BYTES }, 413);

        const route = scanRouteForKind(resolvedTargetType);
        if (!route || !canAccessRoute(actor.role, route)) return json({ ok: false, error: "forbidden" }, 403);

        const raw = await file.arrayBuffer();
        const bytes = new Uint8Array(raw);
        const mimeType = detectedMime(bytes);
        if (!mimeType || !MIME_TYPES.has(mimeType)) return json({ ok: false, error: "unsupported_file_type" }, 415);
        if (file.type && file.type !== mimeType) {
          return json({ ok: false, error: "mime_signature_mismatch", declared: file.type, detected: mimeType }, 415);
        }

        const sql = await getSql();
        if (!(await targetExists(sql, resolvedTargetType, targetId))) {
          return json({ ok: false, error: "target_not_found" }, 404);
        }

        const sha256Hex = hex(await crypto.subtle.digest("SHA-256", raw));
        const duplicate = await sql.query<{ id: string }>(
          "select id from vyndi_scan_evidence_attachments where target_type=$1 and target_id=$2 and sha256_hex=$3",
          [resolvedTargetType, targetId, sha256Hex],
        );
        if (duplicate[0]) {
          return json({ ok: false, error: "duplicate_evidence", attachmentId: duplicate[0].id, sha256Hex }, 409);
        }

        const id = `SCANEVID-${crypto.randomUUID()}`;
        const fileName = safeFilename(file.name);
        await sql.query(
          `insert into vyndi_scan_evidence_attachments(
             id,target_type,target_id,document_type,source_kind,file_name,mime_type,
             file_size_bytes,sha256_hex,content_bytes,captured_by,captured_role)
           values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [id,resolvedTargetType,targetId,documentType,sourceKind,fileName,mimeType,file.size,sha256Hex,bytes,actor.userId,actor.role],
        );
        await sql.query(
          `insert into vyndi_audit_events(
             id,entity_type,entity_id,action,actor_user_id,actor_role,source_reference,payload_json)
           values($1,'scan_evidence_attachment',$2,'SCAN_EVIDENCE_ATTACHED',$3,$4,$5,$6::jsonb)`,
          [
            `AUD-SCAN-${crypto.randomUUID()}`,
            id,
            actor.userId,
            actor.role,
            `${resolvedTargetType}:${targetId}`,
            JSON.stringify({ targetType: resolvedTargetType, targetId, documentType, sourceKind, fileName, mimeType, fileSizeBytes: file.size, sha256Hex }),
          ],
        );

        return json({
          ok: true,
          attachmentId: id,
          targetType: resolvedTargetType,
          targetId,
          documentType,
          sourceKind,
          fileName,
          mimeType,
          fileSizeBytes: file.size,
          sha256Hex,
        }, 201);
      },
    },
  },
});
