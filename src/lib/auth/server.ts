import { betterAuth } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { bearer, genericOAuth } from "better-auth/plugins";
import { getCookie } from "@tanstack/react-start/server";
import { randomBytes } from "node:crypto";
import { ensureDbReady, getPglite } from "../db";
import { emailAndPasswordEnabled } from "./email-password";
import { GATE_PROVIDER_ID, gateIdentitySessions } from "./gate-session.server";
import { GROK_PROVIDERS } from "./providers";
import { pgliteDialect } from "./pglite-dialect";
import { requestSafePostgresDialect } from "./postgres-dialect";
import {
  GROK_ISSUER_DEFAULT,
  PREVIEW_ALLOWED_HOSTS,
  PREVIEW_CLIENT_ID,
  PREVIEW_CLIENT_SECRET,
} from "./preview";
import { resolvePostgresTransport } from "../postgres-runtime";
import { AUTH_TRUSTED_ORIGINS, resolveAuthBaseURL, resolveAuthSecret } from "./runtime-config";
import { excessActiveSessionTokens } from "./session-concurrency";
import { VYNDI_SESSION_POLICY } from "./session-policy";
import { emitOperationalEvent } from "../observability/server";

void ensureDbReady();

const globalAuthRef = globalThis as typeof globalThis & {
  __grokAuthPreviewSecret__?: string;
};
function previewAuthSecret(): string {
  globalAuthRef.__grokAuthPreviewSecret__ ??= randomBytes(32).toString("hex");
  return globalAuthRef.__grokAuthPreviewSecret__;
}

const env = (key: string): string | undefined => {
  const value = process.env[key]?.trim();
  return value ? value : undefined;
};

function validHttpUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.toString().replace(/\/$/, "")
      : undefined;
  } catch {
    return undefined;
  }
}

const authDisabled = env("VITE_AUTH_ENABLED") === "false";
const grokIssuer = validHttpUrl(env("GROK_AUTH_ISSUER")) ?? GROK_ISSUER_DEFAULT;
const grokClientId = env("GROK_AUTH_CLIENT_ID") ?? PREVIEW_CLIENT_ID;
const grokClientSecret = env("GROK_AUTH_CLIENT_SECRET") ?? PREVIEW_CLIENT_SECRET;

export const authConfigured = !authDisabled && Boolean(grokClientId && grokClientSecret);

const explicitBaseURL = validHttpUrl(env("BETTER_AUTH_URL"));
const previewAllowedHosts: string[] = [...PREVIEW_ALLOWED_HOSTS];
// Resolve the concrete base URL from each incoming request. Cloudflare,
// Hosted preview aliases therefore issue host-local
// cookies and callbacks even if BETTER_AUTH_URL is missing or was scoped to a
// different deployment target.
const baseURL = resolveAuthBaseURL(explicitBaseURL);

const trustedOrigins: string[] = [
  ...AUTH_TRUSTED_ORIGINS,
  ...(explicitBaseURL ? [explicitBaseURL] : []),
  ...previewAllowedHosts,
  ...previewAllowedHosts.flatMap((host) => [`https://${host}`, `http://${host}`]),
];

// Keep auth-secret derivation tied to the stable configured database URL rather
// than Hyperdrive's generated runtime connection string. The database transport
// itself is resolved independently below so Cloudflare can use Hyperdrive.
const databaseUrl = env("DATABASE_URL");
const authSecret = resolveAuthSecret({
  configuredSecret: env("BETTER_AUTH_SECRET"),
  databaseUrl,
  authDisabled,
  previewSecret: previewAuthSecret,
});
const issuerBase = grokIssuer.replace(/\/+$/, "");
const grokAuthorizationUrl = `${issuerBase}/api/auth/oauth2/authorize`;
const grokTokenUrl = `${issuerBase}/api/auth/oauth2/token`;
const grokUserInfoUrl = `${issuerBase}/api/auth/oauth2/userinfo`;

const postgresTransport = await resolvePostgresTransport();
const postgresAuthDialect = postgresTransport
  ? requestSafePostgresDialect(postgresTransport.connectionString)
  : null;
const database = postgresAuthDialect
  ? { dialect: postgresAuthDialect, type: "postgres" as const }
  : { dialect: pgliteDialect(() => getPglite()), type: "postgres" as const };

export const SESSION_TOKEN_COOKIE = "__Host-grok-auth.session_token";

function authFailureCategory(error: unknown): string | undefined {
  if (!error) return undefined;
  const cause = error instanceof Error ? error.cause : undefined;
  const searchable = [error, cause]
    .flatMap((value) => {
      if (!value || typeof value !== "object") return [];
      return [
        "name" in value ? String(value.name) : "",
        "message" in value ? String(value.message) : "",
        "code" in value ? String(value.code) : "",
      ];
    })
    .join(" ")
    .toLowerCase();
  if (/postgres|hyperdrive|connection|socket|econn|timeout|query/.test(searchable)) {
    return "postgres-transport";
  }
  if (/cookie|signature|decrypt|jwe|token/.test(searchable)) {
    return "cookie-verification";
  }
  if (/adapter|session|relation|table|column/.test(searchable)) {
    return "better-auth-adapter";
  }
  return "better-auth";
}

const BETTER_AUTH_REQUIRED_COLUMNS: Record<string, string[]> = {
  user: ["id", "name", "email", "emailVerified", "image", "createdAt", "updatedAt"],
  session: ["id", "expiresAt", "token", "createdAt", "updatedAt", "ipAddress", "userAgent", "userId"],
  account: ["id", "accountId", "providerId", "userId", "accessToken", "refreshToken", "idToken", "accessTokenExpiresAt", "refreshTokenExpiresAt", "scope", "password", "createdAt", "updatedAt"],
  verification: ["id", "identifier", "value", "expiresAt", "createdAt", "updatedAt"],
};

async function diagnoseBetterAuthSchema(): Promise<{
  compatible: boolean;
  missingTables: string[];
  missingColumnCount: number;
  diagnosticState: "compatible" | "incompatible" | "unavailable";
}> {
  try {
    const { getSqlServer } = await import("../db.server.ts");
    const sql = await getSqlServer();
    const rows = await sql.query<{ table_name: string; column_name: string }>(
      `select table_name, column_name
         from information_schema.columns
        where table_schema = current_schema()
          and table_name = any($1::text[])`,
      [Object.keys(BETTER_AUTH_REQUIRED_COLUMNS)],
    );
    const seen = new Map<string, Set<string>>();
    for (const row of rows) {
      const set = seen.get(row.table_name) ?? new Set<string>();
      set.add(row.column_name);
      seen.set(row.table_name, set);
    }
    const missingTables = Object.keys(BETTER_AUTH_REQUIRED_COLUMNS).filter((table) => !seen.has(table));
    let missingColumnCount = 0;
    for (const [table, required] of Object.entries(BETTER_AUTH_REQUIRED_COLUMNS)) {
      const columns = seen.get(table);
      if (!columns) continue;
      missingColumnCount += required.filter((column) => !columns.has(column)).length;
    }
    const compatible = missingTables.length === 0 && missingColumnCount === 0;
    return {
      compatible,
      missingTables,
      missingColumnCount,
      diagnosticState: compatible ? "compatible" : "incompatible",
    };
  } catch {
    return {
      compatible: false,
      missingTables: [],
      missingColumnCount: 0,
      diagnosticState: "unavailable",
    };
  }
}

function authFailureDetails(request: Request, error?: unknown) {
  const cause = error instanceof Error ? error.cause : undefined;
  const errorCode =
    typeof cause === "object" && cause && "code" in cause
      ? String(cause.code)
      : typeof error === "object" && error && "code" in error
        ? String(error.code)
        : undefined;
  return {
    path: new URL(request.url).pathname,
    sessionCookiePresent: (request.headers.get("cookie") ?? "").includes(
      `${SESSION_TOKEN_COOKIE}=`,
    ),
    bearerPresent: Boolean(request.headers.get("authorization")),
    databaseTransport: postgresTransport?.source ?? "pglite",
    secretSource: env("BETTER_AUTH_SECRET")
      ? "BETTER_AUTH_SECRET"
      : databaseUrl
        ? "stable-database-derived-fallback"
        : "preview-process",
    errorName: error instanceof Error ? error.name : error ? typeof error : undefined,
    errorCode,
    failureCategory: authFailureCategory(error),
  };
}

const grokOAuthPlugin = authConfigured
  ? genericOAuth({
      config: GROK_PROVIDERS.map(({ providerId, idp }) => ({
        providerId,
        clientId: grokClientId as string,
        clientSecret: grokClientSecret as string,
        authorizationUrl: grokAuthorizationUrl,
        tokenUrl: grokTokenUrl,
        userInfoUrl: grokUserInfoUrl,
        scopes: ["openid", "profile", "email"],
        authorizationUrlParams: { idp, prompt: "login" },
      })),
    })
  : null;

export const auth = betterAuth({
  baseURL,
  secret: authSecret,
  database,
  trustedOrigins,

  account: {
    encryptOAuthTokens: true,
    accountLinking: {
      enabled: true,
      trustedProviders: [...GROK_PROVIDERS.map((p) => p.providerId), GATE_PROVIDER_ID],
      requireLocalEmailVerified: false,
    },
  },

  session: VYNDI_SESSION_POLICY,

  hooks: {
    after: createAuthMiddleware(async (ctx) => {
      const newSession = ctx.context.newSession;
      if (!newSession) return;
      try {
        const sessions = await ctx.context.internalAdapter.listSessions(newSession.user.id);
        const excessTokens = excessActiveSessionTokens(sessions, newSession.session.token);
        await Promise.all(
          excessTokens.map((token) => ctx.context.internalAdapter.deleteSession(token)),
        );
      } catch (error) {
        // Do not strand a valid newly-created login because cleanup failed.
        // The 24-hour expiry still bounds exposure and the next login retries.
        ctx.context.logger.error("VYNDI session-concurrency cleanup failed", error);
      }
    }),
  },

  // VINDY administrators create accounts for other people. Creating a user must
  // NEVER sign the administrator into the newly-created account. Better Auth's
  // email/password sign-up auto-signs users in by default; disabling that here
  // prevents the admin session cookie from being replaced during user creation.
  // Password reset also revokes outstanding sessions so a changed credential
  // cannot leave older authenticated devices active.
  ...(emailAndPasswordEnabled
    ? {
        emailAndPassword: {
          enabled: true,
          autoSignIn: false,
          revokeSessionsOnPasswordReset: true,
        },
      }
    : {}),

  advanced: {
    useSecureCookies: false,
    defaultCookieAttributes: { secure: true, sameSite: "lax", path: "/" },
    cookies: {
      session_token: { name: SESSION_TOKEN_COOKIE },
      session_data: { name: "__Host-grok-auth.session_data" },
      account_data: { name: "__Host-grok-auth.account_data" },
      dont_remember: { name: "__Host-grok-auth.dont_remember" },
    },
  },

  plugins: [
    gateIdentitySessions(),
    ...(grokOAuthPlugin ? [grokOAuthPlugin] : []),
    bearer(),
  ],
});

/** Run the public Better Auth endpoint with credential-safe failure context. */
export async function handleAuthRequest(request: Request): Promise<Response> {
  const started = Date.now();
  const route = new URL(request.url).pathname;
  try {
    const response = postgresAuthDialect
      ? await postgresAuthDialect.runInRequest(() => auth.handler(request))
      : await auth.handler(request);
    const failure = response.status >= 500;
    if (failure) {
      const schemaDiagnostic = await diagnoseBetterAuthSchema();
      console.error("[auth] Better Auth endpoint failed", {
        ...authFailureDetails(request),
        responseStatus: response.status,
        schemaDiagnosticState: schemaDiagnostic.diagnosticState,
        missingTableCount: schemaDiagnostic.missingTables.length,
        missingColumnCount: schemaDiagnostic.missingColumnCount,
      });
      const error = schemaDiagnostic.diagnosticState === "incompatible"
        ? "AUTH_SCHEMA_INCOMPATIBLE"
        : "BETTER_AUTH_HANDLER_FAILED";
      return new Response(JSON.stringify({
        status: schemaDiagnostic.diagnosticState === "incompatible" ? 503 : 500,
        error,
        schemaDiagnosticState: schemaDiagnostic.diagnosticState,
        missingTables: schemaDiagnostic.missingTables,
        missingColumnCount: schemaDiagnostic.missingColumnCount,
      }), {
        status: schemaDiagnostic.diagnosticState === "incompatible" ? 503 : 500,
        headers: {
          "content-type": "application/json",
          "cache-control": "no-store",
        },
      });
    }
    emitOperationalEvent({
      component: "auth",
      operation: "endpoint",
      route,
      outcome: failure ? "failure" : "success",
      durationMs: Date.now() - started,
      statusCode: response.status,
      failureCategory: failure ? "auth-endpoint" : undefined,
    });
    return response;
  } catch (error) {
    const details = authFailureDetails(request, error);
    console.error("[auth] Better Auth endpoint threw", details);
    emitOperationalEvent({
      component: "auth",
      operation: "endpoint",
      route,
      outcome: "failure",
      durationMs: Date.now() - started,
      failureCategory: details.failureCategory,
      errorName: details.errorName,
    });
    throw error;
  }
}

/** Record a server-side session lookup failure without logging cookie/token values. */
export function logSessionLookupFailure(request: Request, error: unknown): void {
  const details = authFailureDetails(request, error);
  console.error("[auth] Better Auth getSession failed", details);
  emitOperationalEvent({
    component: "auth",
    operation: "session-lookup",
    route: new URL(request.url).pathname,
    outcome: "failure",
    durationMs: 0,
    failureCategory: details.failureCategory,
    errorName: details.errorName,
  });
}

export function readSessionToken(): string | null {
  return getCookie(SESSION_TOKEN_COOKIE) ?? null;
}

export { GROK_PROVIDERS } from "./providers";
