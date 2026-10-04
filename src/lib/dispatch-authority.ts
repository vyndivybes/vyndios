import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getSql } from "@/lib/db";
import { requireBusinessActor } from "@/lib/business-actor";
import { getCommandRole } from "@/lib/command-access";
import { canPerform } from "@/lib/page-access";

const id = z.string().trim().min(1).max(120);
const sourceReference = z.string().trim().min(1).max(500);
const month = z.number().int().min(1).max(36);

export type DispatchRecord = {
  shipmentId: string;
  salesOrderId: string;
  salesOrderRevision: number;
  jobCardId: string | null;
  planMonth: number;
  units: number;
  status: "posted" | "reversed";
  ownerWorkspace: "operations";
  sourceReference: string;
  qualityReleaseCount: number;
  serialAllocationRequired: boolean;
  allocatedSerialCount: number;
  currentReleasedSerialCount: number;
  serialNumbers: string[];
  serialAllocations: Array<{
    allocationId: string;
    qualityReleaseId: string;
    travellerId: string;
    serialNumber: string;
    currentRelease: boolean;
  }>;
  serializationComplete: boolean;
  releaseCoverageComplete: boolean;
  invoiceId: string | null;
  invoiceStatus: string | null;
};

async function requireView() {
  const role = await getCommandRole();
  if (!role || !canPerform(role, "view")) throw new Error("Dispatch view permission denied.");
}

/** Canonical Operations/Fulfilment read model for shipment execution. */
export const listDispatchRegister = createServerFn({ method: "GET" }).handler(async () => {
  await requireView();
  const sql = await getSql();
  const rows = await sql.query<Record<string, unknown>>(`
    select shipment_id,sales_order_id,sales_order_revision,job_card_id,plan_month,units,status,
           owner_workspace,source_reference,current_quality_release_count,serial_allocation_required,
           allocated_serial_count,current_released_serial_count,serial_numbers,serial_allocations,
           serialization_complete,release_coverage_complete,invoice_id,invoice_status
    from vyndi_dispatch_register
    order by plan_month,shipment_id
  `);
  return rows.map((row) => ({
    shipmentId: String(row.shipment_id),
    salesOrderId: String(row.sales_order_id),
    salesOrderRevision: Number(row.sales_order_revision),
    jobCardId: row.job_card_id ? String(row.job_card_id) : null,
    planMonth: Number(row.plan_month),
    units: Number(row.units),
    status: row.status as DispatchRecord["status"],
    ownerWorkspace: "operations" as const,
    sourceReference: String(row.source_reference),
    qualityReleaseCount: Number(row.current_quality_release_count ?? 0),
    serialAllocationRequired: Boolean(row.serial_allocation_required),
    allocatedSerialCount: Number(row.allocated_serial_count ?? 0),
    currentReleasedSerialCount: Number(row.current_released_serial_count ?? 0),
    serialNumbers: String(row.serial_numbers ?? "").split("|").map((value) => value.trim()).filter(Boolean),
    serialAllocations: Array.isArray(row.serial_allocations)
      ? (row.serial_allocations as Array<Record<string, unknown>>).map((item) => ({
          allocationId: String(item.allocationId ?? ""),
          qualityReleaseId: String(item.qualityReleaseId ?? ""),
          travellerId: String(item.travellerId ?? ""),
          serialNumber: String(item.serialNumber ?? ""),
          currentRelease: Boolean(item.currentRelease),
        }))
      : [],
    serializationComplete: Boolean(row.serialization_complete),
    releaseCoverageComplete: Boolean(row.release_coverage_complete),
    invoiceId: row.invoice_id ? String(row.invoice_id) : null,
    invoiceStatus: row.invoice_status ? String(row.invoice_status) : null,
  }));
});

/**
 * Canonical Dispatch writer. The database gate verifies current-order revision,
 * completed Production and serialized Quality-release capacity before posting.
 */
export const postDispatch = createServerFn({ method: "POST" })
  .validator(z.object({ id, salesOrderId: id, planMonth: month, units: z.number().positive(), sourceReference }))
  .handler(async ({ data }) => {
    const actor = await requireBusinessActor("edit");
    const sql = await getSql();
    const rows = await sql.query<{ post_vyndi_shipment: string }>(
      `select post_vyndi_shipment($1,$2,$3,$4,$5,$6,$7)`,
      [data.id, data.salesOrderId, data.planMonth, data.units, data.sourceReference, actor.userId, actor.role],
    );
    return { id: rows[0]?.post_vyndi_shipment ?? data.id, ownerWorkspace: "operations" as const };
  });

export const reverseDispatch = createServerFn({ method: "POST" })
  .validator(z.object({ id, reason: z.string().trim().min(1).max(500) }))
  .handler(async ({ data }) => {
    const actor = await requireBusinessActor("edit");
    const sql = await getSql();
    const rows = await sql.query<{ revision: number | string }>(
      `select reverse_vyndi_shipment($1,$2,$3,$4) as revision`,
      [data.id, data.reason, actor.userId, actor.role],
    );
    return { id: data.id, revision: Number(rows[0]?.revision ?? 0), ownerWorkspace: "operations" as const };
  });


export type DispatchSerialCandidate = {
  shipmentId: string;
  qualityReleaseId: string;
  travellerId: string;
  serialNumber: string;
  decidedAt: string;
};

export const listDispatchSerialCandidates = createServerFn({ method: "GET" }).handler(async () => {
  await requireView();
  const sql = await getSql();
  const rows = await sql.query<Record<string, unknown>>(
    `select s.id as shipment_id,q.id as quality_release_id,q.traveller_id,q.serial_number,q.decided_at
       from vyndi_shipments s
       join vyndi_quality_releases q
         on q.job_card_id=s.job_card_id
        and q.sales_order_id is not distinct from s.sales_order_id
        and q.decision='released'
        and q.superseded_at is null
       left join vyndi_shipment_serial_allocations a
         on a.traveller_id=q.traveller_id and a.status='active'
      where s.status='posted'
        and s.serial_allocation_required=true
        and a.id is null
      order by s.id,q.decided_at,q.serial_number`
  );
  return rows.map((row) => ({
    shipmentId: String(row.shipment_id),
    qualityReleaseId: String(row.quality_release_id),
    travellerId: String(row.traveller_id),
    serialNumber: String(row.serial_number),
    decidedAt: String(row.decided_at),
  })) satisfies DispatchSerialCandidate[];
});

export const allocateDispatchSerial = createServerFn({ method: "POST" })
  .validator(z.object({
    shipmentId: id,
    qualityReleaseId: id,
    sourceReference,
  }))
  .handler(async ({ data }) => {
    const actor = await requireBusinessActor("edit");
    const sql = await getSql();
    const rows = await sql.query<{ allocate_vyndi_shipment_serial: string }>(
      `select allocate_vyndi_shipment_serial($1,$2,$3,$4,$5)`,
      [data.shipmentId,data.qualityReleaseId,data.sourceReference,actor.userId,actor.role],
    );
    return {
      id: rows[0]?.allocate_vyndi_shipment_serial ?? "",
      shipmentId: data.shipmentId,
      qualityReleaseId: data.qualityReleaseId,
    };
  });

export const deallocateDispatchSerial = createServerFn({ method: "POST" })
  .validator(z.object({
    shipmentId: id,
    qualityReleaseId: id,
    reason: z.string().trim().min(3).max(500),
  }))
  .handler(async ({ data }) => {
    const actor = await requireBusinessActor("edit");
    const sql = await getSql();
    const rows = await sql.query<{ revision: number | string }>(
      `select deallocate_vyndi_shipment_serial($1,$2,$3,$4,$5) as revision`,
      [data.shipmentId,data.qualityReleaseId,data.reason,actor.userId,actor.role],
    );
    return {
      shipmentId: data.shipmentId,
      qualityReleaseId: data.qualityReleaseId,
      revision: Number(rows[0]?.revision ?? 0),
    };
  });
