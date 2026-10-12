import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";

const backup = () => readFileSync(new URL("../.github/workflows/google-drive-books-backup.yml", import.meta.url), "utf8");
const restore = () => readFileSync(new URL("../.github/workflows/google-drive-books-restore.yml", import.meta.url), "utf8");

test("supplementary Google Drive backup is disabled by default and never mislabels India compliance", () => {
  const y = backup();
  assert.match(y, /VYNDI_GOOGLE_BACKUP_COMMISSIONED/);
  assert.match(y, /github\.event_name == 'workflow_dispatch' \|\| vars\.VYNDI_GOOGLE_BACKUP_COMMISSIONED == 'true'/);
  assert.match(y, /workflow_dispatch/);
  assert.match(y, /schedule:/);
  assert.match(y, /SUPPLEMENTARY_ONLY_NOT_INDIA_RESIDENT/);
  assert.match(y, /finance-backup/);
  assert.doesNotMatch(y, /DAILY_INDIA_BOOKS_BACKUP.*pass/i);
});
test("only private, encrypted database bytes are uploaded, not saved as artifacts", () => {
  const y = backup();
  assert.match(y, /postgres:18-alpine/);
  assert.match(y, /pg_dump/);
  assert.match(y, /sslmode=require/);
  assert.match(y, /sslmode=verify-full/);
  assert.match(y, /--no-owner/);
  assert.match(y, /--no-acl/);
  assert.match(y, /age -r/);
  assert.match(y, /rclone copyto/);
  assert.match(y, /rclone cat/);
  assert.match(y, /sha256sum/);
  assert.match(y, /RCLONE_CONFIG_GDRIVE_ROOT_FOLDER_ID/);
  assert.match(y, /RCLONE_CONFIG_GDRIVE_TOKEN/);
  assert.match(y, /secrets\.VYNDI_BOOKS_BACKUP_READ_URL/);
  assert.doesNotMatch(y, /upload-artifact[\s\S]*\.dump(?!\.age)/i);
  assert.doesNotMatch(y, /echo.*(TOKEN|DATABASE_URL|CLIENT_SECRET)/i);
  assert.doesNotMatch(y, /rclone delete|rclone purge|rclone sync/i);
});
test("restore is manual and isolated, requires secret identity and leaves production untouched", () => {
  const y = restore();
  assert.match(y,/workflow_dispatch/);
  assert.match(y,/finance-restore-review/);
  assert.match(y,/VYNDI_BOOKS_BACKUP_AGE_IDENTITY/);
  assert.match(y,/age -d/);
  assert.match(y,/pg_restore --exit-on-error/);
  assert.match(y,/vyndi_books_edit_audit/);
  assert.match(y,/sha256sum/);
  assert.match(y,/postgres:18-alpine/);
  assert.doesNotMatch(y,/schedule:/);
  assert.doesNotMatch(y,/secrets\.VYNDI_BOOKS_BACKUP_READ_URL/);
  assert.doesNotMatch(y,/DROP DATABASE/i);
});
test("existing India-only workflow is not repurposed or bypassed", () => {
  const india = readFileSync(new URL("../.github/workflows/india-books-backup.yml", import.meta.url),"utf8");
  assert.match(india, /VYNDI_INDIA_BACKUP_COMMISSIONED/);
  assert.match(india, /ap-south-1\|ap-south-2/);
});
