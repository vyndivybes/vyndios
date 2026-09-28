import { createFileRoute } from "@tanstack/react-router";
import { requireBusinessActor } from "@/lib/business-actor";
import { UnauthorizedError } from "@/lib/auth/verify.server";
import { getSql } from "@/lib/db";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const DOCUMENT_TYPES = new Set(["invoice", "receipt", "payment_evidence", "statement", "other"]);
const MIME_TYPES = new Set(["application/pdf", "image/jpeg", "image/png"]);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
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
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (bytes.length >= 8
      && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
      && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
    return "image/png";
  }
  return null;
}

function hex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes), (value) => value.toString(16).padStart(2, "0")).join("");
}

function safeFilename(value: string) {
  const cleaned = value.replace(/[\r\n"]/g, "_").trim().slice(0, 240);
  return cleaned || "evidence";
}

function hexBytes(value: string): Uint8Array {
  const hexValue = value.startsWith("\\x") ? value.slice(2) : value;
  if (hexValue.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(hexValue)) {
    throw new Error("Invalid bytea hex payload.");
  }
  const bytes = new Uint8Array(hexValue.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hexValue.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function responseArrayBuffer(value: unknown): ArrayBuffer {
  let source: Uint8Array;

  if (value instanceof Uint8Array) {
    source = value;
  } else if (value instanceof ArrayBuffer) {
    return value.slice(0);
  } else if (ArrayBuffer.isView(value)) {
    source = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  } else if (typeof value === "string" && value.startsWith("\\x")) {
    source = hexBytes(value);
  } else {
    throw new Error("Unsupported expense-evidence byte payload.");
  }

  const copy = new Uint8Array(source.byteLength);
  copy.set(source);
  return copy.buffer;
}

export const Route = createFileRoute("/api/finance/expense-evidence")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          await requireBusinessActor("view");
        } catch (error) {
          if (error instanceof UnauthorizedError || (error instanceof Error && error.message === "Unauthorized")) {
            return authError();
          }
          throw error;
        }

        const url = new URL(request.url);
        const attachmentId = url.searchParams.get("attachmentId")?.trim();
        if (!attachmentId) return json({ ok: false, error: "attachment_id_required" }, 400);

        const sql = await getSql();
        const rows = await sql.query<{
          id: string;
          file_name: string;
          mime_type: string;
          file_size_bytes: number;
          sha256_hex: string;
          content_bytes: unknown;
        }>(
          `select id,file_name,mime_type,file_size_bytes,sha256_hex,content_bytes
             from vyndi_expense_evidence_attachments
            where id=$1`,
          [attachmentId],
        );
        const row = rows[0];
        if (!row) return json({ ok: false, error: "attachment_not_found" }, 404);

        const bytes = responseArrayBuffer(row.content_bytes);
        const disposition = url.searchParams.get("download") === "1" ? "attachment" : "inline";
        return new Response(bytes, {
          status: 200,
          headers: {
            "content-type": row.mime_type,
            "content-length": String(row.file_size_bytes),
            "content-disposition": `${disposition}; filename="${safeFilename(row.file_name)}"`,
            "cache-control": "private, no-store",
            "x-content-type-options": "nosniff",
            "x-vyndi-evidence-sha256": row.sha256_hex,
          },
        });
      },

      POST: async ({ request }) => {
        let actor;
        try {
          actor = await requireBusinessActor("edit");
        } catch (error) {
          if (error instanceof UnauthorizedError || (error instanceof Error && error.message === "Unauthorized")) {
            return authError();
          }
          throw error;
        }

        if (!sameOrigin(request)) return json({ ok: false, error: "origin_not_allowed" }, 403);

        const form = await request.formData();
        const expenditureId = String(form.get("expenditureId") ?? "").trim().slice(0, 160);
        const documentType = String(form.get("documentType") ?? "").trim();
        const file = form.get("file");

        if (!expenditureId) return json({ ok: false, error: "expenditure_id_required" }, 400);
        if (!DOCUMENT_TYPES.has(documentType)) return json({ ok: false, error: "invalid_document_type" }, 400);
        if (!(file instanceof File)) return json({ ok: false, error: "file_required" }, 400);
        if (file.size <= 0) return json({ ok: false, error: "empty_file" }, 400);
        if (file.size > MAX_FILE_BYTES) return json({ ok: false, error: "file_too_large", maxBytes: MAX_FILE_BYTES }, 413);

        const raw = await file.arrayBuffer();
        const bytes = new Uint8Array(raw);
        const mimeType = detectedMime(bytes);
        if (!mimeType || !MIME_TYPES.has(mimeType)) {
          return json({ ok: false, error: "unsupported_file_type", allowed: [...MIME_TYPES] }, 415);
        }
        if (file.type && file.type !== mimeType) {
          return json({ ok: false, error: "mime_signature_mismatch", declared: file.type, detected: mimeType }, 415);
        }

        const digest = await crypto.subtle.digest("SHA-256", raw);
        const sha256Hex = hex(digest);
        const sql = await getSql();

        const expenditures = await sql.query<{ id: string }>(
          "select id from vyndi_people_office_actual_expenditures where id=$1",
          [expenditureId],
        );
        if (!expenditures[0]) return json({ ok: false, error: "expenditure_not_found" }, 404);

        const duplicate = await sql.query<{ id: string }>(
          "select id from vyndi_expense_evidence_attachments where expenditure_id=$1 and sha256_hex=$2",
          [expenditureId, sha256Hex],
        );
        if (duplicate[0]) {
          return json({ ok: false, error: "duplicate_evidence", attachmentId: duplicate[0].id, sha256Hex }, 409);
        }

        const id = `EXPEVID-${crypto.randomUUID()}`;
        const fileName = safeFilename(file.name);
        await sql.query(
          `insert into vyndi_expense_evidence_attachments(
             id,expenditure_id,document_type,file_name,mime_type,file_size_bytes,
             sha256_hex,content_bytes,uploaded_by,uploaded_role)
           values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            id,
            expenditureId,
            documentType,
            fileName,
            mimeType,
            file.size,
            sha256Hex,
            bytes,
            actor.userId,
            actor.role,
          ],
        );

        return json({
          ok: true,
          attachmentId: id,
          expenditureId,
          documentType,
          fileName,
          mimeType,
          fileSizeBytes: file.size,
          sha256Hex,
        }, 201);
      },
    },
  },
});
