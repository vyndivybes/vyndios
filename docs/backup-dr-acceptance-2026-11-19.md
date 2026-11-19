# VYNDI isolated database recovery — evidence and authority boundaries

**Scope:** encrypted supplementary Google Drive PostgreSQL archive only, not application, Cloudflare, external files, Tally or statutory evidence. Source archive: backup GitHub run [44440922580, attempt 2](https://github.com/vyndivybes/vyndios/actions/runs/44440922580); independent manual restore [44528313401](https://github.com/vyndivybes/vyndios/actions/runs/44528313401).

## Measured facts (UTC, 19 November 2026)

- Backup job started **2026-11-19T09:27:05Z**, ended **2026-11-19T09:28:18Z**: 73 seconds for the complete job, not solely the snapshot operation.
- Isolated restore job started **2026-11-19T12:54:58Z**, ended **2026-11-19T12:55:27Z**: **29 seconds** total job duration including setup/cleanup.
- Time from backup job completion to isolated restore job start was **3 hours 26 minutes 40 seconds**. This is *archive age at the drill*, not the committed data snapshot timestamp and not a guaranteed recovery-point objective.
- Protected source table `vyndi_private.bi_dashboards` counted 1 row; a complete 248-table name manifest had MD5 `eb2ba0c89dd4209992a6080c222759ac`. The initial isolated restore matched both.
- The subsequent least-privilege drill creates an **isolated-only** non-login, non-superuser, non-bypass `vyndi_restore_readback` principal, grants SELECT on that restored protected table only and narrowly enables an isolated SELECT RLS policy. It must prove a single permitted read and reject DML and an unrelated identity table read.

## Recovery objectives, explicit acceptance gaps

**RTO not certified** for restoring a live VYNDI application. The 29-second isolated job is a useful measured component only; it excludes outage detection, credentials retrieval, Cloudflare/Neon redeployment, DNS, external files, user acceptance and independent authority signoff. An owner-approved end-to-end target and a timed disaster simulation are required before stating a production RTO.

**RPO not certified** as a recovery data-loss bound. The supplementary workflow has a daily cron definition, but its scheduled job is gated by `VYNDI_GOOGLE_BACKUP_COMMISSIONED == 'true'`. A single successful offsite archive does not prove ongoing scheduled coverage or change-level data freshness. An owner-approved recovery-point target, continuously successful backups, archive ages, alerts and transaction-source correlation are required before stating an RPO.

## Governance and security

- Only explicitly authorized maintainers of the GitHub `finance-backup` environment should be able to dispatch restoration and use secrets. Enforce two-person approval for real production recovery; GitHub environment approval rule effectiveness must be checked separately, not assumed.
- The original private `age` identity belongs only in the encrypted GitHub environment secret and independent secure offline recovery custody. Never print it, place it in CI artifacts, email, chat or Git. Public recipient must be independently checked.
- Original backup identity `vyndi_books_backup_ro` has `BYPASSRLS` to ensure archive completeness. It must remain restricted to the finance-backup process: `BYPASSRLS` affects every table it can access, not just the currently protected private BI table.
- Recovery drill uses `--network none` on an ephemeral PostgreSQL container. Production credentials and services are never sent into the drill container. A different, restrictive isolated-test role is created **after** restore; no role/policy changes are applied to Neon.
- Validate no plaintext archive at rest, remote encrypted checksum, manifest/table count, denied unrelated read and DML, and audit the exact workflow SHA and job run.
- This control does not cover **external files**, off-database documents, provider credentials, statutory CA certificates, or whole-app service failover.

**Release verdict:** Encrypted archive and first isolated restore were independently PASS. Least-privilege readback becomes PASS only after a new manual workflow run containing the readback check succeeds; full application RTO/RPO and access-policy acceptance remain separate HOLD until independently signed.
