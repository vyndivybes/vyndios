import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const verify = await readFile(new URL("../src/lib/auth/verify.server.ts", import.meta.url), "utf8");
const session = await readFile(new URL("../src/lib/auth/session-policy.ts", import.meta.url), "utf8");

test("SSR protected route checks authoritative database session, not opaque cookieCache", () => {
  assert.match(verify, /auth\.api\.getSession\(\{\s*headers,\s*query:\s*\{\s*disableCookieCache:\s*true\s*\}\s*\}\)/);
  assert.match(verify, /withAuthPostgresRequest/);
  assert.match(verify, /sessionRequestMemo\(request, cacheKey/);
});

test("no login/session policy bypass or shared development identity introduced", () => {
  assert.match(verify, /if \(!session\?\.user\) return null/);
  assert.match(verify, /throw new UnauthorizedError\(\)/);
  assert.match(session, /SESSION_EXPIRES_IN_SECONDS = 24 \* 60 \* 60/);
});
