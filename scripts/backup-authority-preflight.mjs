import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Validate redacted, aggregate-only PostgreSQL evidence from the exact
 * connection intended for pg_dump. Never accept an owner or elevated writer.
 */
export function assessBackupRoleEvidence(evidence) {
  const lines = String(evidence ?? "").trim().split(/\r?\n/).filter(Boolean);
  if (lines.length !== 1) throw new Error("BACKUP_PREFLIGHT_INVALID_FORMAT");
  const values = lines[0].split("|");
  if (values.length !== 10) throw new Error("BACKUP_PREFLIGHT_INVALID_FORMAT");
  const [role, superuser, bypassRls, createRole, createDb, canLogin,
    tableCountText, missingSelectText, mutationText, rlsCountText] = values;

  if (![superuser, bypassRls, createRole, createDb, canLogin].every(v => v === "t" || v === "f"))
    throw new Error("BACKUP_PREFLIGHT_INVALID_FORMAT");
  if (![tableCountText, missingSelectText, mutationText, rlsCountText].every(v => /^(0|[1-9]\d*)$/.test(v)))
    throw new Error("BACKUP_PREFLIGHT_INVALID_FORMAT");
  const [tableCount, missingSelect, mutationCount, rlsTableCount] =
    [tableCountText, missingSelectText, mutationText, rlsCountText].map(Number);
  if (![tableCount, missingSelect, mutationCount, rlsTableCount].every(Number.isSafeInteger))
    throw new Error("BACKUP_PREFLIGHT_INVALID_FORMAT");

  if (role !== "vyndi_books_backup_ro")
    throw new Error("BACKUP_PREFLIGHT_DEDICATED_ROLE_REQUIRED");
  if (superuser === "t" || createRole === "t" || createDb === "t" || canLogin !== "t")
    throw new Error("BACKUP_PREFLIGHT_PRIVILEGED_IDENTITY");
  if (tableCount < 1 || rlsTableCount > tableCount)
    throw new Error("BACKUP_PREFLIGHT_INVALID_TABLES");
  if (missingSelect > 0)
    throw new Error("BACKUP_PREFLIGHT_INCOMPLETE_SELECT");
  if (mutationCount > 0)
    throw new Error("BACKUP_PREFLIGHT_MUTATION_GRANTS");
  if (rlsTableCount > 0 && bypassRls !== "t")
    throw new Error("BACKUP_PREFLIGHT_RLS_AUTHORIZATION_REQUIRED");

  return { tableCount, rlsTableCount };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const summary = assessBackupRoleEvidence(readFileSync(0, "utf8"));
    console.log(`BACKUP_AUTHORITY_PREFLIGHT_PASS tables=${summary.tableCount} rls=${summary.rlsTableCount}`);
  } catch (error) {
    // Deliberately print a fixed allowlisted reason, never raw SQL/output/error data.
    const allowed = new Set([
      "BACKUP_PREFLIGHT_INVALID_FORMAT", "BACKUP_PREFLIGHT_DEDICATED_ROLE_REQUIRED",
      "BACKUP_PREFLIGHT_PRIVILEGED_IDENTITY", "BACKUP_PREFLIGHT_INVALID_TABLES",
      "BACKUP_PREFLIGHT_INCOMPLETE_SELECT", "BACKUP_PREFLIGHT_MUTATION_GRANTS",
      "BACKUP_PREFLIGHT_RLS_AUTHORIZATION_REQUIRED",
    ]);
    console.error(allowed.has(error?.message) ? error.message : "BACKUP_PREFLIGHT_HOLD");
    process.exitCode = 1;
  }
}
