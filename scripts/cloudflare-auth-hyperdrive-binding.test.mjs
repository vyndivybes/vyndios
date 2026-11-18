import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const transport = await readFile(new URL("../src/lib/postgres-runtime.ts", import.meta.url), "utf8");
const worker = await readFile(new URL("../src/lib/postgres-worker-env.server.ts", import.meta.url), "utf8");

test("Cloudflare Hyperdrive is obtained through static server-only importable env", () => {
  assert.match(worker, /import\s*\{\s*env\s+as\s+workerEnv\s*\}\s*from\s*["']cloudflare:workers["']/);
  assert.match(worker, /HYPERDRIVE\?\.connectionString/);
  assert.match(transport, /await\s+import\(["']\.\/postgres-worker-env\.server\.ts["']\)/);
  assert.doesNotMatch(transport, /vite-ignore/);
});

test("Cloudflare Hyperdrive is tried before direct DATABASE_URL fallback", () => {
  const start = transport.indexOf("export async function resolvePostgresTransport");
  assert.ok(start > 0, "resolver must remain present");
  const body = transport.slice(start);
  assert.ok(body.indexOf("cloudflareHyperdriveConnectionString()") < body.indexOf("process.env.DATABASE_URL"), "Hyperdrive takes precedence");
  assert.match(body, /selectPostgresTransport\(\{ hyperdriveConnectionString, databaseUrl \}\)/);
});
