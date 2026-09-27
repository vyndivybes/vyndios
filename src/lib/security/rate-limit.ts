import { createHash } from "node:crypto";

export type RateLimitDecision = {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
  resetAt: number;
};

export type RateLimitOptions = {
  limit: number;
  windowMs: number;
};

export function isSensitiveAuthRequest(request: Request): boolean {
  if (request.method.toUpperCase() !== "POST") return false;
  const path = new URL(request.url).pathname.toLowerCase();
  return /\/(sign-in\/email|sign-up\/email|forget-password|request-password-reset|reset-password)(?:\/|$)/.test(path);
}

export function requestAbuseKey(request: Request, namespace = "auth"): string {
  const connectingIp = request.headers.get("cf-connecting-ip")?.trim();
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const source = connectingIp || forwarded || "unknown";
  const path = new URL(request.url).pathname.toLowerCase();
  return createHash("sha256").update(`${namespace}:${source}:${path}`).digest("hex");
}

export function rateLimitDecisionFromCount(input: {
  count: number;
  limit: number;
  retryAfterSeconds: number;
  resetAt: number;
}): RateLimitDecision {
  return {
    allowed: input.count <= input.limit,
    limit: input.limit,
    remaining: Math.max(0, input.limit - input.count),
    retryAfterSeconds: input.count <= input.limit ? 0 : Math.max(1, Math.ceil(input.retryAfterSeconds)),
    resetAt: input.resetAt,
  };
}

export async function authRateLimitDecision(
  request: Request,
  options: RateLimitOptions = { limit: 8, windowMs: 60_000 },
): Promise<RateLimitDecision | null> {
  if (!isSensitiveAuthRequest(request)) return null;

  const limit = Math.max(1, Math.floor(options.limit));
  const windowMs = Math.max(1000, Math.floor(options.windowMs));
  const windowSeconds = windowMs / 1000;
  const keyHash = requestAbuseKey(request, "auth");
  const { getSqlServer } = await import("../db.server.ts");
  const sql = await getSqlServer();

  const rows = await sql.query<{
    attempt_count: number;
    retry_after_seconds: number;
    reset_at_epoch_ms: number;
  }>(
    `insert into vyndi_auth_rate_limits (key_hash, window_started_at, attempt_count, updated_at)
     values ($1, now(), 1, now())
     on conflict (key_hash) do update
       set window_started_at = case
             when vyndi_auth_rate_limits.window_started_at + ($2 * interval '1 second') <= now()
               then now()
             else vyndi_auth_rate_limits.window_started_at
           end,
           attempt_count = case
             when vyndi_auth_rate_limits.window_started_at + ($2 * interval '1 second') <= now()
               then 1
             else vyndi_auth_rate_limits.attempt_count + 1
           end,
           updated_at = now()
     returning
       attempt_count,
       greatest(
         0,
         extract(epoch from (window_started_at + ($2 * interval '1 second') - now()))
       )::double precision as retry_after_seconds,
       (extract(epoch from (window_started_at + ($2 * interval '1 second'))) * 1000)::bigint as reset_at_epoch_ms`,
    [keyHash, windowSeconds],
  );

  const row = rows[0];
  if (!row) throw new Error("Authentication rate-limit state update returned no row.");

  return rateLimitDecisionFromCount({
    count: Number(row.attempt_count),
    limit,
    retryAfterSeconds: Number(row.retry_after_seconds),
    resetAt: Number(row.reset_at_epoch_ms),
  });
}
