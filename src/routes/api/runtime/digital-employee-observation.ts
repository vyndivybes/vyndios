import { createFileRoute } from "@tanstack/react-router";
import { requireBusinessActor } from "@/lib/business-actor";
import { getSql } from "@/lib/db";
import { runtimeSourceSha } from "@/lib/observability/server";
import { readEmployeeBiSource } from "@/lib/vaos-enterprise-bi-read";
import { sha256Hex } from "@/lib/vaos-bridge-auth";
import { evaluateVyndiAgentRequest, type VyndiDigitalEmployeeId } from "@/lib/vyndi-digital-employees";

const departmentByEmployee = {
  planning: "project",
  commercial: "commercial",
  procurement: "procurement",
  inventory: "inventory",
  production: "production",
  "engineering-quality": "qa",
  finance: "finance",
  people: "people",
} as const satisfies Record<VyndiDigitalEmployeeId, Parameters<typeof readEmployeeBiSource>[1]>;

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

export const Route = createFileRoute("/api/runtime/digital-employee-observation")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const actor = await requireBusinessActor("admin");
        const employeeId = new URL(request.url).searchParams.get("employee");
        if (!employeeId || !Object.hasOwn(departmentByEmployee, employeeId)) {
          return json({ error: "Unknown digital employee" }, 400);
        }
        const department = departmentByEmployee[employeeId as VyndiDigitalEmployeeId];
        try {
          const now = new Date();
          const sourceSha = await runtimeSourceSha();
          const source = await readEmployeeBiSource(await getSql(), department, now.toISOString().slice(0, 10));
          // Unknown-origin rows cannot certify a business observation. A zero-row
          // source is reachable but supplies no evidence of employee operation.
          const hasGovernedRows = source.unclassifiedOriginCount === 0 && source.currentSourceCount > 0;
          const decision = evaluateVyndiAgentRequest({
            employeeId, mode: "observe", verifiedActorId: actor.userId,
            evidence: sourceSha && hasGovernedRows
              ? { sourceId: source.sourceTable, sourceSha, capturedAt: now.toISOString(), authority: "governed-internal" }
              : null,
          }, now);
          return json({
            ...decision, scope: "PRIMARY_LEDGER_STATUS_COUNTS", sourceSha,
            observedAt: now.toISOString(),
            source: hasGovernedRows ? source : { sourceTable: source.sourceTable, status: "HOLD" },
            fingerprint: decision.status === "ADVISORY"
              ? await sha256Hex(JSON.stringify([employeeId, actor.userId, sourceSha, source]))
              : null,
          });
        } catch {
          return json({ employeeId, status: "HOLD", executionEnabled: false, reason: "Canonical source unavailable" }, 503);
        }
      },
    },
  },
});
