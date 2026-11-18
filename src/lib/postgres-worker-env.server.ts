// Server-only Cloudflare runtime binding bridge.
// A literal static import is resolved by the Cloudflare Vite SSR environment,
// unlike a runtime-computed "cloudflare:workers" import that can silently fail.
import { env as workerEnv } from "cloudflare:workers";

type RuntimeBindings = {
  HYPERDRIVE?: { connectionString?: string };
};

/** Never return a credential to the client or log the connection string. */
export function workerHyperdriveConnectionString(): string | undefined {
  const connectionString = (workerEnv as RuntimeBindings).HYPERDRIVE?.connectionString;
  return typeof connectionString === "string" && connectionString.trim()
    ? connectionString.trim()
    : undefined;
}
