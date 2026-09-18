# VYNDI V1 H2 Backup / Restore / Recovery Policy — Rev 1

**Parent baseline:** `815ea5ccef389f7cab2d1d691382b751e054ce9e`  
**Scope:** database recoverability and application operability after restore. Recovery evidence is operational assurance, never a substitute for canonical business records.

## Recovery objectives

- **RPO target:** <= 24 hours for production database backups.
- **RTO target:** <= 60 minutes from declared database-loss incident to a validated restored VYNDI service.
- A release is not considered recovery-ready unless an isolated restore drill proves schema, migration history, business/audit lineage and post-restore transaction authority.

These are V1 operating targets. The managed database provider must be configured to retain backups/snapshots at a cadence that can actually satisfy the RPO; repository code cannot enable a provider account's backup schedule.

## Controlled H2 drill

The CI recovery drill uses two isolated PostgreSQL databases:

1. migrate a clean **source** database to the exact repository head;
2. seed a controlled confirmed Sales Order and verified canonical cash record through existing governed functions;
3. create a PostgreSQL **custom-format** backup with `pg_dump -Fc`;
4. restore into a different empty database using `pg_restore`;
5. run the repository migration engine against the restored database;
6. compare deterministic hashes of:
   - migration history;
   - controlled Sales Order;
   - Sales Order revision history;
   - verified monthly actual/cash record;
   - associated immutable audit events;
7. execute a new governed Sales Order after restore and prove its audit event is created;
8. boot the application against the restored database;
9. run the protected-route browser acceptance and H1 read-only SLO evidence against the restored system;
10. preserve `.grok/evidence/h2-recovery/evidence.json` as the drill artifact.

## Fail-closed rules

The drill fails if:
- source and restored critical-state hashes differ;
- migration history differs after forward migration;
- the restored database cannot accept a governed post-restore transaction;
- audit lineage is missing;
- the restored application cannot authenticate/render protected routes;
- the H1 runtime-health database probe fails.

No recovery script is allowed to connect to production by default. The automated workflow uses disposable databases only.

## Production runbook

For a production incident:

1. declare incident and stop writes where practical;
2. identify last known-good managed backup/snapshot and record its timestamp;
3. restore to a **new** database/branch; never overwrite the damaged database first;
4. bind a non-production VYNDI instance to the restored database;
5. run repository migrations authorized for that environment;
6. compare critical transaction/audit evidence and current release SHA;
7. run protected-route, H1 health/SLO and Golden Order acceptance;
8. reconcile transactions that occurred after the backup timestamp using external bank, supplier, logistics and evidence sources;
9. obtain authorized cutover approval;
10. switch application connectivity to the validated restore;
11. preserve the damaged source and recovery evidence for audit/root-cause analysis.

## Backup integrity and secrets

- Database dumps are sensitive operational artifacts and must never be committed to Git.
- Production backup storage must use provider encryption and access controls.
- The H2 CI artifact contains **evidence metadata only**, not the database dump.
- Credentials must be supplied through runtime secrets; they must not appear in recovery evidence.

## Review cadence

- Run the isolated H2 drill on every PR that changes recovery workflow/schema behavior.
- Run a production-like restore drill at least quarterly and after major database architecture changes.
- Review measured restore time against the 60-minute RTO and backup cadence against the 24-hour RPO.
