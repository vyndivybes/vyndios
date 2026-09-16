import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const inventorySource = fs.readFileSync(
  new URL("../src/routes/command/inventory.tsx", import.meta.url),
  "utf8",
);
const engineeringSource = fs.readFileSync(
  new URL("../src/routes/command/engineering.tsx", import.meta.url),
  "utf8",
);
const operationsSource = fs.readFileSync(
  new URL("../src/routes/command/operations.tsx", import.meta.url),
  "utf8",
);
const manufacturingSource = fs.readFileSync(
  new URL("../src/routes/command/manufacturing.tsx", import.meta.url),
  "utf8",
);
const actualsSource = fs.readFileSync(
  new URL("../src/routes/command/actuals.tsx", import.meta.url),
  "utf8",
);
const commandRouteSource = fs.readFileSync(
  new URL("../src/routes/command/route.tsx", import.meta.url),
  "utf8",
);
const rootSource = fs.readFileSync(
  new URL("../src/routes/__root.tsx", import.meta.url),
  "utf8",
);

test("Master Inventory stock health uses a full-view responsive register", () => {
  assert.ok(inventorySource.includes('data-full-view-table="master-inventory-stock-health"'));
  assert.ok(!inventorySource.includes("overflow-x-auto"));
  assert.ok(!inventorySource.includes("min-w-[980px]"));
  assert.ok(inventorySource.includes("lg:grid"));
  assert.ok(inventorySource.includes("lg:hidden"));
});

test("Master Inventory full-view register preserves operating fields and audit access", () => {
  for (const label of ["Item", "Ledger", "Available", "MSL", "Health", "Plan / mo", "36-mo forecast", "Audit"]) {
    assert.ok(inventorySource.includes(label), `missing stock-health field: ${label}`);
  }
  assert.ok(inventorySource.includes("getMasterInventoryData"));
  assert.ok(inventorySource.includes("saveMasterInventoryEntry"));
  assert.ok(inventorySource.includes("/command/inventory-ledgers/$ledger"));
  assert.ok(inventorySource.includes("sku: item.sku"));
});

test("Engineering canonical registers use full-view responsive layouts", () => {
  assert.ok(engineeringSource.includes('data-full-view-table="engineering-baseline-register"'));
  assert.ok(engineeringSource.includes('data-full-view-table="engineering-change-register"'));
  assert.ok(!engineeringSource.includes("overflow-x-auto"));
  assert.ok(!engineeringSource.includes("min-w-[1050px]"));
  assert.ok(!engineeringSource.includes("min-w-[900px]"));
  assert.ok(engineeringSource.includes("lg:grid"));
  assert.ok(engineeringSource.includes("lg:hidden"));
});

test("Engineering full-view registers preserve governed authority and lifecycle fields", () => {
  for (const label of [
    "Family / variant",
    "Revision",
    "Geometry / material",
    "Tooling",
    "Drawing / BOM",
    "Status",
    "ECR",
    "Target",
    "Reason",
  ]) {
    assert.ok(engineeringSource.includes(label), `missing engineering field: ${label}`);
  }
  assert.ok(engineeringSource.includes("listEngineeringAuthority"));
  assert.ok(engineeringSource.includes("vyndi_engineering_baselines"));
  assert.ok(engineeringSource.includes("vyndi_engineering_change_requests"));
});

test("Operations nested registers are integrated full-view layouts without inner horizontal scroll", () => {
  assert.ok(operationsSource.includes('data-full-view-table="operations-dispatch-register"'));
  assert.ok(operationsSource.includes('data-full-view-table="operations-order-to-cash-lineage"'));
  assert.ok(!operationsSource.includes("overflow-x-auto"));
  assert.ok(operationsSource.includes("lg:grid"));
  assert.ok(operationsSource.includes("lg:hidden"));
  assert.ok(operationsSource.includes("<details"));
});

test("Operations full-view registers preserve canonical lineage and downstream evidence", () => {
  for (const label of [
    "Shipment",
    "Order / job",
    "Units",
    "Quality",
    "Finance downstream",
    "Order",
    "Job Card",
    "Material",
    "Procurement",
    "Traveller",
    "Dispatch / invoice / collection",
  ]) {
    assert.ok(operationsSource.includes(label), `missing operations field: ${label}`);
  }
  assert.ok(operationsSource.includes("listDispatchRegister"));
  assert.ok(operationsSource.includes("getOperatingLineage"));
  assert.ok(operationsSource.includes("vyndi_dispatch_register"));
  assert.ok(operationsSource.includes("This surface does not write Finance records"));
});

test("Manufacturing control register uses a full-view responsive layout", () => {
  assert.ok(manufacturingSource.includes('data-full-view-table="manufacturing-control-register"'));
  assert.ok(!manufacturingSource.includes("overflow-x-auto"));
  assert.ok(!manufacturingSource.includes("min-w-[68rem]"));
  assert.ok(manufacturingSource.includes("lg:grid"));
  assert.ok(manufacturingSource.includes("lg:hidden"));
});

test("Manufacturing full-view register preserves every governed control field", () => {
  for (const label of ["ID", "Control", "Requirement", "Domain", "Status", "Stage", "Evidence", "Owner"]) {
    assert.ok(manufacturingSource.includes(label), `missing manufacturing field: ${label}`);
  }
  assert.ok(manufacturingSource.includes("MANUFACTURING_CONTROLS"));
  assert.ok(manufacturingSource.includes("MANUFACTURING_STATUS_LABELS"));
  assert.ok(manufacturingSource.includes("c.requirement"));
  assert.ok(manufacturingSource.includes("c.note"));
});

test("Finance actuals use full-view responsive registers without inner horizontal scroll", () => {
  assert.ok(actualsSource.includes('data-full-view-table="monthly-actual-reconciliation"'));
  assert.ok(actualsSource.includes('data-full-view-table="rolling-forecast-basis"'));
  assert.ok(!actualsSource.includes("overflow-x-auto"));
  assert.ok(!actualsSource.includes("min-w-[1450px]"));
  assert.ok(!actualsSource.includes("min-w-[850px]"));
  assert.ok(actualsSource.includes("lg:grid"));
  assert.ok(actualsSource.includes("lg:hidden"));
  assert.ok(actualsSource.includes("md:grid"));
  assert.ok(actualsSource.includes("md:hidden"));
});

test("Command system enforces the no-horizontal-scroll full-view contract", () => {
  assert.ok(commandRouteSource.includes('data-vyndi-full-view="command-system"'));
  assert.ok(commandRouteSource.includes('overflow-x: clip'));
  assert.ok(commandRouteSource.includes('.max-w-7xl'));
  assert.ok(commandRouteSource.includes('max-width: none !important'));
  assert.ok(commandRouteSource.includes(':where(.overflow-x-auto, .overflow-x-scroll)'));
  assert.ok(commandRouteSource.includes('overflow-x: visible !important'));
  assert.ok(commandRouteSource.includes('[class*="min-w-["]'));
  assert.ok(commandRouteSource.includes('table-layout: fixed'));
  assert.ok(commandRouteSource.includes('overflow-wrap: anywhere'));
  assert.ok(commandRouteSource.includes('nav.overflow-x-auto > .min-w-max'));
  assert.ok(commandRouteSource.includes('flex-wrap: wrap'));
});

test("App root exposes a connected page-loading status bar for route transitions", () => {
  assert.ok(rootSource.includes("useRouterState"));
  assert.ok(rootSource.includes('state.status === "pending"'));
  assert.ok(rootSource.includes('data-page-loading-status="route-transition"'));
  assert.ok(rootSource.includes("Loading view…"));
});