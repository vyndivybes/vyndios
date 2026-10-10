import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware, optionalAuthMiddleware } from "@/lib/auth/middleware";
import { getSql } from "@/lib/db";
import { requireBusinessActor } from "@/lib/business-actor";
import type { CrmActivity, CrmCustomer, CrmOrderLink } from "@/lib/crm-domain";

const customerId = z.string().regex(/^CRM-[0-9a-f-]{36}$/i);
const activityId = z.string().regex(/^ACT-[0-9a-f-]{36}$/i);
const email = z.union([z.literal(""), z.string().email().max(254)]);
const customerFields = z.object({
  id: customerId,
  revision: z.number().int().min(0),
  kind: z.enum(["person", "company"]),
  name: z.string().trim().min(2).max(200),
  primaryContact: z.string().trim().max(200),
  email,
  phone: z.string().trim().max(60),
  city: z.string().trim().max(120),
  segment: z.enum(["retail", "dealer", "distributor", "partner"]),
  lifecycle: z.enum(["prospect", "active", "inactive"]),
}).strict();
const activityFields = z.object({
  id: activityId,
  customerId,
  kind: z.enum(["note", "call", "email", "meeting", "followup"]),
  summary: z.string().trim().min(2).max(2000),
  dueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
}).strict().refine((value) => value.kind === "followup" || value.dueOn === null, {
  message: "A due date is valid only for a follow-up.",
});
const linkFields = z.object({
  salesOrderId: z.string().min(1).max(100),
  customerId,
}).strict();

export type CrmOverview = {
  customers: CrmCustomer[];
  activities: CrmActivity[];
  links: CrmOrderLink[];
};
const newAuditId = () => "CRM-AUD-" + crypto.randomUUID();

export const getCrmOverview = createServerFn({ method: "GET" })
  .middleware([optionalAuthMiddleware])
  .handler(async ({ context }): Promise<CrmOverview> => {
    await requireBusinessActor("view", context.userId
      ? { userId: context.userId, email: context.userEmail } : undefined);
    const sql = await getSql();
    const [customers, activities, links] = await Promise.all([
      sql.query<CrmCustomer>(
        'select id,revision,kind,name,primary_contact as "primaryContact",email,phone,city,segment,lifecycle from vyndi_crm_customers order by updated_at desc,id'
      ),
      sql.query<CrmActivity>(
        'select id,customer_id as "customerId",kind,summary,due_on::text as "dueOn",completed_at::text as "completedAt",created_at::text as "createdAt" from vyndi_crm_activities order by created_at desc,id'
      ),
      sql.query<CrmOrderLink>(
        'select sales_order_id as "salesOrderId",customer_id as "customerId" from vyndi_crm_order_links'
      ),
    ]);
    return { customers, activities, links };
  });

export const saveCrmCustomer = createServerFn({ method: "POST" })
  .validator(customerFields)
  .middleware([authMiddleware])
  .handler(async ({ data, context }) => {
    const actor = await requireBusinessActor("edit", {
      userId: context.userId, email: context.userEmail,
    });
    const sql = await getSql();
    const values = [
      data.id, data.kind, data.name, data.primaryContact, data.email.toLowerCase(),
      data.phone, data.city, data.segment, data.lifecycle,
      actor.userId, actor.role, newAuditId(),
    ];
    const rows = data.revision === 0
      ? await sql.query<{ id: string; revision: number }>(
          "with saved as (insert into vyndi_crm_customers (id,kind,name,primary_contact,email,phone,city,segment,lifecycle,created_by,updated_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10) on conflict (id) do nothing returning id,revision), logged as (insert into vyndi_audit_events (id,entity_type,entity_id,entity_revision,action,actor_user_id,actor_role,payload_json) select $12,'crm_customer',id,revision,'created',$10,$11,jsonb_build_object('kind',$2,'segment',$8,'lifecycle',$9) from saved returning id) select saved.id,saved.revision from saved join logged on true",
          values,
        )
      : await sql.query<{ id: string; revision: number }>(
          "with saved as (update vyndi_crm_customers set revision=revision+1,kind=$2,name=$3,primary_contact=$4,email=$5,phone=$6,city=$7,segment=$8,lifecycle=$9,updated_by=$10,updated_at=now() where id=$1 and revision=$13 returning id,revision), logged as (insert into vyndi_audit_events (id,entity_type,entity_id,entity_revision,action,actor_user_id,actor_role,payload_json) select $12,'crm_customer',id,revision,'revised',$10,$11,jsonb_build_object('kind',$2,'segment',$8,'lifecycle',$9) from saved returning id) select saved.id,saved.revision from saved join logged on true",
          [...values, data.revision],
        );
    if (!rows[0]) throw new Error("Customer was not saved. The record already exists or its revision changed; reload and retry.");
    return { ...rows[0], persisted: true as const };
  });

export const recordCrmActivity = createServerFn({ method: "POST" })
  .validator(activityFields)
  .middleware([authMiddleware])
  .handler(async ({ data, context }) => {
    const actor = await requireBusinessActor("edit", {
      userId: context.userId, email: context.userEmail,
    });
    const sql = await getSql();
    const rows = await sql.query<{ id: string }>(
      "with saved as (insert into vyndi_crm_activities (id,customer_id,kind,summary,due_on,created_by) values ($1,$2,$3,$4,$5::date,$6) on conflict (id) do nothing returning id), logged as (insert into vyndi_audit_events (id,entity_type,entity_id,action,actor_user_id,actor_role,payload_json) select $8,'crm_activity',id,'created',$6,$7,jsonb_build_object('customer_id',$2,'kind',$3,'due_on',$5) from saved returning id) select saved.id from saved join logged on true",
      [data.id,data.customerId,data.kind,data.summary,data.dueOn,actor.userId,actor.role,newAuditId()],
    );
    if (!rows[0]) throw new Error("CRM activity was not recorded.");
    return { id: rows[0].id, persisted: true as const };
  });

export const completeCrmFollowup = createServerFn({ method: "POST" })
  .validator(z.object({ id: activityId }).strict())
  .middleware([authMiddleware])
  .handler(async ({ data, context }) => {
    const actor = await requireBusinessActor("edit", {
      userId: context.userId, email: context.userEmail,
    });
    const sql = await getSql();
    const rows = await sql.query<{ id: string }>(
      "with saved as (update vyndi_crm_activities set completed_at=now(),completed_by=$2 where id=$1 and kind='followup' and completed_at is null returning id), logged as (insert into vyndi_audit_events (id,entity_type,entity_id,action,actor_user_id,actor_role) select $4,'crm_activity',id,'completed',$2,$3 from saved returning id) select saved.id from saved join logged on true",
      [data.id,actor.userId,actor.role,newAuditId()],
    );
    if (!rows[0]) throw new Error("Follow-up not found or already completed.");
    return { id: rows[0].id, completed: true as const };
  });

export const linkCrmSalesOrder = createServerFn({ method: "POST" })
  .validator(linkFields)
  .middleware([authMiddleware])
  .handler(async ({ data, context }) => {
    const actor = await requireBusinessActor("edit", {
      userId: context.userId, email: context.userEmail,
    });
    const sql = await getSql();
    const rows = await sql.query<{ salesOrderId: string }>(
      "with saved as (insert into vyndi_crm_order_links (sales_order_id,customer_id,linked_by) values ($1,$2,$3) on conflict (sales_order_id) do nothing returning sales_order_id), logged as (insert into vyndi_audit_events (id,entity_type,entity_id,action,actor_user_id,actor_role,payload_json) select $5,'crm_order_link',sales_order_id,'linked',$3,$4,jsonb_build_object('customer_id',$2) from saved returning id) select saved.sales_order_id as \"salesOrderId\" from saved join logged on true",
      [data.salesOrderId,data.customerId,actor.userId,actor.role,newAuditId()],
    );
    if (!rows[0]) throw new Error("This order is already assigned to a customer. Existing links are not silently reassigned.");
    return { salesOrderId: rows[0].salesOrderId, persisted: true as const };
  });
