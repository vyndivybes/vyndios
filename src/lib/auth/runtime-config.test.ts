import assert from "node:assert/strict";
import test from "node:test";
import {
  AUTH_ALLOWED_HOSTS,
  AUTH_TRUSTED_ORIGINS,
  CLOUDFLARE_PRODUCTION_ORIGIN,
  resolveAuthBaseURL,
  resolveAuthSecret,
} from "./runtime-config.ts";

test("only canonical Cloudflare production and local/preview hosts are trusted", () => {
  assert.ok(AUTH_ALLOWED_HOSTS.includes("vyndios.shyamsundhar1982.workers.dev"));
  assert.ok(AUTH_TRUSTED_ORIGINS.includes("https://vyndios.shyamsundhar1982.workers.dev"));
  assert.ok(!AUTH_ALLOWED_HOSTS.some((host) => host.includes("vercel.app")));
  assert.ok(!AUTH_TRUSTED_ORIGINS.some((origin) => origin.includes("vercel.app")));
  assert.ok(!AUTH_ALLOWED_HOSTS.some((host) => host.includes("tiger-field-flora-finch")));
});

test("auth base URL resolves dynamically with Cloudflare as the safe fallback", () => {
  assert.deepEqual(resolveAuthBaseURL(undefined), {
    allowedHosts: [...AUTH_ALLOWED_HOSTS],
    fallback: CLOUDFLARE_PRODUCTION_ORIGIN,
    protocol: "auto",
  });
  assert.equal(resolveAuthBaseURL("https://example.test").fallback, "https://example.test");
});

test("database-backed authentication derives a stable secret when deployment env is incomplete", () => {
  const options = {
    configuredSecret: undefined,
    databaseUrl: "postgres://configured",
    authDisabled: false,
    previewSecret: () => "unstable-preview-secret",
  };
  const first = resolveAuthSecret(options);
  const second = resolveAuthSecret(options);
  assert.equal(first, second);
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.notEqual(first, options.databaseUrl);
  assert.notEqual(first, options.previewSecret());
});

test("an explicit Better Auth secret always takes precedence", () => {
  assert.equal(
    resolveAuthSecret({
      configuredSecret: "dedicated-production-secret",
      databaseUrl: "postgres://configured",
      authDisabled: false,
      previewSecret: () => "preview-secret",
    }),
    "dedicated-production-secret",
  );
});

test("preview fallback remains available without a production database", () => {
  assert.equal(
    resolveAuthSecret({
      configuredSecret: undefined,
      databaseUrl: undefined,
      authDisabled: false,
      previewSecret: () => "preview-secret",
    }),
    "preview-secret",
  );
});
