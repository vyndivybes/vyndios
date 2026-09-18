import { createFileRoute } from "@tanstack/react-router";
import { runtimeSourceSha } from "@/lib/observability/server";

export const VIBPE_OPTIMIZER_RELEASE_CONTRACT = "VIBPE-OPTIMIZER-CLOSURE-5";

export const Route = createFileRoute("/api/runtime/release-marker")({
  server: {
    handlers: {
      GET: async () => {
        const sourceSha = await runtimeSourceSha();
        return new Response(
          JSON.stringify({
            ok: true,
            component: "vibpe-governed-optimizer",
            releaseContract: VIBPE_OPTIMIZER_RELEASE_CONTRACT,
            productionTarget: "cloudflare-workers",
            closureRoute: "/command/ibpe-operating-workspace/release",
            sourceSha,
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json; charset=utf-8",
              "cache-control": "no-store",
            },
          },
        );
      },
    },
  },
});
