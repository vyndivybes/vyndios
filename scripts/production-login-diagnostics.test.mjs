import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const files = [
  "scripts/vyndi-golden-enterprise-journey.mjs",
  "scripts/vyndi-production-playwright-smoke.mjs",
  "scripts/operator-ux-hardening.mjs",
];

for (const file of files) {
  test(`${file} captures actionable login diagnostics`, async () => {
    const source = await readFile(file, "utf8");
    assert.match(source, /login-diagnostic\.png/);
    assert.match(source, /finalUrl/);
    assert.match(source, /visibleText/);
    assert.match(source, /pageErrors/);
    assert.match(source, /Login failed/);
  });
}
