import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const verify = await readFile(new URL("../src/lib/auth/verify.server.ts", import.meta.url), "utf8");
const roles = await readFile(new URL("../src/lib/command-user-role.server.ts", import.meta.url), "utf8");

test("session verification is memoized once per ambient request", () => {
  assert.match(verify, /createRequestMemoizer/);
  assert.match(verify, /sessionRequestMemo/);
  assert.match(verify, /auth\.api\.getSession/);
  assert.match(verify, /sessionRequestMemo\(/);
});

test("assigned role resolution is request-memoized and bootstrap admin reads are side-effect free", () => {
  assert.match(roles, /createRequestMemoizer/);
  assert.match(roles, /roleRequestMemo/);
  assert.match(roles, /getRequest\(\)/);
  assert.doesNotMatch(roles, /insert into vindy_user_roles/i);
  assert.match(roles, /return "admin"/);
});
