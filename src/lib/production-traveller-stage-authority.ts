import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireBusinessActor } from "@/lib/business-actor";
import { getSql } from "@/lib/db";

const nextStatus = z.enum(["in_build", "completed"]);

export const advanceProductionTravellerStage = createServerFn({ method: "POST" })
  .validator(z.object({
    travellerId: z.string().trim().min(1).max(180),
    expectedStatus: z.enum(["released", "hold", "in_build"]),
    expectedRevision: z.number().int().positive(),
    nextStatus,
    sourceReference: z.string().trim().min(1).max(500),
    reason: z.string().trim().min(1).max(1000),
  }))
  .handler(async ({ data }) => {
    const permission = data.nextStatus === "completed" ? "approve" : "edit";
    const actor = await requireBusinessActor(permission);
    const sql = await getSql();
    const rows = await sql.query<{
      traveller_id: string;
      status: string;
      record_revision: number | string;
    }>(
      `select * from transition_vyndi_traveller_stage($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        data.travellerId,
        data.expectedStatus,
        data.expectedRevision,
        data.nextStatus,
        data.sourceReference,
        data.reason,
        actor.userId,
        actor.role,
      ],
    );
    const row = rows[0];
    if (!row) throw new Error("Traveller stage transition did not return a controlled receipt.");
    return {
      ok: true,
      travellerId: row.traveller_id,
      status: row.status,
      recordRevision: Number(row.record_revision),
    };
  });
