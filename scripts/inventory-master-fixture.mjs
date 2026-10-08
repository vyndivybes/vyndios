import { randomUUID } from "node:crypto";

// Test-only canonical master approval, before creating an ERP SKU identity.
export async function approveInventoryMaster(db, { sku, name, category, unit }) {
  const id = randomUUID();
  await db.query(
    `insert into master_data_records
      (id,domain,code,name,status,owner_role,approver_role,attributes,source_ref,created_by,approved_by,approved_at)
     values ($1,'inventory',$2,$3,'approved','operations','admin',$4::jsonb,'TEST-MASTER-APPROVAL','test-maker','test-checker',now())`,
    [id, sku, name, JSON.stringify({ category, unit })],
  );
  await db.query(
    `insert into master_data_audit_events
      (id,master_data_id,event_type,actor_user_id,actor_role,from_status,to_status,source_ref)
     values ($1,$2,'approved','test-checker','admin','pending_approval','approved','TEST-MASTER-APPROVAL')`,
    [randomUUID(), id],
  );
}
