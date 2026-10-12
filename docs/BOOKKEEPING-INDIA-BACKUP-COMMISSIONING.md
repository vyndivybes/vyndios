# VYNDI OS — India books backup commissioning and restoration

## Operational boundary

The Day-1 operational books acceptance gate for India-resident daily backups is **not passed** just because these workflows exist. It passes only after a real backup of the current production books and retained documents to an independently confirmed India-region destination, a successful independent restore, scheduled daily-run monitoring and a reviewed evidence pack.

Cloudflare R2's `apac` hint is best-effort placement and is not an India-residency assurance. The existing Neon US-East-2 production service is also not an India physical backup. The isolated copy/branch of a Neon database is useful for technical recovery but does not establish this residency gate.

## Prepared GitHub workflows

- `.github/workflows/india-books-backup.yml` — daily at 20:30 UTC (02:00 IST following day), only after repository variable `VYNDI_INDIA_BACKUP_COMMISSIONED=true`, or via deliberate manual dispatch. It fails closed unless the S3 destination is specifically `ap-south-1` (Mumbai) or `ap-south-2` (Hyderabad), versioning is enabled and default Object Lock retention exists. It uses PostgreSQL 18 `pg_dump`, SSE-S3 encryption, a distinct immutable object key, SHA-256 metadata readback, and an artifact containing **proof metadata only**.
- `.github/workflows/india-books-restore-drill.yml` — manual recovery review with a different IAM role, compares a downloaded object's SHA-256 and restores into a disposable PostgreSQL 18 service. It checks the presence of journal and books edit-audit tables. No restore is performed to the production DB.

Neither workflow posts financial transactions, manipulates the edit log, silently closes a period or changes existing books.

## Configuration — required before commissioning

1. In an AWS account owned by the company, create a **private S3 general-purpose bucket** in **Mumbai `ap-south-1`** or Hyderabad `ap-south-2`. Activate **Block Public Access**, S3 Versioning, **Object Lock with default retention**, and encryption. Agree the legally correct retention duration with the appointed CA before writing records. Object Lock can make retention irreversible; do not turn it on with an arbitrary term without that review.
2. Create a narrowly scoped **GitHub Actions OIDC backup IAM role** limited to S3 bucket location/versioning/Object Lock inspection and object upload/readback under `vyndios-books/daily/*`. Trust only the designated `finance-backup` GitHub environment and this repository. Do not grant bucket deletion, `s3:BypassGovernanceRetention` or unrelated S3 permissions.
3. Create a **different read-only restore IAM role**, restricted to a `finance-restore-review` environment and object reads. The restoration workflow never obtains the Neon production write URL.
4. In GitHub repository variables set `VYNDI_INDIA_BACKUP_BUCKET`, `VYNDI_INDIA_BACKUP_AWS_REGION`, `VYNDI_INDIA_BACKUP_IAM_ROLE`, and `VYNDI_INDIA_RESTORE_IAM_ROLE`. In the protected `finance-backup` environment, create the secret `VYNDI_BOOKS_BACKUP_READ_URL`, using a **read-only** Neon role whose `pg_dump` privileges encompass all business books, vouchers and edit-audit tables. Do not paste this secret into any chat, issue, PR or workflow logs.
5. Run the daily-backup workflow manually once and inspect its non-sensitive metadata artifact and AWS object version. Run the independent restore-drill workflow with the exact recorded key and inspect its result. Verify actual voucher bytes and attachments have been included, and separately cover any business documents stored outside PostgreSQL.
6. Only after independent review of a valid daily backup, complete restore, retention policy, access permissions and **verified India location** should `VYNDI_INDIA_BACKUP_COMMISSIONED` be set to `true`. Confirm a second scheduled daily run and configure prompt failure alerts for missed runs.

**Costs:** AWS S3, transfer, versioning and immutable long-term retention can incur charges. No AWS bucket, paid resource or live backup has been created by adding these workflows. A free Cloudflare R2 APAC bucket is **not** an acceptable substitute for proven India residency.

## Acceptance evidence

Retain SHA of current deployed Worker, migration manifest, IAM role access review, provider region, bucket policy, independent immutable object version ID, SHA-256 digest, encryption, daily run timestamps, actual recovery checks, backup retention setting, completeness of journals and voucher bytes, and reviewer sign-off. The GitHub artifact is **only a 30-day operational receipt**; preserve actual proofs in the organization's governed evidence archive at the required retention.

For CA working-paper readiness, retain edit-audit evidence from the **first day** using the software and explicitly identify any pre-control journal records at adoption cutover. Never synthesize historic audit events.

## Qualifying finance software vs closing the books

The live Day-1 database integrity checks in the Accounting Workbench are separate from the 13 period-close blockers. A new enterprise with no stocktake, bank statement or completed month can qualify software for genuine daily entries, but hard-close must still require contemporaneous real evidence when applicable.
