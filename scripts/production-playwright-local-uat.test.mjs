import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const auth = await readFile(new URL("./vyndi-production-auth-setup.mjs", import.meta.url), "utf8").catch(()=>"");
const uat = await readFile(new URL("./vyndi-production-uat.mjs", import.meta.url), "utf8").catch(()=>"");
const gitignore = await readFile(new URL("../.gitignore", import.meta.url), "utf8").catch(()=>"");
const pkg = await readFile(new URL("../package.json", import.meta.url), "utf8").catch(()=>"");

test("local production UAT uses manual login and persistent Playwright storage state without password env vars", () => {
  assert.match(auth, /storageState/);
  assert.match(auth, /headless:\s*false/);
  assert.match(auth, /waitForURL/);
  assert.doesNotMatch(auth, /VYNDI_TEST_PASSWORD|VYNDI_UAT_PASSWORD/);
  assert.match(gitignore, /^\.auth\/$/m);
});

test("production UAT validates release identity, database/schema health and protected workspaces", () => {
  assert.match(uat, /api\/runtime\/release-marker/);
  assert.match(uat, /api\/runtime\/health/);
  assert.match(uat, /pendingMigrationCount/);
  for (const route of ["/command/inventory","/command/funding","/command/people-office","/command/quality","/command/recovery"]) {
    assert.match(uat, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("production UAT refuses silent destructive writes and captures evidence", () => {
  assert.match(uat, /read-only-authenticated/);
  assert.match(uat, /writePhase/);
  assert.match(uat, /BLOCKED/);
  assert.match(uat, /evidence\.json/);
  assert.match(uat, /screenshot/);
});

test("package exposes zero-cost local auth and UAT commands", () => {
  assert.match(pkg, /"uat:prod:auth"/);
  assert.match(pkg, /"uat:prod"/);
});
