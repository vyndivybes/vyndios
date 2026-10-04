import assert from "node:assert/strict";
import test from "node:test";

test("production Playwright smoke records preflight diagnostics before authentication", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(new URL("./vyndi-production-playwright-smoke.mjs", import.meta.url), "utf8"),
  );

  assert.match(source, /preflight/);
  assert.match(source, /release-marker/);
  assert.match(source, /health/);
  assert.match(source, /server-timing|cf-ray/i);
  assert.match(source, /VYNDI_TEST_EXPECTED_SHA/);
});
