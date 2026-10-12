/** Validation of objective backup-object evidence, not a statutory audit opinion. */
const indiaRegions = new Set(["ap-south-1", "ap-south-2"]);
const digest = /^[0-9a-f]{64}$/i;
export function assessIndiaBackupProof(proof) {
  const failed = [];
  if (!proof || typeof proof !== "object") {
    return { state: "BACKUP_OBJECT_NOT_VERIFIED", failed: ["Backup evidence unavailable"] };
  }
  if (!indiaRegions.has(proof.region)) failed.push("Storage bucket is not in a verified India AWS region");
  if (proof.versioning !== "Enabled") failed.push("Object versioning is not enabled");
  if (proof.objectLock !== "Enabled") failed.push("Object lock is not enabled");
  if (!["COMPLIANCE","GOVERNANCE"].includes(proof.retentionMode)) failed.push("Default immutable retention is not configured");
  if (!Number.isSafeInteger(Number(proof.size)) || Number(proof.size) <= 0) failed.push("No nonempty backup object");
  if (!digest.test(String(proof.sha256||""))) failed.push("Backup digest missing or malformed");
  if (proof.sha256 !== proof.remoteSha256) failed.push("Remote backup digest does not match local source");
  if (typeof proof.versionId !== "string" || !proof.versionId.trim() || proof.versionId === "null") failed.push("Immutable object version is unavailable");
  if (!["AES256","aws:kms"].includes(proof.encrypted)) failed.push("S3 encryption not demonstrated");
  return {
    state: failed.length ? "BACKUP_OBJECT_NOT_VERIFIED" : "BACKUP_OBJECT_VERIFIED",
    failed,
    // This validates only object storage metadata, not restore or document completeness.
    scope: "single_database_archive_metadata_only",
  };
}
if (process.argv[1]?.endsWith("/india-books-backup-proof.mjs") && process.argv[2] === "verify") {
  const { readFileSync } = await import("node:fs");
  try {
    const p = JSON.parse(readFileSync(process.argv[3],"utf8"));
    const out = assessIndiaBackupProof(p);
    console.log(JSON.stringify(out));
    if (out.state !== "BACKUP_OBJECT_VERIFIED") process.exitCode = 1;
  } catch (e) {
    console.error("BACKUP_OBJECT_NOT_VERIFIED: incomplete or invalid proof metadata");
    process.exitCode = 1;
  }
}
