import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "@/lib/auth/middleware";
import { getAssignedCommandRole } from "@/lib/command-user-role.server";
import { getSql } from "@/lib/db";
import type { CommandRole } from "@/lib/page-access";

const roleSchema = z.enum(["admin","management","board","finance","operations","engineering","qa","compliance","viewer"]);
const reference = z.string().trim().min(3).max(500);

function bootstrapAdminEmails(): string[] {
  return (process.env.VINDY_ADMIN_EMAILS ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

export function isBootstrapAdminEmail(email: string | null | undefined): boolean {
  const normalized = email?.trim().toLowerCase();
  return Boolean(normalized && bootstrapAdminEmails().includes(normalized));
}

async function requireAdmin(userId: string, email?: string | null) {
  const role = await getAssignedCommandRole(userId, email);
  if (role !== "admin") throw new Error("Admin access is required.");
  return { userId, role, bootstrapAdmin: isBootstrapAdminEmail(email) };
}

export type AccessUserRow = {
  id: string;
  name: string | null;
  email: string | null;
  role: string | null;
  role_updated_at: string | null;
  active_sessions: number;
};

export type PendingRoleChangeRow = {
  id: string;
  target_user_id: string;
  target_name: string | null;
  target_email: string | null;
  from_role: string | null;
  to_role: string;
  reason: string;
  status: string;
  requested_by: string;
  requested_at: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  emergency_override: boolean;
};

export type AccessEventRow = {
  id: string;
  event_type: string;
  target_user_id: string | null;
  actor_user_id: string;
  actor_role: string;
  role_before: string | null;
  role_after: string | null;
  reason: string | null;
  source_reference: string | null;
  metadata_json: string;
  created_at: string;
};

export type AccessCertificationRow = {
  id: string;
  captured_by: string;
  actor_role: string;
  source_reference: string;
  snapshot_json: string;
  exception_count: number;
  created_at: string;
};

export type AccessGovernanceWorkspace = {
  users: AccessUserRow[];
  pending: PendingRoleChangeRow[];
  events: AccessEventRow[];
  certifications: AccessCertificationRow[];
  exceptions: Array<{ code:string; severity:"critical"|"warning"; userId?:string; message:string }>;
  me: { id:string; bootstrapAdmin:boolean };
};

function accessExceptions(users: AccessUserRow[], pending: PendingRoleChangeRow[]) {
  const bootstrap = new Set(bootstrapAdminEmails());
  const exceptions: Array<{ code:string; severity:"critical"|"warning"; userId?:string; message:string }> = [];

  for (const user of users) {
    if (!user.role) {
      exceptions.push({ code:"UNASSIGNED_ROLE", severity:"critical", userId:user.id, message:`${user.email ?? user.id} has no VYNDI role assignment.` });
    }
    if (user.email && bootstrap.has(user.email.trim().toLowerCase()) && user.role !== "admin") {
      exceptions.push({ code:"BOOTSTRAP_ADMIN_ROLE_DRIFT", severity:"critical", userId:user.id, message:`${user.email} is configured as bootstrap administrator but is not assigned admin.` });
    }
    if (Number(user.active_sessions) > 3) {
      exceptions.push({ code:"SESSION_CAP_BREACH", severity:"warning", userId:user.id, message:`${user.email ?? user.id} has ${user.active_sessions} active sessions; expected maximum is 3.` });
    }
  }

  for (const request of pending) {
    exceptions.push({ code:"PENDING_ROLE_CHANGE", severity:"warning", userId:request.target_user_id, message:`Role change ${request.id} remains pending for ${request.target_email ?? request.target_user_id}.` });
  }
  return exceptions;
}

async function readWorkspace(sql: Awaited<ReturnType<typeof getSql>>) {
  const [users,pending,events,certifications] = await Promise.all([
    sql.query<AccessUserRow>(
      `select u.id,u.name,u.email,r.role,r.updated_at::text as role_updated_at,
              coalesce(s.active_sessions,0)::int as active_sessions
         from "user" u
         left join vindy_user_roles r on r.user_id=u.id
         left join (
           select "userId" as user_id,count(*)::int as active_sessions
             from "session" where "expiresAt">now() group by "userId"
         ) s on s.user_id=u.id
        order by u."createdAt" desc`,
    ),
    sql.query<PendingRoleChangeRow>(
      `select q.id,q.target_user_id,u.name as target_name,u.email as target_email,
              q.from_role,q.to_role,q.reason,q.status,q.requested_by,
              q.requested_at::text,q.decided_by,q.decided_at::text,q.decision_note,q.emergency_override
         from vyndi_access_role_change_requests q
         left join "user" u on u.id=q.target_user_id
        where q.status='pending'
        order by q.requested_at asc`,
    ),
    sql.query<{
      id:string; event_type:string; target_user_id:string|null; actor_user_id:string; actor_role:string;
      role_before:string|null; role_after:string|null; reason:string|null; source_reference:string|null;
      metadata_json:unknown; created_at:string;
    }>(
      `select id,event_type,target_user_id,actor_user_id,actor_role,role_before,role_after,
              reason,source_reference,metadata_json,created_at::text as created_at
         from vyndi_access_events order by created_at desc limit 100`,
    ),
    sql.query<{
      id:string; captured_by:string; actor_role:string; source_reference:string;
      snapshot_json:unknown; exception_count:number; created_at:string;
    }>(
      `select id,captured_by,actor_role,source_reference,snapshot_json,exception_count,
              created_at::text as created_at
         from vyndi_access_certifications order by created_at desc limit 20`,
    ),
  ]);
  const exceptions=accessExceptions(users,pending);
  return {
    users,
    pending,
    events: events.map((row)=>({
      id:String(row.id),
      event_type:String(row.event_type),
      target_user_id:row.target_user_id ? String(row.target_user_id) : null,
      actor_user_id:String(row.actor_user_id),
      actor_role:String(row.actor_role),
      role_before:row.role_before ? String(row.role_before) : null,
      role_after:row.role_after ? String(row.role_after) : null,
      reason:row.reason ? String(row.reason) : null,
      source_reference:row.source_reference ? String(row.source_reference) : null,
      metadata_json:JSON.stringify(row.metadata_json ?? {}),
      created_at:String(row.created_at),
    })) satisfies AccessEventRow[],
    certifications: certifications.map((row)=>({
      id:String(row.id),
      captured_by:String(row.captured_by),
      actor_role:String(row.actor_role),
      source_reference:String(row.source_reference),
      snapshot_json:JSON.stringify(row.snapshot_json ?? {}),
      exception_count:Number(row.exception_count ?? 0),
      created_at:String(row.created_at),
    })) satisfies AccessCertificationRow[],
    exceptions,
  };
}

export const getVindyAccessGovernance = createServerFn({ method:"GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const actor=await requireAdmin(context.userId,context.userEmail);
    const sql=await getSql();
    const workspace=await readWorkspace(sql);
    return { ...workspace, me:{ id:actor.userId, bootstrapAdmin:actor.bootstrapAdmin } } satisfies AccessGovernanceWorkspace;
  });

export const requestVindyUserRoleChange = createServerFn({ method:"POST" })
  .validator(z.object({ userId:z.string().min(1).max(200), role:roleSchema, reason:reference }))
  .middleware([authMiddleware])
  .handler(async ({ data,context }) => {
    const actor=await requireAdmin(context.userId,context.userEmail);
    const sql=await getSql();
    const target=await sql.query<{email:string|null}>(`select email from "user" where id=$1 limit 1`,[data.userId]);
    if(!target[0]) throw new Error("User account was not found.");
    if(isBootstrapAdminEmail(target[0].email) && data.role!=="admin") {
      throw new Error("The configured bootstrap administrator cannot be downgraded.");
    }
    const id=`ACCESS-${crypto.randomUUID()}`;
    const rows=await sql.query<{request_id:string;from_role:string|null;to_role:string}>(
      `select * from request_vyndi_role_change($1,$2,$3,$4,$5,$6)`,
      [id,data.userId,data.role,data.reason,actor.userId,actor.role],
    );
    return { ok:true,id:rows[0]?.request_id ?? id,fromRole:rows[0]?.from_role ?? null,toRole:rows[0]?.to_role ?? data.role };
  });

export const approveVindyUserRoleChange = createServerFn({ method:"POST" })
  .validator(z.object({ requestId:z.string().min(1).max(200), note:z.string().trim().max(500).optional() }))
  .middleware([authMiddleware])
  .handler(async ({ data,context }) => {
    const actor=await requireAdmin(context.userId,context.userEmail);
    const sql=await getSql();
    const rows=await sql.query<{target_user_id:string;applied_role:string;request_status:string}>(
      `select * from decide_vyndi_role_change($1,'approve',$2,$3,$4)`,
      [data.requestId,data.note ?? "",actor.userId,actor.role],
    );
    return { ok:true,targetUserId:rows[0]?.target_user_id,role:rows[0]?.applied_role,status:rows[0]?.request_status };
  });

export const rejectVindyUserRoleChange = createServerFn({ method:"POST" })
  .validator(z.object({ requestId:z.string().min(1).max(200), note:reference }))
  .middleware([authMiddleware])
  .handler(async ({ data,context }) => {
    const actor=await requireAdmin(context.userId,context.userEmail);
    const sql=await getSql();
    const rows=await sql.query<{target_user_id:string;applied_role:string;request_status:string}>(
      `select * from decide_vyndi_role_change($1,'reject',$2,$3,$4)`,
      [data.requestId,data.note,actor.userId,actor.role],
    );
    return { ok:true,targetUserId:rows[0]?.target_user_id,status:rows[0]?.request_status };
  });

export const emergencyApplyVindyUserRoleChange = createServerFn({ method:"POST" })
  .validator(z.object({ requestId:z.string().min(1).max(200), reason:z.string().trim().min(8).max(500) }))
  .middleware([authMiddleware])
  .handler(async ({ data,context }) => {
    const actor=await requireAdmin(context.userId,context.userEmail);
    if(!actor.bootstrapAdmin) throw new Error("Break-glass access is restricted to a configured bootstrap administrator.");
    const sql=await getSql();
    const rows=await sql.query<{target_user_id:string;applied_role:string;request_status:string}>(
      `select * from emergency_apply_vyndi_role_change($1,$2,$3,$4)`,
      [data.requestId,data.reason,actor.userId,actor.role],
    );
    return { ok:true,targetUserId:rows[0]?.target_user_id,role:rows[0]?.applied_role,status:rows[0]?.request_status,emergencyOverride:true };
  });

export const captureVindyAccessCertification = createServerFn({ method:"POST" })
  .validator(z.object({ sourceReference:reference }))
  .middleware([authMiddleware])
  .handler(async ({ data,context }) => {
    const actor=await requireAdmin(context.userId,context.userEmail);
    const sql=await getSql();
    const workspace=await readWorkspace(sql);
    const snapshot={
      capturedAt:new Date().toISOString(),
      users:workspace.users.map((user)=>({
        id:user.id,email:user.email,role:user.role,roleUpdatedAt:user.role_updated_at,
        activeSessions:Number(user.active_sessions),
      })),
      pendingRoleChanges:workspace.pending.map((row)=>({
        id:row.id,targetUserId:row.target_user_id,fromRole:row.from_role,toRole:row.to_role,
        requestedBy:row.requested_by,requestedAt:row.requested_at,
      })),
      exceptions:workspace.exceptions,
      singleRolePerUser:true,
      makerCheckerRequired:true,
    };
    const id=`ACCESS-CERT-${crypto.randomUUID()}`;
    await sql.query(
      `select capture_vyndi_access_certification($1,$2,$3::jsonb,$4,$5,$6)`,
      [id,data.sourceReference,JSON.stringify(snapshot),workspace.exceptions.length,actor.userId,actor.role],
    );
    return { ok:true,id,exceptionCount:workspace.exceptions.length };
  });

export async function recordVindyPrivilegedAccessEvent(input:{
  id:string;
  eventType:"user_provisioned"|"password_reset"|"user_deleted";
  targetUserId:string;
  actorUserId:string;
  actorRole:CommandRole;
  roleBefore?:CommandRole|null;
  roleAfter?:CommandRole|null;
  reason?:string;
  sourceReference?:string;
  metadata?:Record<string,unknown>;
}) {
  const sql=await getSql();
  await sql.query(
    `select record_vyndi_access_event($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
    [input.id,input.eventType,input.targetUserId,input.actorUserId,input.actorRole,
     input.roleBefore ?? null,input.roleAfter ?? null,input.reason ?? null,
     input.sourceReference ?? null,JSON.stringify(input.metadata ?? {})],
  );
}
