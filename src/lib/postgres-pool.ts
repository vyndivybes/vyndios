import type { PoolConfig } from "pg";

export function isLoopbackPostgresConnectionString(connectionString: string): boolean {
  try {
    const hostname = new URL(connectionString).hostname.toLowerCase();
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
  } catch {
    return false;
  }
}

/**
 * Cloudflare Workers cannot reuse request-bound TCP connections in a later
 * request. Keep deployed request-scoped driver pools small and retire every
 * checked-out connection after one query; Hyperdrive provides the shared
 * cross-request pool in deployed Cloudflare environments.
 *
 * Wrangler's local Hyperdrive override resolves to a loopback PostgreSQL URL
 * instead of a multiplexing Hyperdrive proxy. In that environment, use one
 * modest bounded pool per workerd isolate. Five concurrent clients are enough
 * for VYNDI's authenticated parallel loaders while preventing the unbounded
 * direct-connection fan-out that the shared local pool is designed to avoid.
 * Local workerd still owns sockets per request, so retire each client after use
 * instead of retaining an idle socket whose creating request may have ended.
 */
export function requestSafePostgresPoolConfig(connectionString: string): PoolConfig {
  if (isLoopbackPostgresConnectionString(connectionString)) {
    return {
      connectionString,
      max: 5,
      maxUses: 1,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 30_000,
    };
  }

  return {
    connectionString,
    max: 5,
    maxUses: 1,
    connectionTimeoutMillis: 10_000,
  };
}


export const DEFAULT_REQUEST_POSTGRES_CONCURRENCY = 5;

/**
 * Bound PostgreSQL work inside one Worker request without retaining a pg.Pool.
 * Hyperdrive is the cross-request pool. Each permitted operation can therefore
 * use a short-lived pg.Client and close it before the operation completes.
 */
export function createRequestPostgresLimiter(limit = DEFAULT_REQUEST_POSTGRES_CONCURRENCY) {
  if (!Number.isInteger(limit) || limit < 1) throw new Error("PostgreSQL request concurrency limit must be a positive integer.");

  let active = 0;
  const queue: Array<() => void> = [];

  return async function withPostgresPermit<T>(work: () => Promise<T>): Promise<T> {
    if (active >= limit) {
      await new Promise<void>((resolve) => queue.push(resolve));
    }
    active += 1;
    try {
      return await work();
    } finally {
      active -= 1;
      const next = queue.shift();
      if (next) next();
    }
  };
}
