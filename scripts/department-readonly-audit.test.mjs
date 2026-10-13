import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Source-contract qualification only. Authenticated browser + independent
// production-ledger readback remain mandatory separate acceptance gates.
const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const inventory = read("src/lib/master-inventory.ts");
const invPage = read("src/routes/command/inventory.tsx");
const invLedger = read("src/routes/command/inventory-ledgers/$ledger.tsx");
const finance = read("src/routes/command/accounting.tsx");
const procurement = read("src/routes/command/purchase-execution.tsx");
const quality = read("src/routes/command/quality.tsx");
const qualitySource = read("src/lib/quality-authority.ts");
const migration = read("migrations/0061_full_day_to_day_catalogue.sql");

function readHandler(name, nextName) {
  const a = inventory.indexOf("export const " + name + " =");
  assert.ok(a >= 0, name + " handler missing");
  const b = inventory.indexOf("export const " + nextName + " =", a + 1);
  assert.ok(b > a, name + " next boundary missing");
  return inventory.slice(a, b);
}

test("inventory page and ledger GET handlers are strictly read-only", () => {
  for (const [fn, next] of [
    ["getMasterInventoryItems", "getMasterInventoryData"],
    ["getMasterInventoryData", "saveMasterInventoryEntry"],
  ]) {
    const source = readHandler(fn, next);
    assert.match(source, /method: "GET"/);
    assert.doesNotMatch(source, /ensureSeeds|ensureComponentCatalogue|\binsert into\b|\bupdate\s+master_inventory_items\b/i);
  }
  assert.doesNotMatch(inventory, /__masterInventorySeedPromise__/);
});

test("catalogue seeding remains under idempotent SQL migration, not a GET", () => {
  assert.match(migration, /insert into master_inventory_items/i);
  assert.match(migration, /on conflict/i);
  assert.match(inventory, /from master_inventory_items i/);
});

test("zero-stock catalogue items remain observable without receipt or balance rows", () => {
  assert.match(inventory, /left join vyndi_inventory_available_to_promise/i);
  assert.match(inventory, /coalesce\(atp\.physical_quantity,\s*0\) as available_quantity/i);
  assert.match(invPage, /Across \$\{items\.length\} SKUs/);
  assert.match(invLedger, /including zero balance/);
  assert.match(invLedger, /items\.map/);
});

test("accounting, purchase execution and quality remain separate canonical operator workspaces", () => {
  assert.match(finance, /createFileRoute\("\/command\/accounting"\)/);
  assert.match(procurement, /getPurchaseExecutionData/);
  assert.match(procurement, /getPurchaseHistoryData/);
  assert.match(quality, /listQualityAuthority/);
  assert.match(qualitySource, /QUALITY_REGISTER_QUERY/);
});

test("quality empty states are factual, and a production HOLD is not silently relabelled released", () => {
  assert.match(quality, /No canonical inspection record has been posted yet/);
  assert.match(quality, /No NCR recorded/);
  assert.match(quality, /No serialized Quality release recorded/);
  assert.match(quality, /Product release remains an explicit approval action/);
});

test("departmental browser audit has a dedicated route scope and preserves full-route acceptance", () => {
  const smoke = read("scripts/vyndi-production-playwright-smoke.mjs");
  const wrapper = read("scripts/vyndi-department-playwright-smoke.mjs");
  const ci = read(".github/workflows/production-assurance.yml");
  const pkg = JSON.parse(read("package.json"));
  assert.match(smoke, /VYNDI_TEST_DEPARTMENT_AUDIT/);
  assert.match(smoke, /const selectedRoutes = departmentalAuditOnly/);
  assert.match(smoke, /for \(const route of selectedRoutes\)/);
  assert.match(smoke, /departmentalAuditOnly \? "DEPARTMENT_AUDIT"/);
  assert.match(wrapper, /VYNDI_TEST_DEPARTMENT_AUDIT = "1"/);
  assert.match(pkg.scripts["test:browser:departments"], /vyndi-department-playwright-smoke/);
  assert.match(ci, /name: Independent four-department browser acceptance[\s\S]*run: npm run test:browser:departments[\s\S]*name: Authenticated protected-route smoke/);
});
