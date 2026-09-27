import { createFileRoute } from "@tanstack/react-router";
import { requireBusinessActor } from "@/lib/business-actor";
import { UnauthorizedError } from "@/lib/auth/verify.server";
import {
  compileVedmAuthorityGraph,
  createVedmR3aSeed,
  traceAuthorityPath,
} from "@/lib/vedm-authority-graph";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function authenticationRequired() {
  return json({ ok: false, error: "authentication_required" }, 401);
}

function serializeAuthorityByDomain(
  authorityByDomain: ReturnType<typeof compileVedmAuthorityGraph>["authorityByDomain"],
) {
  return Object.fromEntries(
    Object.entries(authorityByDomain)
      .filter(([, node]) => Boolean(node))
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

export const Route = createFileRoute("/api/engineering/authority")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        let actor;
        try {
          actor = await requireBusinessActor("view");
        } catch (error) {
          if (
            error instanceof UnauthorizedError ||
            (error instanceof Error && error.message === "Unauthorized")
          ) {
            return authenticationRequired();
          }
          throw error;
        }

        const url = new URL(request.url);
        const asOfDate = url.searchParams.get("asOf") || new Date().toISOString().slice(0, 10);
        const from = url.searchParams.get("from")?.trim() || "";
        const to = url.searchParams.get("to")?.trim() || "";

        const graph = compileVedmAuthorityGraph(createVedmR3aSeed(), asOfDate);
        const trace = from && to ? traceAuthorityPath(graph, from, to) : [];

        return json({
          ok: true,
          schema: graph.schema,
          sourceRepository: graph.sourceRepository,
          sourceCommit: graph.sourceCommit,
          asOfDate: graph.asOfDate,
          actor: { userId: actor.userId, role: actor.role },
          valid: graph.valid,
          releaseReady: graph.releaseReady,
          authorityByDomain: serializeAuthorityByDomain(graph.authorityByDomain),
          blockingGateIds: graph.blockingGateIds,
          issues: graph.issues,
          trace,
          mutationAuthority: "HUMAN_APPROVAL_REQUIRED",
        });
      },
    },
  },
});
