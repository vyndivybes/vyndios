import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./operator-ux-hardening.mjs", import.meta.url), "utf8");

test("operator UX qualification covers desktop, tablet and mobile", () => {
  for (const width of ["1440", "1180", "768", "390"]) assert.match(source, new RegExp(width));
  assert.match(source, /tablet-/);
  assert.match(source, /scrollWidth/);
  assert.match(source, /clientWidth/);
  assert.match(source, /financial-cockpit/);
});


test("finance viewport UAT scopes readiness to the newly mounted Consolidated Finance page", () => {
  const blockStart = source.indexOf('const terminal = expectedOperationsHold');
  const blockEnd = source.indexOf('readinessVerdict = assertProductionRouteReadiness({', blockStart);
  assert.ok(blockStart >= 0 && blockEnd > blockStart, "readiness must be checked in its route-specific block");
  const block = source.slice(blockStart, blockEnd);
  assert.match(block, /route === "\/command\/financial-cockpit"/, "financial route must have a dedicated target-scoped terminal");
  assert.match(block, /getByRole\("heading", \{ name: "Consolidated Finance", level: 1, exact: true \}\)/, "only a Finance heading identifies the new route");
  assert.match(block, /\.filter\(\{\s*has:.*\}\)/s, "terminal must be filtered by the target heading, not a stale Operations status");
  assert.match(block, /data-route-readiness="ready"/, "genuine ready state must be accepted");
  assert.match(block, /data-route-readiness="error"/, "genuine error state must remain observable and fail closed");
});
