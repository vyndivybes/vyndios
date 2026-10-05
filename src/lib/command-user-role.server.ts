import { getSql } from "@/lib/db";
import { getRequest } from "@tanstack/react-start/server";
import { createRequestMemoizer } from "@/lib/request-memo.server";
import type { CommandRole } from "@/lib/page-access";

const roleRequestMemo = createRequestMemoizer<CommandRole | null>();

function getBootstrapAdminEmails(): string[] {
  return (process.env.VINDY_ADMIN_EMAILS ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Resolve the role assigned to one verified Better Auth identity.
 *
 * This is intentionally a plain server helper rather than a createServerFn so
 * mutation authorities can resolve identity + role inside one request context.
 */
export async function getAssignedCommandRole(
  userId: string,
  email?: string | null,
): Promise<CommandRole | null> {
  const normalizedEmail = email?.trim().toLowerCase();
  const resolveRole = async (): Promise<CommandRole | null> => {
    if (normalizedEmail && getBootstrapAdminEmails().includes(normalizedEmail)) {
      return "admin";
    }

    const sql = await getSql();
    const rows = await sql<{ role: string }>`
      select role from vindy_user_roles where user_id = ${userId} limit 1
    `;
    return (rows[0]?.role as CommandRole | undefined) ?? null;
  };

  const request = getRequest();
  if (!request) return resolveRole();

  return roleRequestMemo(
    request,
    `${userId}|${normalizedEmail ?? ""}`,
    resolveRole,
  );
}
