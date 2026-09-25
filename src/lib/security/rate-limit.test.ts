import assert from "node:assert/strict";
import test from "node:test";
import {
  authRateLimitDecision,
  checkRateLimit,
  resetRateLimitStateForTests,
} from "./rate-limit.ts";

test("fixed-window limiter permits the configured budget and then returns retry guidance", () => {
  resetRateLimitStateForTests();
  const now = 1_000_000;
  assert.equal(checkRateLimit("k", { limit: 2, windowMs: 60_000 }, now).allowed, true);
  assert.equal(checkRateLimit("k", { limit: 2, windowMs: 60_000 }, now + 1).allowed, true);
  const blocked = checkRateLimit("k", { limit: 2, windowMs: 60_000 }, now + 2);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSeconds > 0);
  assert.equal(blocked.remaining, 0);
});

test("auth limiter only protects sensitive POST endpoints and resets after the window", () => {
  resetRateLimitStateForTests();
  const sensitive = new Request("https://vyndi.test/api/auth/sign-in/email", {
    method: "POST",
    headers: { "cf-connecting-ip": "203.0.113.9" },
  });
  for (let i = 0; i < 8; i += 1) assert.equal(authRateLimitDecision(sensitive, i)?.allowed, true);
  assert.equal(authRateLimitDecision(sensitive, 8)?.allowed, false);
  assert.equal(authRateLimitDecision(sensitive, 60_001)?.allowed, true);

  const sessionRead = new Request("https://vyndi.test/api/auth/get-session", { method: "GET" });
  assert.equal(authRateLimitDecision(sessionRead, 0), null);
});
