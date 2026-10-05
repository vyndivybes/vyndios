import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const files = [
  "scripts/vyndi-golden-enterprise-journey.mjs",
  "scripts/vyndi-production-playwright-smoke.mjs",
  "scripts/operator-ux-hardening.mjs",
];

for (const file of files) {
  test(`${file} records sanitized sign-in HTTP evidence`, async () => {
    const source = await readFile(file, "utf8");
    assert.match(source, /\/api\/auth\/sign-in\/email/);
    assert.match(source, /authNetworkEvidence/);
    assert.match(source, /status:/);
    assert.match(source, /durationMs:/);
    assert.match(source, /responseBody:/);
    assert.doesNotMatch(source, /postData\(/);
  });
}
