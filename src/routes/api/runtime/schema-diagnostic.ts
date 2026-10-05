import { createFileRoute } from "@tanstack/react-router";
import { getRuntimeSchemaDiagnostic } from "@/lib/db";
import { requireBusinessActor } from "@/lib/business-actor";
import { runtimeSourceSha } from "@/lib/observability/server";

function json(body:unknown){
  return new Response(JSON.stringify(body),{
    status:200,
    headers:{
      "content-type":"application/json; charset=utf-8",
      "cache-control":"no-store",
    },
  });
}

export const Route=createFileRoute("/api/runtime/schema-diagnostic")({
  server:{
    handlers:{
      GET:async()=>{
        await requireBusinessActor("view");
        const [sourceSha,diagnostic]=await Promise.all([
          runtimeSourceSha(),
          getRuntimeSchemaDiagnostic(),
        ]);
        return json({
          ok:diagnostic.ok,
          component:"vyndi-schema-diagnostic",
          sourceSha,
          source:diagnostic.source,
          expectedMigrationCount:diagnostic.expectedMigrationCount,
          appliedMigrationCount:diagnostic.appliedMigrationCount,
          pendingMigrationCount:diagnostic.pendingMigrationCount,
          latestExpectedMigration:diagnostic.latestExpectedMigration,
          latestAppliedMigration:diagnostic.latestAppliedMigration,
          failure:diagnostic.failure
            ? {
                stage:diagnostic.failure.stage,
                migrationName:diagnostic.failure.migrationName,
                sqlState:diagnostic.failure.sqlState,
              }
            : null,
        });
      },
    },
  },
});
