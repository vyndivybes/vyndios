import { createFileRoute } from "@tanstack/react-router";
import { handleAuthRequest } from "@/lib/auth/server";
import { authRateLimitDecision } from "@/lib/security/rate-limit";

async function handleProtectedAuthPost(request: Request) {
  const decision = authRateLimitDecision(request);
  if (decision && !decision.allowed) {
    return new Response(JSON.stringify({
      error: "Too many authentication attempts. Retry later.",
      retryAfterSeconds: decision.retryAfterSeconds,
    }), {
      status: 429,
      headers: {
        "content-type": "application/json",
        "retry-after": String(decision.retryAfterSeconds),
        "x-ratelimit-limit": String(decision.limit),
        "x-ratelimit-remaining": String(decision.remaining),
      },
    });
  }
  return handleAuthRequest(request);
}

/**
 * Better Auth catch-all endpoint.
 *
 * This route is required for all Better Auth operations, including
 * email/password sign-in for VINDY-managed users.
 */
export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      // The Better Auth handler already owns its Set-Cookie response headers.
      // Returning that response directly avoids a second TanStack cookie
      // handoff, which crashes Cloudflare Workers only after valid credentials
      // create a session.
      GET: ({ request }) => handleAuthRequest(request),
      POST: ({ request }) => handleProtectedAuthPost(request),
    },
  },
});
