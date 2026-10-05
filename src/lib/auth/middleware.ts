import { createMiddleware } from "@tanstack/react-start";

/**
 * Required auth transport for business mutations. The bearer is sent both in
 * TanStack function context and as the actual Authorization header. The header
 * is important because composed/nested server functions read the ambient
 * request through getRequest(); they must see the same verified identity as the
 * outer function rather than falling back to a legacy or viewer role.
 */
export const authMiddleware = createMiddleware({ type: "function" })
  .client(async ({ next }) => {
    const { getBearerToken } = await import("./client");
    const token = getBearerToken();
    return next({
      sendContext: { bearerToken: token ?? undefined },
      ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
    });
  })
  .server(async ({ next, context }) => {
    const { assertSameSiteRequest } = await import("./isolation.server");
    const { getSessionUser, UnauthorizedError } = await import("./verify.server");
    assertSameSiteRequest();
    const user = await getSessionUser(context?.bearerToken);
    if (!user) throw new UnauthorizedError();
    return next({ context: { userId: user.id, userEmail: user.email } });
  });

/**
 * Optional auth transport for read-only workspaces. Anonymous callers remain
 * anonymous; signed-in Better Auth identities are recognized through the same
 * bearer/cookie transport used by mutations. Business authorities still enforce
 * their assigned-role requirement after this transport layer.
 */
export const optionalAuthMiddleware = createMiddleware({ type: "function" })
  .client(async ({ next }) => {
    const { getBearerToken } = await import("./client");
    const token = getBearerToken();
    return next({
      sendContext: { bearerToken: token ?? undefined },
      ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
    });
  })
  .server(async ({ next, context }) => {
    const { assertSameSiteRequest } = await import("./isolation.server");
    const { getSessionUser } = await import("./verify.server");
    assertSameSiteRequest();
    const user = await getSessionUser(context?.bearerToken);
    return next({
      context: {
        userId: user?.id,
        userEmail: user?.email ?? null,
      },
    });
  });
