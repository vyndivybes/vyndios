import { spawn } from "node:child_process";

const envName = (process.env.VYNDI_DEPLOYMENT_ENV || process.env.NODE_ENV || "development").toLowerCase();
const production = envName === "production";
const backupRef = process.env.VYNDI_MIGRATION_BACKUP_REF?.trim() || "";
const sourceSha = process.env.VYNDI_SOURCE_SHA?.trim() || process.env.GITHUB_SHA?.trim() || "";
const approved = process.env.VYNDI_MIGRATION_APPROVED === "1";

if (production) {
  if (!backupRef) throw new Error("Production migration blocked: VYNDI_MIGRATION_BACKUP_REF is required.");
  if (!/^[0-9a-z][0-9a-z._:/-]{5,200}$/i.test(backupRef)) throw new Error("Production migration blocked: backup reference is malformed.");
  if (!/^[0-9a-f]{7,64}$/i.test(sourceSha)) throw new Error("Production migration blocked: exact VYNDI_SOURCE_SHA/GITHUB_SHA is required.");
  if (!approved) throw new Error("Production migration blocked: VYNDI_MIGRATION_APPROVED=1 is required.");
}

console.log(JSON.stringify({
  event: "vyndi.migration.release-gate",
  environment: envName,
  production,
  backupRef: backupRef || null,
  sourceSha: sourceSha || null,
  approved,
}));

const child = spawn(process.execPath, ["scripts/migrate.mjs"], {
  stdio: "inherit",
  env: process.env,
});
child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`[migration-release] terminated by ${signal}`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});
