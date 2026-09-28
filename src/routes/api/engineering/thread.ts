import { createFileRoute } from "@tanstack/react-router";
import { requireBusinessActor } from "@/lib/business-actor";
import { UnauthorizedError } from "@/lib/auth/verify.server";
import { compileVedmAuthorityGraph, createVedmR3aSeed } from "@/lib/vedm-authority-graph";
import {
  assessDigitalThreadImpact,
  compileDigitalProductThread,
  traceDigitalProductThread,
} from "@/lib/digital-product-thread";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export const Route = createFileRoute("/api/engineering/thread")({
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
            return json({ ok: false, error: "authentication_required" }, 401);
          }
          throw error;
        }

        const url = new URL(request.url);
        const asOfDate = url.searchParams.get("asOf") || new Date().toISOString().slice(0, 10);
        const graph = compileVedmAuthorityGraph(createVedmR3aSeed(), asOfDate);
        const thread = compileDigitalProductThread(graph, {
          engineeringBaselineId: url.searchParams.get("baseline"),
          bomRevisionId: url.searchParams.get("bom"),
          jobCardIds: url.searchParams.getAll("jobCard"),
          qualityReleaseIds: url.searchParams.getAll("qualityRelease"),
          shipmentIds: url.searchParams.getAll("shipment"),
        });

        const from = url.searchParams.get("from")?.trim() || "";
        const to = url.searchParams.get("to")?.trim() || "";
        const impactNodeId = url.searchParams.get("impact")?.trim() || "";

        return json({
          ok: true,
          actor: { userId: actor.userId, role: actor.role },
          sourceRepository: thread.sourceRepository,
          sourceCommit: thread.sourceCommit,
          nodes: [...thread.nodeById.values()],
          edges: thread.edges,
          gaps: thread.gaps,
          trace: from && to ? traceDigitalProductThread(thread, from, to) : [],
          impact: impactNodeId ? assessDigitalThreadImpact(thread, impactNodeId) : null,
          authorityMutation: "READ_ONLY",
        });
      },
    },
  },
});
