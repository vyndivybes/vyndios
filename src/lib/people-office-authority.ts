import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getSql } from "@/lib/db";
import { requireBusinessActor } from "@/lib/business-actor";
import type { CommandPermission } from "@/lib/page-access";

const lifecycleSchema = z.enum(["draft", "pending_approval", "approved", "superseded"]);

async function assertSameSiteRequest() {
  const { getRequest } = await import("@tanstack/react-start/server");
  const request = getRequest();
  if (!request) return;
  const site = request.headers.get("sec-fetch-site");
  if (!site || site === "same-origin" || site === "none") return;
  const isTopLevelGet = request.headers.get("sec-fetch-mode") === "navigate" && request.method === "GET";
  if (!isTopLevelGet) throw new Error("Forbidden: cross-site request blocked");
}

async function requirePermission(permission: CommandPermission) {
  return requireBusinessActor(permission);
}

async function audit(
  sql: Awaited<ReturnType<typeof getSql>>,
  input: {
    entityType: string;
    entityId: string;
    action: string;
    role: string;
    userId: string;
    sourceReference: string;
    previousState?: string | null;
    newState?: string | null;
    reason?: string | null;
    entityRevision?: number | null;
    payload?: Record<string, unknown>;
  },
) {
  await sql`
    insert into vyndi_audit_events (
      id,entity_type,entity_id,entity_revision,action,actor_user_id,actor_role,source_reference,payload_json,
      correlation_id,previous_state,new_state,reason
    ) values (
      ${crypto.randomUUID()},${input.entityType},${input.entityId},${input.entityRevision ?? null},${input.action},${input.userId},${input.role},
      ${input.sourceReference},${JSON.stringify(input.payload ?? {})}::jsonb,
      ${`PEOPLE_OFFICE|${input.entityType}|${input.entityId}`},${input.previousState ?? null},${input.newState ?? null},${input.reason ?? null}
    )
  `;
}

export const listPeopleOfficeAuthority = createServerFn({ method: "GET" }).handler(async () => {
  await assertSameSiteRequest();
  await requirePermission("view");
  const sql = await getSql();
  const [people, costs, assets, financeFeed, summary, operationalSummary, auditEvents] = await Promise.all([
    sql`select * from vyndi_people_records order by updated_at desc limit 250`,
    sql`select * from vyndi_people_office_cost_items order by cost_group,name limit 500`,
    sql`select * from vyndi_people_office_assets order by asset_class,category,name limit 500`,
    sql`select * from vyndi_people_office_finance_feed order by plan_month limit 36`,
    sql`select * from vyndi_people_office_authority_summary`,
    sql`select * from vyndi_people_office_operational_summary`,
    sql`
      select id,
             entity_type as "entityType",
             entity_id as "entityId",
             entity_revision as "entityRevision",
             action,
             actor_user_id as "actorUserId",
             actor_role as "actorRole",
             source_reference as "sourceReference",
             payload_json as "payloadJson",
             previous_state as "previousState",
             new_state as "newState",
             reason,
             created_at as "createdAt"
      from vyndi_audit_events
      where entity_type in ('people_record','people_office_cost','people_office_asset','people_office_reconciliation')
      order by created_at desc
      limit 200
    `,
  ]);
  return {
    people: Array.isArray(people) ? [...people] : [],
    costs: Array.isArray(costs) ? [...costs] : [],
    assets: Array.isArray(assets) ? [...assets] : [],
    financeFeed: Array.isArray(financeFeed) ? [...financeFeed] : [],
    summary: summary[0] ?? null,
    operationalSummary: operationalSummary[0] ?? null,
    auditEvents: Array.isArray(auditEvents) ? [...auditEvents] : [],
  };
});

export const getPeopleOfficeFinanceFeed = createServerFn({ method: "GET" }).handler(async () => {
  await assertSameSiteRequest();
  await requirePermission("view");
  const sql = await getSql();
  const rows = await sql<{
    planMonth: number;
    operatingExpenseLakh: string | number;
    officeCapexLakh: string | number;
    officeDepreciationLakh: string | number;
  }>`
    select plan_month as "planMonth",
           operating_expense_lakh as "operatingExpenseLakh",
           office_capex_lakh as "officeCapexLakh",
           office_depreciation_lakh as "officeDepreciationLakh"
    from vyndi_people_office_finance_feed
    order by plan_month
  `;
  return rows.map((row) => ({
    planMonth: Number(row.planMonth),
    operatingExpenseLakh: Number(row.operatingExpenseLakh),
    officeCapexLakh: Number(row.officeCapexLakh),
    officeDepreciationLakh: Number(row.officeDepreciationLakh),
  }));
});

const personSchema = z.object({
  id: z.string().min(1).max(120),
  displayName: z.string().min(1).max(300),
  functionName: z.string().min(1).max(200),
  roleTitle: z.string().min(1).max(200),
  engagementType: z.enum(["employee", "contractor", "consultant", "planned_role"]),
  startMonth: z.number().int().min(1).max(36).nullable().optional(),
  endMonth: z.number().int().min(1).max(36).nullable().optional(),
  sourceReference: z.string().min(1).max(500),
  notes: z.string().max(2000).optional(),
  expectedRevision: z.number().int().positive().nullable().optional(),
});

export const savePeopleRecordDraft = createServerFn({ method: "POST" })
  .validator(personSchema)
  .handler(async ({ data }) => {
    await assertSameSiteRequest();
    const { userId, role } = await requirePermission("edit");
    if (data.startMonth && data.endMonth && data.endMonth < data.startMonth) throw new Error("People record end month cannot precede start month.");
    const sql = await getSql();
    const existing = await sql<{ lifecycleStatus: string; revision:number }>`
      select lifecycle_status as "lifecycleStatus",record_revision as revision
      from vyndi_people_records where id=${data.id} limit 1
    `;
    const current=existing[0];
    if (current && current.lifecycleStatus !== "draft") throw new Error("Only draft People records may be edited; create a controlled superseding record instead.");
    if (current && data.expectedRevision == null) throw new Error("People record update requires expectedRevision.");
    if (current && current.revision !== data.expectedRevision) {
      throw new Error(`Stale People record revision: expected ${data.expectedRevision}, current ${current.revision}.`);
    }

    if (!current) {
      await sql`
        insert into vyndi_people_records (
          id,display_name,function_name,role_title,engagement_type,lifecycle_status,start_month,end_month,
          source_ref,notes,created_by,record_revision
        ) values (
          ${data.id},${data.displayName},${data.functionName},${data.roleTitle},${data.engagementType},'draft',
          ${data.startMonth ?? null},${data.endMonth ?? null},${data.sourceReference},${data.notes ?? ""},${userId},1
        )
      `;
      await audit(sql,{ entityType:"people_record",entityId:data.id,entityRevision:1,action:"PEOPLE_RECORD_DRAFT_SAVED",role,userId,sourceReference:data.sourceReference,newState:"draft",payload:{ engagementType:data.engagementType } });
      return { ok:true,id:data.id,status:"draft" as const,recordRevision:1 };
    }

    const updated=await sql<{ revision:number }>`
      update vyndi_people_records set
        display_name=${data.displayName},function_name=${data.functionName},role_title=${data.roleTitle},
        engagement_type=${data.engagementType},start_month=${data.startMonth ?? null},end_month=${data.endMonth ?? null},
        source_ref=${data.sourceReference},notes=${data.notes ?? ""},record_revision=record_revision+1,updated_at=now()
      where id=${data.id} and lifecycle_status='draft' and record_revision=${data.expectedRevision}
      returning record_revision as revision
    `;
    if(!updated[0]) throw new Error("Stale People record revision; reload before saving.");
    await audit(sql,{ entityType:"people_record",entityId:data.id,entityRevision:updated[0].revision,action:"PEOPLE_RECORD_DRAFT_SAVED",role,userId,sourceReference:data.sourceReference,previousState:"draft",newState:"draft",payload:{ engagementType:data.engagementType } });
    return { ok:true,id:data.id,status:"draft" as const,recordRevision:updated[0].revision };
  });

const costSchema = z.object({
  id: z.string().min(1).max(120),
  costGroup: z.enum(["payroll", "office", "statutory", "outsourcing"]),
  personId: z.string().min(1).max(120).nullable().optional(),
  name: z.string().min(1).max(300),
  stage: z.string().min(1).max(200),
  quantity: z.number().min(0),
  monthlyUnitCostLakh: z.number().min(0),
  startMonth: z.number().int().min(1).max(36),
  endMonth: z.number().int().min(1).max(36),
  oneTimeCostLakh: z.number().min(0),
  oneTimeMonth: z.number().int().min(1).max(36),
  sourceReference: z.string().min(1).max(500),
  notes: z.string().max(2000).optional(),
});

export const savePeopleOfficeCostDraft = createServerFn({ method: "POST" })
  .validator(costSchema)
  .handler(async ({ data }) => {
    await assertSameSiteRequest();
    const { userId, role } = await requirePermission("edit");
    if (data.endMonth < data.startMonth) throw new Error("People & Office cost end month cannot precede start month.");
    const sql = await getSql();
    if (data.personId) {
      const person = await sql<{ id: string }>`select id from vyndi_people_records where id=${data.personId} and lifecycle_status in ('draft','pending_approval','approved') limit 1`;
      if (!person[0]) throw new Error("Payroll input references an unavailable People record.");
    }
    const existing = await sql<{ lifecycleStatus: string }>`select lifecycle_status as "lifecycleStatus" from vyndi_people_office_cost_items where id=${data.id} limit 1`;
    if (existing[0] && existing[0].lifecycleStatus !== "draft") throw new Error("Only draft People & Office cost items may be edited.");
    await sql`
      insert into vyndi_people_office_cost_items (
        id,cost_group,person_id,name,stage,quantity,monthly_unit_cost_lakh,start_month,end_month,
        one_time_cost_lakh,one_time_month,lifecycle_status,source_ref,notes,created_by
      ) values (
        ${data.id},${data.costGroup},${data.personId ?? null},${data.name},${data.stage},${data.quantity},
        ${data.monthlyUnitCostLakh},${data.startMonth},${data.endMonth},${data.oneTimeCostLakh},${data.oneTimeMonth},
        'draft',${data.sourceReference},${data.notes ?? ""},${userId}
      )
      on conflict (id) do update set
        cost_group=excluded.cost_group,person_id=excluded.person_id,name=excluded.name,stage=excluded.stage,
        quantity=excluded.quantity,monthly_unit_cost_lakh=excluded.monthly_unit_cost_lakh,start_month=excluded.start_month,
        end_month=excluded.end_month,one_time_cost_lakh=excluded.one_time_cost_lakh,one_time_month=excluded.one_time_month,
        source_ref=excluded.source_ref,notes=excluded.notes,record_revision=vyndi_people_office_cost_items.record_revision+1,updated_at=now()
      where vyndi_people_office_cost_items.lifecycle_status='draft'
    `;
    await audit(sql,{ entityType:"people_office_cost",entityId:data.id,action:"PEOPLE_OFFICE_COST_DRAFT_SAVED",role,userId,sourceReference:data.sourceReference,newState:"draft",payload:{ costGroup:data.costGroup,personId:data.personId ?? null } });
    return { ok:true,id:data.id,status:"draft" as const };
  });

const assetSchema = z.object({
  id: z.string().min(1).max(120),
  name: z.string().min(1).max(300),
  category: z.string().min(1).max(200),
  assetClass: z.enum(["office_admin", "office_consumable", "manufacturing_tooling"]),
  costLakh: z.number().min(0),
  monthlyCostLakh: z.number().min(0),
  purchaseMonth: z.number().int().min(1).max(36),
  usefulLifeMonths: z.number().int().positive(),
  allocationPct: z.number().min(0).max(100),
  sourceReference: z.string().min(1).max(500),
  notes: z.string().max(2000).optional(),
});

export const savePeopleOfficeAssetDraft = createServerFn({ method: "POST" })
  .validator(assetSchema)
  .handler(async ({ data }) => {
    await assertSameSiteRequest();
    const { userId, role } = await requirePermission("edit");
    const sql = await getSql();
    const existing = await sql<{ lifecycleStatus: string }>`select lifecycle_status as "lifecycleStatus" from vyndi_people_office_assets where id=${data.id} limit 1`;
    if (existing[0] && existing[0].lifecycleStatus !== "draft") throw new Error("Only draft People & Office assets may be edited.");
    await sql`
      insert into vyndi_people_office_assets (
        id,name,category,asset_class,cost_lakh,monthly_cost_lakh,purchase_month,useful_life_months,
        allocation_pct,lifecycle_status,source_ref,notes,created_by
      ) values (
        ${data.id},${data.name},${data.category},${data.assetClass},${data.costLakh},${data.monthlyCostLakh},
        ${data.purchaseMonth},${data.usefulLifeMonths},${data.allocationPct},'draft',${data.sourceReference},${data.notes ?? ""},${userId}
      )
      on conflict (id) do update set
        name=excluded.name,category=excluded.category,asset_class=excluded.asset_class,cost_lakh=excluded.cost_lakh,
        monthly_cost_lakh=excluded.monthly_cost_lakh,purchase_month=excluded.purchase_month,useful_life_months=excluded.useful_life_months,
        allocation_pct=excluded.allocation_pct,source_ref=excluded.source_ref,notes=excluded.notes,
        record_revision=vyndi_people_office_assets.record_revision+1,updated_at=now()
      where vyndi_people_office_assets.lifecycle_status='draft'
    `;
    await audit(sql,{ entityType:"people_office_asset",entityId:data.id,action:"PEOPLE_OFFICE_ASSET_DRAFT_SAVED",role,userId,sourceReference:data.sourceReference,newState:"draft",payload:{ assetClass:data.assetClass } });
    return { ok:true,id:data.id,status:"draft" as const };
  });

const transitionSchema = z.object({
  id: z.string().min(1).max(120),
  toStatus: lifecycleSchema,
  sourceReference: z.string().min(1).max(500),
  note: z.string().min(1).max(2000),
});

const personTransitionSchema = transitionSchema.extend({
  expectedRevision: z.number().int().positive(),
});

function validTransition(fromStatus: string, toStatus: string) {
  return (fromStatus === "draft" && toStatus === "pending_approval")
    || (fromStatus === "pending_approval" && ["draft", "approved"].includes(toStatus))
    || (fromStatus === "approved" && toStatus === "superseded");
}

export const transitionPeopleOfficeCost = createServerFn({ method: "POST" })
  .validator(transitionSchema)
  .handler(async ({ data }) => {
    await assertSameSiteRequest();
    const { userId, role } = await requirePermission(["approved","superseded"].includes(data.toStatus) ? "approve" : "edit");
    const sql = await getSql();
    const rows = await sql<{ status:string; revision:number }>`select lifecycle_status as status,record_revision as revision from vyndi_people_office_cost_items where id=${data.id} limit 1`;
    const current=rows[0]; if(!current) throw new Error("People & Office cost item not found.");
    if(!validTransition(current.status,data.toStatus)) throw new Error(`Invalid People & Office cost transition: ${current.status} → ${data.toStatus}`);
    await sql`update vyndi_people_office_cost_items set lifecycle_status=${data.toStatus},record_revision=${current.revision+1},approved_by=case when ${data.toStatus}='approved' then ${userId} else approved_by end,updated_at=now() where id=${data.id}`;
    await audit(sql,{entityType:"people_office_cost",entityId:data.id,action:"PEOPLE_OFFICE_COST_STATUS_CHANGED",role,userId,sourceReference:data.sourceReference,previousState:current.status,newState:data.toStatus,reason:data.note});
    return {ok:true,fromStatus:current.status,toStatus:data.toStatus};
  });

export const transitionPeopleOfficeAsset = createServerFn({ method: "POST" })
  .validator(transitionSchema)
  .handler(async ({ data }) => {
    await assertSameSiteRequest();
    const { userId, role } = await requirePermission(["approved","superseded"].includes(data.toStatus) ? "approve" : "edit");
    const sql = await getSql();
    const rows = await sql<{ status:string; revision:number }>`select lifecycle_status as status,record_revision as revision from vyndi_people_office_assets where id=${data.id} limit 1`;
    const current=rows[0]; if(!current) throw new Error("People & Office asset not found.");
    if(!validTransition(current.status,data.toStatus)) throw new Error(`Invalid People & Office asset transition: ${current.status} → ${data.toStatus}`);
    await sql`update vyndi_people_office_assets set lifecycle_status=${data.toStatus},record_revision=${current.revision+1},approved_by=case when ${data.toStatus}='approved' then ${userId} else approved_by end,updated_at=now() where id=${data.id}`;
    await audit(sql,{entityType:"people_office_asset",entityId:data.id,action:"PEOPLE_OFFICE_ASSET_STATUS_CHANGED",role,userId,sourceReference:data.sourceReference,previousState:current.status,newState:data.toStatus,reason:data.note});
    return {ok:true,fromStatus:current.status,toStatus:data.toStatus};
  });

export const transitionPeopleRecord = createServerFn({ method: "POST" })
  .validator(personTransitionSchema)
  .handler(async ({ data }) => {
    await assertSameSiteRequest();
    const { userId, role } = await requirePermission(["approved","superseded"].includes(data.toStatus) ? "approve" : "edit");
    const sql = await getSql();
    const rows = await sql<{ status:string; revision:number }>`
      select lifecycle_status as status,record_revision as revision
      from vyndi_people_records where id=${data.id} limit 1
    `;
    const current=rows[0]; if(!current) throw new Error("People record not found.");
    if(current.revision!==data.expectedRevision) throw new Error(`Stale People record revision: expected ${data.expectedRevision}, current ${current.revision}.`);
    if(!validTransition(current.status,data.toStatus)) throw new Error(`Invalid People record transition: ${current.status} → ${data.toStatus}`);
    const updated=await sql<{revision:number}>`
      update vyndi_people_records set
        lifecycle_status=${data.toStatus},
        record_revision=record_revision+1,
        approved_by=case when ${data.toStatus}='approved' then ${userId} else approved_by end,
        updated_at=now()
      where id=${data.id} and record_revision=${data.expectedRevision}
      returning record_revision as revision
    `;
    if(!updated[0]) throw new Error("Stale People record revision; reload before changing lifecycle.");
    await audit(sql,{entityType:"people_record",entityId:data.id,entityRevision:updated[0].revision,action:"PEOPLE_RECORD_STATUS_CHANGED",role,userId,sourceReference:data.sourceReference,previousState:current.status,newState:data.toStatus,reason:data.note});
    return {ok:true,fromStatus:current.status,toStatus:data.toStatus,recordRevision:updated[0].revision};
  });

const operationsPageSchema=z.object({
  page:z.number().int().min(0).default(0),
  pageSize:z.number().int().min(1).max(100).default(50),
  personId:z.string().min(1).max(120).nullable().optional(),
});

export const listPeopleOfficeOperations=createServerFn({method:"GET"})
  .validator(operationsPageSchema)
  .handler(async({data})=>{
    await assertSameSiteRequest();
    await requirePermission("view");
    const sql=await getSql();
    const limit=data.pageSize;
    const offset=data.page*data.pageSize;
    const person=data.personId??null;
    const where=person?" where person_id=$3":"";
    const params=person?[limit,offset,person]:[limit,offset];
    const [employment,attendance,leave,qualifications,custody,access,payroll,exitCases]=await Promise.all([
      sql.query(`select * from vyndi_people_employment_ledger${where} order by effective_on desc,created_at desc limit $1 offset $2`,params),
      sql.query(`select * from vyndi_people_attendance_current${where} order by work_date desc,created_at desc limit $1 offset $2`,params),
      sql.query(`select * from vyndi_people_leave_ledger${where} order by effective_on desc,created_at desc limit $1 offset $2`,params),
      sql.query(`select * from vyndi_people_qualification_current${where} order by qualification_code,created_at desc limit $1 offset $2`,params),
      sql.query(`select * from vyndi_people_asset_custody_current${where} order by occurred_at desc,created_at desc limit $1 offset $2`,params),
      sql.query(`select * from vyndi_people_access_current${where} order by occurred_at desc,created_at desc limit $1 offset $2`,params),
      sql.query(`select * from vyndi_people_payroll_readiness_current${where} order by period_key desc,created_at desc limit $1 offset $2`,params),
      sql.query(`select c.*,r.can_finalize,r.open_asset_custody_count,r.active_access_count,r.payroll_settled,r.handover_ready,r.leave_reconciled,r.department_clearance_ready
        from vyndi_people_exit_cases c
        left join vyndi_people_exit_readiness r on r.exit_case_id=c.id
        ${person?"where c.person_id=$3":""}
        order by c.created_at desc limit $1 offset $2`,params),
    ]);
    return {page:data.page,pageSize:data.pageSize,employment,attendance,leave,qualifications,custody,access,payroll,exitCases};
  });

const operationalEvidence=z.object({
  personId:z.string().min(1).max(120),
  sourceReference:z.string().min(1).max(500),
  evidenceReference:z.string().min(1).max(500),
});

export const recordEmploymentEvent=createServerFn({method:"POST"})
  .validator(operationalEvidence.extend({
    eventType:z.enum(["joined","role_change","transfer","promotion","compensation_change","status_change"]),
    effectiveOn:z.string().date(),
    details:z.record(z.string(),z.unknown()).default({}),
    operationalStatus:z.enum(["planned","active","on_leave","exiting","inactive"]).nullable().optional(),
    expectedRevision:z.number().int().positive(),
  }))
  .handler(async({data})=>{
    await assertSameSiteRequest();
    const actor=await requirePermission("edit");
    const sql=await getSql();
    const id=crypto.randomUUID();
    const rows=await sql.query<{new_revision:number;resulting_operational_status:string}>(
      "select * from record_vyndi_people_employment_event($1,$2,$3,$4::date,$5::jsonb,$6,$7,$8,$9,$10,$11)",
      [id,data.personId,data.eventType,data.effectiveOn,JSON.stringify(data.details),data.operationalStatus??null,data.expectedRevision,data.sourceReference,data.evidenceReference,actor.userId,actor.role],
    );
    const row=rows[0]; if(!row) throw new Error("Employment event was not recorded.");
    await audit(sql,{entityType:"people_employment",entityId:id,entityRevision:Number(row.new_revision),action:"PEOPLE_EMPLOYMENT_EVENT_RECORDED",role:actor.role,userId:actor.userId,sourceReference:data.sourceReference,payload:{personId:data.personId,eventType:data.eventType,evidenceReference:data.evidenceReference}});
    return {ok:true,id,recordRevision:Number(row.new_revision),operationalStatus:row.resulting_operational_status};
  });

export const recordAttendance=createServerFn({method:"POST"})
  .validator(operationalEvidence.extend({
    workDate:z.string().date(),
    attendanceStatus:z.enum(["present","absent","leave","holiday","remote","travel"]),
    workedHours:z.number().min(0).max(24).default(0),
    overtimeHours:z.number().min(0).max(24).default(0),
    notes:z.string().max(2000).default(""),
  }))
  .handler(async({data})=>{
    await assertSameSiteRequest(); const actor=await requirePermission("edit"); const sql=await getSql(); const id=crypto.randomUUID();
    const rows=await sql.query<{attendance_revision:number}>(
      "select * from record_vyndi_people_attendance($1,$2,$3::date,$4,$5,$6,$7,$8,$9,$10,$11)",
      [id,data.personId,data.workDate,data.attendanceStatus,data.workedHours,data.overtimeHours,data.notes,data.sourceReference,data.evidenceReference,actor.userId,actor.role],
    );
    const revision=Number(rows[0]?.attendance_revision??0);
    await audit(sql,{entityType:"people_attendance",entityId:id,entityRevision:revision,action:"PEOPLE_ATTENDANCE_RECORDED",role:actor.role,userId:actor.userId,sourceReference:data.sourceReference,payload:{personId:data.personId,workDate:data.workDate,status:data.attendanceStatus,evidenceReference:data.evidenceReference}});
    return {ok:true,id,revision};
  });

export const postLeaveTransaction=createServerFn({method:"POST"})
  .validator(operationalEvidence.extend({
    leaveType:z.string().min(1).max(120),
    transactionType:z.enum(["entitlement","accrual","approved_leave","cancellation","adjustment","expiry"]),
    direction:z.enum(["credit","debit"]),
    quantityDays:z.number().positive(),
    effectiveOn:z.string().date(),
    relatedReference:z.string().max(300).nullable().optional(),
    notes:z.string().max(2000).default(""),
  }))
  .handler(async({data})=>{
    await assertSameSiteRequest(); const actor=await requirePermission("edit"); const sql=await getSql(); const id=crypto.randomUUID();
    const rows=await sql.query<{balance_days:number|string}>(
      "select * from post_vyndi_people_leave_transaction($1,$2,$3,$4,$5,$6,$7::date,$8,$9,$10,$11,$12,$13)",
      [id,data.personId,data.leaveType,data.transactionType,data.direction,data.quantityDays,data.effectiveOn,data.relatedReference??null,data.notes,data.sourceReference,data.evidenceReference,actor.userId,actor.role],
    );
    await audit(sql,{entityType:"people_leave",entityId:id,action:"PEOPLE_LEAVE_TRANSACTION_POSTED",role:actor.role,userId:actor.userId,sourceReference:data.sourceReference,payload:{personId:data.personId,leaveType:data.leaveType,transactionType:data.transactionType,direction:data.direction,quantityDays:data.quantityDays,evidenceReference:data.evidenceReference}});
    return {ok:true,id,balanceDays:Number(rows[0]?.balance_days??0)};
  });

export const recordQualification=createServerFn({method:"POST"})
  .validator(operationalEvidence.extend({
    qualificationCode:z.string().min(1).max(120),
    qualificationTitle:z.string().min(1).max(300),
    eventType:z.enum(["obtained","renewed","superseded","revoked"]),
    effectiveOn:z.string().date(),
    validUntil:z.string().date().nullable().optional(),
    certificateReference:z.string().max(500).nullable().optional(),
    notes:z.string().max(2000).default(""),
  }))
  .handler(async({data})=>{
    await assertSameSiteRequest(); const actor=await requirePermission("edit"); const sql=await getSql(); const id=crypto.randomUUID();
    await sql.query("select record_vyndi_people_qualification($1,$2,$3,$4,$5,$6::date,$7::date,$8,$9,$10,$11,$12,$13)",[id,data.personId,data.qualificationCode,data.qualificationTitle,data.eventType,data.effectiveOn,data.validUntil??null,data.certificateReference??null,data.notes,data.sourceReference,data.evidenceReference,actor.userId,actor.role]);
    await audit(sql,{entityType:"people_qualification",entityId:id,action:"PEOPLE_QUALIFICATION_RECORDED",role:actor.role,userId:actor.userId,sourceReference:data.sourceReference,payload:{personId:data.personId,qualificationCode:data.qualificationCode,eventType:data.eventType,evidenceReference:data.evidenceReference}});
    return {ok:true,id};
  });

export const recordAssetCustodyEvent=createServerFn({method:"POST"})
  .validator(operationalEvidence.extend({
    assetId:z.string().min(1).max(120),
    eventType:z.enum(["issue","transfer_in","transfer_out","return"]),
    occurredAt:z.string().datetime().nullable().optional(),
    notes:z.string().max(2000).default(""),
  }))
  .handler(async({data})=>{
    await assertSameSiteRequest(); const actor=await requirePermission("edit"); const sql=await getSql(); const id=crypto.randomUUID();
    await sql.query("select record_vyndi_people_asset_custody($1,$2,$3,$4,$5::timestamptz,$6,$7,$8,$9,$10)",[id,data.personId,data.assetId,data.eventType,data.occurredAt??null,data.notes,data.sourceReference,data.evidenceReference,actor.userId,actor.role]);
    await audit(sql,{entityType:"people_asset_custody",entityId:id,action:"PEOPLE_ASSET_CUSTODY_RECORDED",role:actor.role,userId:actor.userId,sourceReference:data.sourceReference,payload:{personId:data.personId,assetId:data.assetId,eventType:data.eventType,evidenceReference:data.evidenceReference}});
    return {ok:true,id};
  });

export const recordAccessEvent=createServerFn({method:"POST"})
  .validator(operationalEvidence.extend({
    accessReference:z.string().min(1).max(300),
    eventType:z.enum(["grant","change","suspend","revoke"]),
    roleScope:z.string().max(300).default(""),
    occurredAt:z.string().datetime().nullable().optional(),
    notes:z.string().max(2000).default(""),
  }))
  .handler(async({data})=>{
    await assertSameSiteRequest(); const actor=await requirePermission("approve"); const sql=await getSql(); const id=crypto.randomUUID();
    await sql.query("select record_vyndi_people_access_event($1,$2,$3,$4,$5,$6::timestamptz,$7,$8,$9,$10,$11)",[id,data.personId,data.accessReference,data.eventType,data.roleScope,data.occurredAt??null,data.notes,data.sourceReference,data.evidenceReference,actor.userId,actor.role]);
    await audit(sql,{entityType:"people_access",entityId:id,action:"PEOPLE_ACCESS_EVENT_RECORDED",role:actor.role,userId:actor.userId,sourceReference:data.sourceReference,payload:{personId:data.personId,accessReference:data.accessReference,eventType:data.eventType,evidenceReference:data.evidenceReference}});
    return {ok:true,id};
  });

export const recordPayrollReadiness=createServerFn({method:"POST"})
  .validator(operationalEvidence.extend({
    periodKey:z.string().min(1).max(40),
    readinessStatus:z.enum(["pending","ready","hold","settled"]),
    basis:z.record(z.string(),z.unknown()).default({}),
  }))
  .handler(async({data})=>{
    await assertSameSiteRequest(); const actor=await requirePermission("approve"); const sql=await getSql(); const id=crypto.randomUUID();
    await sql.query("select record_vyndi_people_payroll_readiness($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9)",[id,data.personId,data.periodKey,data.readinessStatus,JSON.stringify(data.basis),data.sourceReference,data.evidenceReference,actor.userId,actor.role]);
    await audit(sql,{entityType:"people_payroll_readiness",entityId:id,action:"PEOPLE_PAYROLL_READINESS_RECORDED",role:actor.role,userId:actor.userId,sourceReference:data.sourceReference,payload:{personId:data.personId,periodKey:data.periodKey,status:data.readinessStatus,evidenceReference:data.evidenceReference}});
    return {ok:true,id};
  });

export const initiatePeopleExit=createServerFn({method:"POST"})
  .validator(operationalEvidence.extend({effectiveOn:z.string().date(),expectedRevision:z.number().int().positive()}))
  .handler(async({data})=>{
    await assertSameSiteRequest(); const actor=await requirePermission("approve"); const sql=await getSql(); const id=crypto.randomUUID();
    const rows=await sql.query<{new_revision:number}>("select * from initiate_vyndi_people_exit($1,$2,$3::date,$4,$5,$6,$7,$8)",[id,data.personId,data.effectiveOn,data.expectedRevision,data.sourceReference,data.evidenceReference,actor.userId,actor.role]);
    const revision=Number(rows[0]?.new_revision??0);
    await audit(sql,{entityType:"people_exit",entityId:id,entityRevision:revision,action:"PEOPLE_EXIT_INITIATED",role:actor.role,userId:actor.userId,sourceReference:data.sourceReference,newState:"open",payload:{personId:data.personId,effectiveOn:data.effectiveOn,evidenceReference:data.evidenceReference}});
    return {ok:true,id,recordRevision:revision};
  });

export const recordExitClearance=createServerFn({method:"POST"})
  .validator(z.object({
    exitCaseId:z.string().min(1).max(120),
    clearanceType:z.enum(["handover","leave_reconciliation","payroll_settlement","asset_return","access_revocation","department_clearance"]),
    clearanceStatus:z.enum(["pending","cleared","waived","blocked"]),
    notes:z.string().max(2000).default(""),
    sourceReference:z.string().min(1).max(500),
    evidenceReference:z.string().min(1).max(500),
  }))
  .handler(async({data})=>{
    await assertSameSiteRequest(); const actor=await requirePermission("approve"); const sql=await getSql(); const id=crypto.randomUUID();
    const rows=await sql.query<{clearance_revision:number}>("select * from record_vyndi_people_exit_clearance($1,$2,$3,$4,$5,$6,$7,$8,$9)",[id,data.exitCaseId,data.clearanceType,data.clearanceStatus,data.notes,data.sourceReference,data.evidenceReference,actor.userId,actor.role]);
    const revision=Number(rows[0]?.clearance_revision??0);
    await audit(sql,{entityType:"people_exit_clearance",entityId:id,entityRevision:revision,action:"PEOPLE_EXIT_CLEARANCE_RECORDED",role:actor.role,userId:actor.userId,sourceReference:data.sourceReference,payload:{exitCaseId:data.exitCaseId,clearanceType:data.clearanceType,status:data.clearanceStatus,evidenceReference:data.evidenceReference}});
    return {ok:true,id,revision};
  });

export const finalizePeopleExit=createServerFn({method:"POST"})
  .validator(z.object({
    exitCaseId:z.string().min(1).max(120),
    expectedRevision:z.number().int().positive(),
    sourceReference:z.string().min(1).max(500),
    evidenceReference:z.string().min(1).max(500),
  }))
  .handler(async({data})=>{
    await assertSameSiteRequest(); const actor=await requirePermission("approve"); const sql=await getSql();
    const rows=await sql.query<{new_revision:number;person_status:string}>("select * from finalize_vyndi_people_exit($1,$2,$3,$4,$5,$6)",[data.exitCaseId,data.expectedRevision,data.sourceReference,data.evidenceReference,actor.userId,actor.role]);
    const row=rows[0]; if(!row) throw new Error("People exit was not finalized.");
    await audit(sql,{entityType:"people_exit",entityId:data.exitCaseId,entityRevision:Number(row.new_revision),action:"PEOPLE_EXIT_FINALIZED",role:actor.role,userId:actor.userId,sourceReference:data.sourceReference,previousState:"open",newState:"closed",payload:{personStatus:row.person_status,evidenceReference:data.evidenceReference}});
    return {ok:true,recordRevision:Number(row.new_revision),personStatus:row.person_status};
  });

