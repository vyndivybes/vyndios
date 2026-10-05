import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

for (const file of [
  "scripts/vyndi-golden-enterprise-journey.mjs",
  "scripts/vyndi-production-playwright-smoke.mjs",
  "scripts/operator-ux-hardening.mjs",
]) {
  test(`${file} retries the normal Better Auth login once before failing`, async () => {
    const source = await readFile(file, "utf8");
    assert.match(source, /attempt <= 2/);
    assert.match(source, /created=false/);
    assert.match(source, /login\?returnTo=%2Fcommand/);
    assert.match(source, /Login failed/);
  });
}
