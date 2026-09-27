import assert from "node:assert/strict";
import test from "node:test";
import {
  isSensitiveAuthRequest,
  rateLimitDecisionFromCount,
  requestAbuseKey,
} from "./rate-limit.ts";

test("shared limiter permits budget and blocks the next attempt with retry guidance", () => {
  assert.deepEqual(
    rateLimitDecisionFromCount({ count: 8, limit: 8, retryAfterSeconds: 12.2, resetAt: 1000 }),
    { allowed: true, limit: 8, remaining: 0, retryAfterSeconds: 0, resetAt: 1000 },
  );
  assert.deepEqual(
    rateLimitDecisionFromCount({ count: 9, limit: 8, retryAfterSeconds: 12.2, resetAt: 1000 }),
    { allowed: false, limit: 8, remaining: 0, retryAfterSeconds: 13, resetAt: 1000 },
  );
});

test("auth limiter protects only sensitive POST endpoints", () => {
  assert.equal(
    isSensitiveAuthRequest(new Request("https://vyndi.test/api/auth/sign-in/email", { method: "POST" })),
    true,
  );
  assert.equal(
    isSensitiveAuthRequest(new Request("https://vyndi.test/api/auth/get-session", { method: "GET" })),
    false,
  );
});

test("abuse keys are SHA-256 digests and never expose the raw request IP", () => {
  const key = requestAbuseKey(
    new Request("https://vyndi.test/api/auth/sign-in/email", {
      method: "POST",
      headers: { "cf-connecting-ip": "203.0.113.9" },
    }),
  );
  assert.match(key, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(key, /203\.0\.113\.9/);
});
