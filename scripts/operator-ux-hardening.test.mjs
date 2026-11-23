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
  assert.match(block, /getByRole\("heading", \{ name: \/\^Consolidated Finance\(\?: Overview\)\?\$\/, level: 1 \}\)/, "both approved-plan and unapproved Finance headings must identify this route");
  assert.match(block, /\.filter\(\{\s*has:.*\}\)/s, "terminal must be filtered by the target heading, not a stale Operations status");
  assert.match(block, /data-route-readiness="ready"/, "genuine ready state must be accepted");
  assert.match(block, /data-route-readiness="error"/, "genuine error state must remain observable and fail closed");
});


test("Finance readiness selector covers both genuine UI states and excludes Operations", async () => {
  const route = await readFile(new URL("../src/routes/command/financial-cockpit.tsx", import.meta.url), "utf8");
  assert.match(route, /<h1[^>]*>Consolidated Finance<\/h1>/, "the pending/error and blocked Finance heading exists");
  assert.match(route, /<h1[^>]*>Consolidated Finance Overview<\/h1>/, "the approved-plan Finance heading exists");
  const selector = /^Consolidated Finance(?: Overview)?$/;
  assert.match("Consolidated Finance", selector);
  assert.match("Consolidated Finance Overview", selector);
  assert.doesNotMatch("Operations", selector);
  assert.doesNotMatch("Inventory warnings unavailable", selector);
});


test("all asynchronous route readiness checks bind to the newly rendered page", async () => {
  for (const [route, heading] of [
    ["/command/inventory", "Master Inventory"],
    ["/command/risk", "Risk Register"],
    ["/command/quality", "Quality & Product Compliance"],
  ]) {
    assert.ok(source.includes(JSON.stringify(route) + ': ' + JSON.stringify(heading)), route + " route identity must be explicit");
  }
  assert.match(source, /const targetHeading = readinessHeadings\[route\]/, "select the heading from the active route");
  assert.match(source, /filter\(\{ has: page\.getByRole\("heading", \{ name: targetHeading, level: 1, exact: true \}\) \}\)/,
    "terminal status must be a descendant of the active route's heading-bearing section");
  assert.match(source, /expectedOperationsHold[\s\S]*?const terminal[\s\S]*?assertProductionRouteReadiness\(/,
    "the existing explicit Operations HOLD and fail-closed verdict must remain");
});

test("inventory HOLD readiness belongs to Master Inventory, never stale Quality or Risk", async () => {
  const inventory = await readFile(new URL("../src/routes/command/inventory.tsx", import.meta.url), "utf8");
  assert.match(inventory, /<section data-route-readiness=\{state\.status\}/);
  assert.match(inventory, /<h1[^>]*>Master Inventory<\/h1>/);
  assert.match(inventory, /VYNDI_INVENTORY_VENTURE_SCOPE_HOLD|MasterInventory/);
});
