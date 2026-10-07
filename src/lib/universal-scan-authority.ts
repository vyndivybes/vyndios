import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { optionalAuthMiddleware } from "@/lib/auth/middleware";
import { requireBusinessActor } from "@/lib/business-actor";
import { getSql } from "@/lib/db";
import { canAccessRoute } from "@/lib/page-access";
import {
  evidenceTargetTypeForKind,
  parseUniversalScanPayload,
  scanKindLabel,
  scanRouteForKind,
  type UniversalScanKind,
  type UniversalScanTargetType,
} from "@/lib/universal-scan";

const scanSchema = z.object({ code: z.string().min(1).max(500) });

export type UniversalScanResolution = {
  raw: string;
  recognized: boolean;
  found: boolean;
  kind: UniversalScanKind;
  identifier: string;
  canonicalId: string | null;
  label: string;
  status: string;
  route: string | null;
  evidenceTargetType: UniversalScanTargetType | null;
  traceabilityQuery: string | null;
};

type Row = Record<string, unknown>;

function text(row: Row | undefined, ...keys: string[]) {
  if (!row) return "";
  for (const key of keys) {
    const value = row[key];
    if (value !== null && value !== undefined && String(value).trim()) return String(value).trim();
  }
  return "";
}

async function resolveRow(sql: Awaited<ReturnType<typeof getSql>>, kind: UniversalScanTargetType, identifier: string) {
  switch (kind) {
    case "sales_order":
      return (await sql.query<Row>(
        "select id,status,variant_name,variant_id from vyndi_sales_orders where id=$1 limit 1",
        [identifier],
      ))[0];
    case "job_card":
      return (await sql.query<Row>(
        "select id,status,product_label,batch_code from epr_production_job_cards where id=$1 limit 1",
        [identifier],
      ))[0];
    case "traveller":
      return (await sql.query<Row>(
        "select id,status,serial_number,model_name,job_card_id from epr_travellers where id=$1 or serial_number=$1 order by created_at desc limit 1",
        [identifier],
      ))[0];
    case "purchase_order":
      return (await sql.query<Row>(
        "select id,status,supplier_id,sku from vyndi_purchase_orders where id=$1 limit 1",
        [identifier],
      ))[0];
    case "grn":
      return (await sql.query<Row>(
        "select id,inspection_status as status,sku,purchase_order_id from vyndi_goods_receipts where id=$1 limit 1",
        [identifier],
      ))[0];
    case "inventory_item":
      return (await sql.query<Row>(
        "select id,case when active then 'active' else 'inactive' end as status,sku,name,ledger_id from master_inventory_items where id=$1 or upper(sku)=upper($1) order by active desc limit 1",
        [identifier],
      ))[0];
    case "quality_ncr":
      return (await sql.query<Row>(
        "select id,status,severity,serial_number,job_card_id from vyndi_quality_ncrs where id=$1 limit 1",
        [identifier],
      ))[0];
    case "quality_capa":
      return (await sql.query<Row>(
        "select id,status,ncr_id,owner from vyndi_quality_capas where id=$1 limit 1",
        [identifier],
      ))[0];
    case "equipment":
      return (await sql.query<Row>(
        "select id,status,serial_number,manufacturer,model_number,location from epr_equipment where id=$1 or serial_number=$1 order by id limit 1",
        [identifier],
      ))[0];
    case "maintenance_work_order":
      return (await sql.query<Row>(
        "select id,status,title,equipment_id,work_order_type from vyndi_maintenance_work_orders where id=$1 limit 1",
        [identifier],
      ))[0];
  }
}

function labelFor(kind: UniversalScanTargetType, row: Row) {
  const id = text(row, "id");
  switch (kind) {
    case "sales_order":
      return [id, text(row, "variant_name", "variant_id")].filter(Boolean).join(" · ");
    case "job_card":
      return [id, text(row, "product_label", "batch_code")].filter(Boolean).join(" · ");
    case "traveller":
      return [text(row, "serial_number"), id, text(row, "model_name")].filter(Boolean).join(" · ");
    case "purchase_order":
      return [id, text(row, "sku"), text(row, "supplier_id")].filter(Boolean).join(" · ");
    case "grn":
      return [id, text(row, "sku"), text(row, "purchase_order_id")].filter(Boolean).join(" · ");
    case "inventory_item":
      return [text(row, "sku"), text(row, "name"), id].filter(Boolean).join(" · ");
    case "quality_ncr":
      return [id, text(row, "severity"), text(row, "serial_number")].filter(Boolean).join(" · ");
    case "quality_capa":
      return [id, text(row, "ncr_id"), text(row, "owner")].filter(Boolean).join(" · ");
    case "equipment":
      return [text(row, "serial_number"), id, text(row, "manufacturer"), text(row, "model_number")].filter(Boolean).join(" · ");
    case "maintenance_work_order":
      return [id, text(row, "title"), text(row, "equipment_id")].filter(Boolean).join(" · ");
  }
}

function traceabilityQueryFor(kind: UniversalScanTargetType, row: Row, identifier: string) {
  if (["sales_order", "job_card", "traveller", "purchase_order", "grn"].includes(kind)) {
    return text(row, "id", "serial_number") || identifier;
  }
  if (kind === "inventory_item") return text(row, "sku") || identifier;
  return null;
}

export const resolveUniversalScan = createServerFn({ method: "POST" })
  .middleware([optionalAuthMiddleware])
  .validator(scanSchema)
  .handler(async ({ data, context }): Promise<UniversalScanResolution> => {
    const parsed = parseUniversalScanPayload(data.code);
    if (!parsed.recognized || parsed.kind === "unknown") {
      return {
        raw: parsed.raw,
        recognized: false,
        found: false,
        kind: "unknown",
        identifier: parsed.identifier,
        canonicalId: null,
        label: scanKindLabel("unknown"),
        status: "",
        route: null,
        evidenceTargetType: null,
        traceabilityQuery: parsed.identifier || null,
      };
    }

    const actor = await requireBusinessActor(
      "view",
      context.userId ? { userId: context.userId, email: context.userEmail } : undefined,
    );
    const route = scanRouteForKind(parsed.kind);
    if (!route || !canAccessRoute(actor.role, route)) {
      throw new Error("You do not have permission to resolve this scanned record.");
    }

    const sql = await getSql();
    const row = await resolveRow(sql, parsed.kind, parsed.identifier);
    if (!row) {
      return {
        raw: parsed.raw,
        recognized: true,
        found: false,
        kind: parsed.kind,
        identifier: parsed.identifier,
        canonicalId: null,
        label: scanKindLabel(parsed.kind),
        status: "not found",
        route,
        evidenceTargetType: evidenceTargetTypeForKind(parsed.kind),
        traceabilityQuery: parsed.identifier,
      };
    }

    const canonicalId = text(row, "id") || parsed.identifier;
    return {
      raw: parsed.raw,
      recognized: true,
      found: true,
      kind: parsed.kind,
      identifier: parsed.identifier,
      canonicalId,
      label: labelFor(parsed.kind, row) || `${scanKindLabel(parsed.kind)} · ${canonicalId}`,
      status: text(row, "status", "inspection_status"),
      route,
      evidenceTargetType: evidenceTargetTypeForKind(parsed.kind),
      traceabilityQuery: traceabilityQueryFor(parsed.kind, row, canonicalId),
    };
  });
