import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const lock = JSON.parse(await readFile(new URL("../package-lock.json", import.meta.url), "utf8"));

test("Cloudflare auth pins reviewed upstream patch version across manifest and lockfile", () => {
  assert.equal(pkg.dependencies["better-auth"], "1.7.26");
  assert.equal(lock.packages[""].dependencies["better-auth"], "1.7.26");
  assert.equal(lock.packages["node_modules/better-auth"]?.version, "1.7.26");
  assert.equal(lock.packages["node_modules/@better-auth/core"]?.version, "1.7.26");
});

test("Cloudflare authorization remains fail-closed and request-scoped", async () => {
  const authServer = await readFile(new URL("../src/lib/auth/server.ts", import.meta.url), "utf8");
  const verify = await readFile(new URL("../src/lib/auth/verify.server.ts", import.meta.url), "utf8");
  assert.match(authServer, /runInRequest\(work\)/);
  assert.match(verify, /withAuthPostgresRequest/);
  assert.match(verify, /disableCookieCache:\s*true/);
  assert.match(verify, /throw new UnauthorizedError/);
});
