import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireBusinessActor } from "@/lib/business-actor";
import { getSql } from "@/lib/db";
import { canPerform } from "@/lib/page-access";
import { getRouteMeta } from "@/lib/page-metadata";

const route = "/command/purchase-execution";

export const amendPurchaseOrder = createServerFn({ method: "POST" })
  .validator(z.object({
    id: z.string().trim().min(1).max(120),
    expectedRevision: z.number().int().positive(),
    supplierId: z.string().trim().min(1).max(120),
    quantity: z.number().finite().positive().max(1_000_000_000),
    unitPriceInr: z.number().finite().positive().max(1_000_000_000_000),
    expectedReceiptOn: z.string().date(),
    paymentTermsDays: z.number().int().min(0).max(365),
    sourceReference: z.string().trim().min(1).max(500),
    notes: z.string().trim().max(1000).optional(),
  }))
  .handler(async ({ data }) => {
    const actor = await requireBusinessActor("edit");
    if (!canPerform(actor.role, "edit", getRouteMeta(route))) {
      throw new Error("Purchase-order amendment permission denied.");
    }
    const sql = await getSql();
    const rows = await sql.query<{
      purchase_order_id: string;
      record_revision: number | string;
      status: string;
    }>(
      `select * from amend_vyndi_purchase_order($1,$2,$3,$4,$5,$6::date,$7,$8,$9,$10,$11)`,
      [
        data.id,
        data.expectedRevision,
        data.supplierId.toUpperCase(),
        data.quantity,
        data.unitPriceInr,
        data.expectedReceiptOn,
        data.paymentTermsDays,
        data.sourceReference,
        data.notes ?? "",
        actor.userId,
        actor.role,
      ],
    );
    const row = rows[0];
    if (!row) throw new Error("Purchase-order amendment did not return a controlled revision.");
    return {
      ok: true,
      id: row.purchase_order_id,
      recordRevision: Number(row.record_revision),
      status: row.status,
    };
  });
