# VYNDI OS — No-additional-subscription Google Drive encrypted accounting backups

## Important acceptance boundary

**This workflow is a free-space, supplementary encrypted recovery copy.** Google Drive does **not** prove that backup servers are physically located in India. A successful Drive upload or restore must NEVER be used to mark `DAILY_INDIA_BOOKS_BACKUP` as passed, to self-certify Indian Companies (Accounts) Rules compliance, or to bypass any of the 13 statutory period-close blockers.

The prepared India-only S3 workflow remains separate and OFF. This Drive automation does not create chargeable AWS infrastructure.

## Existing destination

The following folder was created and verified through the user's Google Drive connection:

- Display name: `VYNDI OS - Encrypted Backups (Supplementary)`
- Google Drive folder ID: `1hjC8cK8qYMwBzY0j4r-PIur-rQKbqtvb`
- [Open folder](https://drive.google.com/drive/folders/1hjC8cK8qYMwBzY0j4r-PIur-rQKbqtvb)

**Authorize with the Google account that actually owns or has editor access to this exact folder.** A ChatGPT Google Drive connection cannot authorize a separate GitHub Actions runtime.

## How the implemented workflow operates

- `.github/workflows/google-drive-books-backup.yml`: scheduled daily at 20:45 UTC (02:15 IST next day). It is OFF unless GitHub variable `VYNDI_GOOGLE_BACKUP_COMMISSIONED=true`. Manually dispatched runs are also disabled until that variable is true.
- `pg_dump --format=custom --no-owner --no-acl` reads the Neon production database through a **read-only** backup role. The PostgreSQL stream is directly encrypted with an **age X25519 public recipient**, without writing the unencrypted archive to the GitHub runner's disk.
- `rclone copyto --immutable` uploads ONLY ciphertext into the selected Google Drive folder. A second `rclone cat` readback independently checks the ciphertext SHA-256 and the workflow records **non-secret metadata only** in the GitHub Actions step summary.
- The workflow never uses `rclone sync`, `delete`, or `purge`. It cannot silently delete older archives. Each backup has a unique run/attempt filename. Check available Drive storage: full Drive stops backups rather than silently deleting historic books.
- `.github/workflows/google-drive-books-restore.yml`: a manual, separate `finance-restore-review` environment. Downloads only a named encrypted object, verifies the encrypted SHA-256 supplied from the successful backup run, decrypts using the protected **age private key** and streams the archive into **disposable PostgreSQL 18**. It checks journals and the original books edit-audit table. It never connects to the production database and does not write real company books.

### Required one-time setup (no new paid platform required)

1. **Create an OAuth client in Google Cloud (Drive API)** for a local desktop application. This is a separate Google API credential, not a paid AWS service. Follow the current [rclone Google Drive setup guide](https://rclone.org/drive/#making-your-own-client-id). Rclone's shared client ID is being retired in 2026, so **use your own client ID and client secret**. Complete Google's consent configuration for your own account with the Drive API enabled. For uninterrupted refresh tokens avoid leaving an external OAuth app in 7-day Testing mode; ensure the app's publishing status and Google's verification requirements are appropriate to a private single-user application.
2. **Perform a one-time interactive authorization** using `rclone config` on a trusted machine, with the exact OAuth client ID/secret from step 1. Use `drive` as the permission scope, and authorize the **Google account with this Drive folder**. When finished, find `token = { ... }` inside the local `rclone.conf`. Never post any access token, refresh token, OAuth client secret or the configuration file in a chat, issue, pull request, or screenshot.
3. **Generate an age identity locally** with `age-keygen -o vyndi-age-identity.txt`. Keep a secure **offline copy** of the private identity. Copy only the output **public recipient** starting with `age1` into the GitHub repository variable below. Loss of the private key makes your encrypted backups unrecoverable.
4. GitHub repository → **Settings → Environments**: configure `finance-backup` and the separately protected `finance-restore-review` environments, with reviewer protection where supported. Restrict trusted write access to the repository and changes to workflows. An OAuth token with the `drive` scope can access much more than one folder: the root-folder setting limits *this workflow's paths*, not the token's underlying Google permissions.
5. GitHub repository **variables**:
   - `VYNDI_GOOGLE_BACKUP_FOLDER_ID` = `1hjC8cK8qYMwBzY0j4r-PIur-rQKbqtvb`
   - `VYNDI_GOOGLE_BACKUP_AGE_RECIPIENT` = your public `age1...` recipient
   - `VYNDI_GOOGLE_BACKUP_COMMISSIONED` = leave unset or `false` until first qualification
6. GitHub **finance-backup** environment **secrets**:
   - `VYNDI_BOOKS_BACKUP_READ_URL`: a deliberately restricted, read-only Neon connection that can dump all required production books, financial data, receipts, attachments stored in Neon, and audit tables. The normal writable production URL must NOT be used.
   - `VYNDI_GDRIVE_CLIENT_ID`, `VYNDI_GDRIVE_CLIENT_SECRET`: the configured Google OAuth desktop client.
   - `VYNDI_GDRIVE_OAUTH_TOKEN`: full JSON token from rclone, **including refresh_token**.
7. GitHub **finance-restore-review** environment **secrets**:
   - `VYNDI_GDRIVE_CLIENT_ID`, `VYNDI_GDRIVE_CLIENT_SECRET`, `VYNDI_GDRIVE_OAUTH_TOKEN` (same Drive account, independently protected).
   - `VYNDI_BOOKS_BACKUP_AGE_IDENTITY` = the age private identity, held only in the protected manual restore environment. Keep a separate secure offline copy.
8. Once the credentials are present, set `VYNDI_GOOGLE_BACKUP_COMMISSIONED=true` and manually dispatch one backup. Inspect the result and matching ciphertext file in the designated Drive folder. **Then run the manual restore workflow** using the `daily/YYYY-MM-DD/books-....dump.age` key and ciphertext SHA-256 recorded in the completed backup step summary. Verify output checks and accounting-table completeness. Confirm the next scheduled backup also passes.
9. Keep independent backup failure notifications and audit the available Google Drive storage. Review any company data-retention, India-location and access-control requirements with the CA. Do not enable period hard-close merely because Drive backup succeeded.

### Scope and limits

- A Drive archive includes all PostgreSQL content, including the `vyndi_expense_evidence_attachments` `bytea` records. Files held outside PostgreSQL, if any, require separate export and verification.
- Google Drive files are **not** Object Lock/WORM protected and may be deleted by an administrator. Encrypting and verifying an object does not prove long-term immutability or legally compliant retention.
- PostgreSQL backup/recovery is not the same as a production deployment parity check, a fully exercised AR/AP/tax/manufacturing golden journey, or external auditor sign-off.
- This adds no paid SaaS subscription. Google's existing free space is shared across services; storage usage and GitHub Actions usage remain subject to provider limits.

## Release qualification

The GitHub Development CI must pass, including `scripts/google-drive-books-backup.test.mjs`; merge readback must confirm both workflow files. A true **operational backup/restore PASS** requires the first user-authorized encrypted Drive upload and independently observed restore. Before this, the workflows are prepared but **not commissioned**. Under no circumstances fabricate proof or claim a statutory India-resident backup was completed.
