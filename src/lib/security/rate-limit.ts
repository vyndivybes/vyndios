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

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

export function checkRateLimit(
  key: string,
  options: RateLimitOptions,
  now = Date.now(),
): RateLimitDecision {
  const limit = Math.max(1, Math.floor(options.limit));
  const windowMs = Math.max(1000, Math.floor(options.windowMs));
  const existing = buckets.get(key);
  const bucket = !existing || existing.resetAt <= now
    ? { count: 0, resetAt: now + windowMs }
    : existing;

  bucket.count += 1;
  buckets.set(key, bucket);

  const allowed = bucket.count <= limit;
  return {
    allowed,
    limit,
    remaining: Math.max(0, limit - bucket.count),
    retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    resetAt: bucket.resetAt,
  };
}

export function requestAbuseKey(request: Request, namespace: string): string {
  const connectingIp = request.headers.get("cf-connecting-ip")?.trim();
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = connectingIp || forwarded || "unknown";
  return `${namespace}:${ip}`;
}

export function authRateLimitDecision(request: Request, now = Date.now()): RateLimitDecision | null {
  if (request.method.toUpperCase() !== "POST") return null;
  const path = new URL(request.url).pathname.toLowerCase();
  const sensitive = /\/(sign-in\/email|sign-up\/email|forget-password|request-password-reset|reset-password)(?:\/|$)/.test(path);
  if (!sensitive) return null;
  return checkRateLimit(requestAbuseKey(request, "auth"), { limit: 8, windowMs: 60_000 }, now);
}

export function resetRateLimitStateForTests(): void {
  buckets.clear();
}
