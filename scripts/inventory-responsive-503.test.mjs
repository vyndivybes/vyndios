import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("inventory route does not perform a redundant role lookup after parent Command RBAC", async () => {
  const source = await readFile(new URL("../src/routes/command/inventory.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /import\s*\{\s*getCommandRole\s*\}/);
  assert.doesNotMatch(source, /Promise\.all\(\[getMasterInventoryItems\(\),\s*getCommandRole\(\)\]\)/);
  assert.match(source, /loader:\s*async \(\{ context \}\)/);
  assert.match(source, /const items = await getMasterInventoryItems\(\)/);
  assert.match(source, /role:\s*context\.commandRole/);
});

test("responsive production UX records route HTTP failure evidence", async () => {
  const source = await readFile(new URL("./operator-ux-hardening.mjs", import.meta.url), "utf8");
  assert.match(source, /routeNetworkEvidence/);
  assert.match(source, /responseBody/);
  assert.match(source, /durationMs/);
  assert.match(source, /response\.status\(\)/);
});
