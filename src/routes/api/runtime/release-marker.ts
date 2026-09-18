import { createFileRoute } from "@tanstack/react-router";

export const VIBPE_OPTIMIZER_RELEASE_CONTRACT = "VIBPE-OPTIMIZER-CLOSURE-5";

const SOURCE_SHA_PATTERN = /^[0-9a-f]{7,64}$/i;

export async function runtimeSourceSha(): Promise<string | null> {
  const processSha =
    typeof process !== "undefined" && typeof process.env?.VYNDI_SOURCE_SHA === "string"
      ? process.env.VYNDI_SOURCE_SHA.trim()
      : "";
  if (SOURCE_SHA_PATTERN.test(processSha)) return processSha;

  try {
    const cloudflareWorkersModule = "cloudflare:workers";
    const workers = await import(/* @vite-ignore */ cloudflareWorkersModule);
    const runtimeEnv = workers.env as Record<string, unknown> | undefined;
    const workerSha =
      typeof runtimeEnv?.VYNDI_SOURCE_SHA === "string" ? runtimeEnv.VYNDI_SOURCE_SHA.trim() : "";
    return SOURCE_SHA_PATTERN.test(workerSha) ? workerSha : null;
  } catch {
    return null;
  }
}

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
