import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireBusinessActor } from "@/lib/business-actor";
import { getSql } from "@/lib/db";

const purchasedIdentitySchema = z.object({
  movementId: z.string().trim().min(1).max(200),
  traceabilityClass: z.enum(["A", "B", "C"]),
  internalPrefix: z.enum(["AST", "EQP", "TOL", "SPR", "CON", "ITM"]).optional(),
  manufacturer: z.string().trim().max(200).default(""),
  brand: z.string().trim().max(200).default(""),
  oemModelNumber: z.string().trim().max(200).default(""),
  oemPartNumber: z.string().trim().max(200).default(""),
  oemSerialNumber: z.string().trim().max(240).default(""),
  supplierSku: z.string().trim().max(200).default(""),
  supplierLot: z.string().trim().max(200).default(""),
  invoiceReference: z.string().trim().max(200).default(""),
  grnReference: z.string().trim().max(200).default(""),
  warrantyReference: z.string().trim().max(240).default(""),
  calibrationReference: z.string().trim().max(240).default(""),
});

const componentIdentitySchema = z.object({
  familyCode: z.string().trim().regex(/^[A-Za-z0-9]{2,5}$/),
  variantCode: z.string().trim().regex(/^[A-Za-z0-9]{1,12}$/),
  releaseMonth: z.number().int().min(1).max(12),
  releaseYear: z.number().int().min(2000).max(2199),
  partSku: z.string().trim().min(1).max(160),
  engineeringRevision: z.string().trim().min(1).max(120),
});

const modelLaunchSchema = z.object({
  familyCode: z.enum(["longitude", "latitude", "altitude"]),
  launchMonth: z.number().int().min(1).max(12),
  launchYear: z.number().int().min(2000).max(2199),
});

/**
 * Preserve the purchased item's OEM identity and bind a separate VYNDI internal
 * reference to the existing inventory receipt. No OEM field is synthesized.
 */
export const registerPurchasedIdentity = createServerFn({ method: "POST" })
  .validator(purchasedIdentitySchema)
  .handler(async ({ data }) => {
    const actor = await requireBusinessActor("edit");
    const sql = await getSql();
    const rows = await sql.query<{ identity_uid: string; internal_reference: string }>(
      `select * from register_vyndi_inventory_receipt_identity(
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15
      )`,
      [
        data.movementId,
        data.traceabilityClass,
        data.internalPrefix ?? "",
        data.manufacturer,
        data.brand,
        data.oemModelNumber,
        data.oemPartNumber,
        data.oemSerialNumber,
        data.supplierSku,
        data.supplierLot,
        data.invoiceReference,
        data.grnReference,
        data.warrantyReference,
        data.calibrationReference,
        actor.userId,
      ],
    );
    const row = rows[0];
    if (!row) throw new Error("Purchased identity was not registered.");
    return { identityUid: row.identity_uid, internalReference: row.internal_reference };
  });

/** Generate a controlled VAYU component identity from family + variant + release MMYY. */
export const createVayuComponentIdentity = createServerFn({ method: "POST" })
  .validator(componentIdentitySchema)
  .handler(async ({ data }) => {
    const actor = await requireBusinessActor("edit");
    const sql = await getSql();
    const rows = await sql.query<{ serial_number: string }>(
      `select generate_vyndi_component_serial($1,$2,$3,$4,$5,$6,$7) as serial_number`,
      [
        data.familyCode,
        data.variantCode,
        data.releaseMonth,
        data.releaseYear,
        data.partSku,
        data.engineeringRevision,
        actor.userId,
      ],
    );
    if (!rows[0]) throw new Error("Component identity was not generated.");
    return { serialNumber: rows[0].serial_number };
  });

/**
 * Change launch MMYY only under the database guard. Once the first canonical
 * model serial exists, the launch code is frozen and this operation is rejected.
 */
export const configureModelLaunchIdentity = createServerFn({ method: "POST" })
  .validator(modelLaunchSchema)
  .handler(async ({ data }) => {
    const actor = await requireBusinessActor("approve");
    const sql = await getSql();
    const rows = await sql.query<{ family_code: string; model_code: string; launch_code: string }>(
      `select * from configure_vyndi_model_launch($1,$2,$3,$4,$5)`,
      [data.familyCode, data.launchMonth, data.launchYear, actor.userId, actor.role],
    );
    const row = rows[0];
    if (!row) throw new Error("Model launch identity was not configured.");
    return { familyCode: row.family_code, modelCode: row.model_code, launchCode: row.launch_code };
  });
