import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireBusinessActor } from "@/lib/business-actor";
import { getCommandRole } from "@/lib/command-access";
import { getSql, type SqlRow } from "@/lib/db";
import { canPerform } from "@/lib/page-access";
import { getRouteMeta } from "@/lib/page-metadata";

const permissionRoute = "/command/inventory";
const id = z.string().trim().min(1).max(180);
const reference = z.string().trim().min(1).max(500);
const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const unit = z.string().trim().min(1).max(30);
const quantity = z.number().finite().min(0).max(1_000_000_000);
const cost = z.number().finite().min(0).max(1_000_000_000_000);

async function requireView() {
  const role = await getCommandRole();
  if (!role || !canPerform(role, "view", getRouteMeta(permissionRoute))) {
    throw new Error("Inventory stocktake view permission denied.");
  }
}

async function requireEdit() {
  const actor = await requireBusinessActor("edit");
  if (!canPerform(actor.role, "edit", getRouteMeta(permissionRoute))) {
    throw new Error("Inventory stocktake edit permission denied.");
  }
  return actor;
}

async function requireApprove() {
  const actor = await requireBusinessActor("approve");
  if (!canPerform(actor.role, "approve", getRouteMeta(permissionRoute))) {
    throw new Error("Inventory stocktake approval permission denied.");
  }
  return actor;
}

export const getInventoryStocktakeControl = createServerFn({ method: "GET" }).handler(async () => {
  await requireView();
  const sql = await getSql();
  const [sessions, lines, readiness] = await Promise.all([
    sql.query<SqlRow>(`
      select id,period,effective_on::text as effective_on,scope_reference,evidence_reference,
             book_snapshot_at::text as book_snapshot_at,status,prepared_by,prepared_at::text as prepared_at,
             submitted_by,submitted_at::text as submitted_at,approved_by,approved_at::text as approved_at,
             posted_by,posted_at::text as posted_at,variance_line_count,gain_value_inr,loss_value_inr,finance_journal_id
        from epr_inventory_stocktakes
       order by period desc,prepared_at desc
       limit 24
    `),
    sql.query<SqlRow>(`
      select l.stocktake_id,l.sku,l.unit,l.expected_quantity,l.book_unit_cost_inr,l.book_inventory_value_inr,
             l.snapshot_last_movement_at::text as snapshot_last_movement_at,l.counted_quantity,l.counted_unit_cost_inr,
             l.count_reference,l.evidence_reference,l.counted_by,l.counted_at::text as counted_at,
             round(coalesce(l.counted_quantity,l.expected_quantity)-l.expected_quantity,4) as variance_quantity
        from epr_inventory_stocktake_lines l
        join epr_inventory_stocktakes s on s.id=l.stocktake_id
       where s.id=(select id from epr_inventory_stocktakes order by period desc,prepared_at desc limit 1)
       order by l.sku,l.unit
    `),
    sql.query<SqlRow>(`
      select * from vyndi_inventory_stocktake_period_readiness
       order by period desc limit 24
    `),
  ]);
  return { sessions, lines, readiness };
});

export const startInventoryStocktake = createServerFn({ method: "POST" })
  .validator(z.object({
    period,
    effectiveOn: z.string().date(),
    scopeReference: reference,
    evidenceReference: reference,
  }))
  .handler(async ({ data }) => {
    const actor = await requireEdit();
    const sql = await getSql();
    const stocktakeId = `STK-${data.period}-${crypto.randomUUID()}`;
    const rows = await sql.query<{ stocktake_id: string; line_count: number | string }>(
      `select * from start_vyndi_inventory_stocktake($1,$2,$3::date,$4,$5,$6,$7)`,
      [stocktakeId,data.period,data.effectiveOn,data.scopeReference,data.evidenceReference,actor.userId,actor.role],
    );
    return rows[0];
  });

export const recordInventoryStocktakeCount = createServerFn({ method: "POST" })
  .validator(z.object({
    stocktakeId: id,
    sku: id,
    unit,
    countedQuantity: quantity,
    countedUnitCostInr: cost.optional(),
    countReference: reference,
    evidenceReference: reference,
  }))
  .handler(async ({ data }) => {
    const actor = await requireEdit();
    const sql = await getSql();
    await sql.query(
      `select record_vyndi_inventory_stocktake_count($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [data.stocktakeId,data.sku,data.unit,data.countedQuantity,data.countedUnitCostInr ?? null,
       data.countReference,data.evidenceReference,actor.userId,actor.role],
    );
    return { ok: true, stocktakeId: data.stocktakeId };
  });

export const submitInventoryStocktake = createServerFn({ method: "POST" })
  .validator(z.object({ stocktakeId: id, evidenceReference: reference }))
  .handler(async ({ data }) => {
    const actor = await requireEdit();
    const sql = await getSql();
    await sql.query(
      `select submit_vyndi_inventory_stocktake($1,$2,$3,$4)`,
      [data.stocktakeId,data.evidenceReference,actor.userId,actor.role],
    );
    return { ok: true, status: "submitted" as const };
  });

export const approveInventoryStocktake = createServerFn({ method: "POST" })
  .validator(z.object({ stocktakeId: id, evidenceReference: reference }))
  .handler(async ({ data }) => {
    const actor = await requireApprove();
    const sql = await getSql();
    await sql.query(
      `select approve_vyndi_inventory_stocktake($1,$2,$3,$4)`,
      [data.stocktakeId,data.evidenceReference,actor.userId,actor.role],
    );
    return { ok: true, status: "approved" as const };
  });

export const postInventoryStocktake = createServerFn({ method: "POST" })
  .validator(z.object({ stocktakeId: id, evidenceReference: reference }))
  .handler(async ({ data }) => {
    const actor = await requireApprove();
    const sql = await getSql();
    const rows = await sql.query<SqlRow>(
      `select * from post_vyndi_inventory_stocktake($1,$2,$3,$4)`,
      [data.stocktakeId,data.evidenceReference,actor.userId,actor.role],
    );
    return rows[0] ?? null;
  });
