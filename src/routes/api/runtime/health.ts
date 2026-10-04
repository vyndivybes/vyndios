import { createFileRoute } from "@tanstack/react-router";
import { getSchemaMigrationStatus, getSql } from "@/lib/db";
import { emitOperationalEvent, runtimeSourceSha } from "@/lib/observability/server";

export const Route = createFileRoute("/api/runtime/health")({
  server: {
    handlers: {
      GET: async () => {
        const started = Date.now();
        const sourceSha = await runtimeSourceSha();
        try {
          const sql = await getSql();
          const [dbRows, ibpeRows, schemaStatus] = await Promise.all([
            sql.query<{ ok: number }>("select 1::integer as ok"),
            sql.query<{ latest_run_present: boolean }>(
              "select exists(select 1 from vyndi_ibpe_runs where status='complete') as latest_run_present",
            ),
            getSchemaMigrationStatus(),
          ]);
          const databaseOk = Number(dbRows[0]?.ok ?? 0) === 1;
          const latestIbpeRunPresent = Boolean(ibpeRows[0]?.latest_run_present);
          const schemaCurrent=schemaStatus.pendingMigrationCount===0;
          const ready=databaseOk&&schemaCurrent;
          const status = ready ? 200 : 503;
          emitOperationalEvent({
            component: "runtime-health",
            operation: "readiness",
            route: "/api/runtime/health",
            outcome: ready ? "success" : "failure",
            durationMs: Date.now() - started,
            statusCode: status,
            sourceSha,
            failureCategory: ready ? undefined : schemaCurrent ? "database-readiness" : "schema-readiness",
          });
          return new Response(
            JSON.stringify({
              ok: ready,
              component: "vyndi-runtime",
              sourceSha,
              checks: {
                database: databaseOk ? "ok" : "unavailable",
                schema: schemaCurrent ? "current" : "lagging",
                governedIbpeRun: latestIbpeRunPresent ? "present" : "not-yet-created",
              },
              pendingMigrationCount:schemaStatus.pendingMigrationCount,
              latestExpectedMigration:schemaStatus.latestExpectedMigration,
              latestAppliedMigration:schemaStatus.latestAppliedMigration,
              migrationCounts:{
                expected:schemaStatus.expectedMigrationCount,
                applied:schemaStatus.appliedMigrationCount,
              },
            }),
            {
              status,
              headers: {
                "content-type": "application/json; charset=utf-8",
                "cache-control": "no-store",
              },
            },
          );
        } catch (error) {
          emitOperationalEvent({
            component: "runtime-health",
            operation: "readiness",
            route: "/api/runtime/health",
            outcome: "failure",
            durationMs: Date.now() - started,
            statusCode: 503,
            sourceSha,
            failureCategory: "database-or-runtime",
            errorName: error instanceof Error ? error.name : typeof error,
          });
          return new Response(
            JSON.stringify({
              ok: false,
              component: "vyndi-runtime",
              sourceSha,
              checks: { database: "unavailable", governedIbpeRun: "unknown" },
            }),
            {
              status: 503,
              headers: {
                "content-type": "application/json; charset=utf-8",
                "cache-control": "no-store",
              },
            },
          );
        }
      },
    },
  },
});
