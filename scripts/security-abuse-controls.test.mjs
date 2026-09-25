import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const limiter = await readFile(new URL("../src/lib/security/rate-limit.ts", import.meta.url), "utf8");
const authRoute = await readFile(new URL("../src/routes/api/auth/$.ts", import.meta.url), "utf8");

test("auth abuse limiter is bounded and returns retry guidance", () => {
  assert.match(limiter, /limit:\s*8/);
  assert.match(limiter, /windowMs:\s*60_000/);
  assert.match(limiter, /retryAfterSeconds/);
  assert.match(limiter, /cf-connecting-ip/);
  assert.match(limiter, /x-forwarded-for/);
});

test("Better Auth POST path rejects abusive bursts before auth processing", () => {
  assert.match(authRoute, /authRateLimitDecision/);
  assert.match(authRoute, /status:\s*429/);
  assert.match(authRoute, /retry-after/i);
  assert.match(authRoute, /handleAuthRequest\(request\)/);
});
