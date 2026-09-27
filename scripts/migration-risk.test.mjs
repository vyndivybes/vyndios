import assert from "node:assert/strict";
import test from "node:test";
import {
  destructiveMigrationStatements,
  productionMigrationContext,
  requireDestructiveMigrationEvidence,
} from "./migration-risk.mjs";

test("additive migrations do not require destructive backup evidence", () => {
  assert.deepEqual(destructiveMigrationStatements("create table x(id int); alter table x add column y text;"), []);
  assert.doesNotThrow(() =>
    requireDestructiveMigrationEvidence({
      sql: "create table x(id int);",
      env: { WORKERS_CI: "1", WORKERS_CI_BRANCH: "main" },
    }),
  );
});

test("destructive production migrations require explicit backup evidence", () => {
  const sql = "alter table x drop column y;";
  assert.deepEqual(destructiveMigrationStatements(sql), ["DROP COLUMN"]);
  assert.throws(
    () =>
      requireDestructiveMigrationEvidence({
        sql,
        env: { WORKERS_CI: "1", WORKERS_CI_BRANCH: "main" },
      }),
    /VYNDI_MIGRATION_BACKUP_REF/,
  );
  assert.doesNotThrow(() =>
    requireDestructiveMigrationEvidence({
      sql,
      env: {
        WORKERS_CI: "1",
        WORKERS_CI_BRANCH: "main",
        VYNDI_MIGRATION_BACKUP_REF: "backup-2026-09-25",
      },
    }),
  );
});

test("destructive migration evidence gate is production-specific", () => {
  assert.equal(productionMigrationContext({ WORKERS_CI: "1", WORKERS_CI_BRANCH: "main" }), true);
  assert.equal(productionMigrationContext({ VYNDI_ALLOW_DB_MIGRATIONS: "1" }), false);
  assert.doesNotThrow(() =>
    requireDestructiveMigrationEvidence({
      sql: "drop table x;",
      env: { VYNDI_ALLOW_DB_MIGRATIONS: "1" },
    }),
  );
});
