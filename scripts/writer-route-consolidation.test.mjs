import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read=(p)=>readFile(p,"utf8");

test("canonical authority registry names one writer and one primary route per governed domain",async()=>{
  const registry=await read("src/lib/authority-path-registry.ts");
  for(const domain of ["commercial","inventory","quality","peopleOffice","funding","recovery"]){
    assert.ok(registry.includes(domain),domain);
  }
  for(const writer of [
    "@/lib/sales-order-authority",
    "@/lib/master-inventory",
    "@/lib/quality-authority",
    "@/lib/people-office-authority",
    "@/lib/cash-funding-authority",
    "@/lib/recovery-control"
  ]) assert.ok(registry.includes(writer),writer);
});

test("legacy and reference inventory routes cannot remain competing writers",async()=>{
  const [legacy,catalogue,master]=await Promise.all([
    read("src/routes/command/inventory-legacy.tsx"),
    read("src/routes/inventory.tsx"),
    read("src/lib/master-inventory.ts")
  ]);
  assert.match(legacy,/redirect\(\{\s*to:\s*"\/command\/inventory"/s);
  assert.doesNotMatch(legacy,/INVENTORY_CONTROL_PAGES|createMasterData|saveMasterInventoryEntry/);

  assert.doesNotMatch(catalogue,/useInventory/);
  assert.doesNotMatch(catalogue,/localStorage/);
  assert.doesNotMatch(catalogue,/setItems\(/);
  assert.doesNotMatch(catalogue,/function\s+save\s*\(/);
  assert.doesNotMatch(catalogue,/function\s+remove\s*\(/);
  assert.match(catalogue,/Reference only/i);

  assert.match(master,/approved Inventory Master/i);
});

test("database blocks new master-inventory SKU identity unless Inventory Master approved it",async()=>{
  const migration=await read("migrations/0143_writer_route_consolidation.sql");
  assert.match(migration,/guard_vyndi_master_inventory_identity/i);
  assert.match(migration,/after insert on master_inventory_items/i);
  assert.match(migration,/master_data_records/i);
  assert.match(migration,/domain='inventory'/i);
  assert.match(migration,/status='approved'/i);
});

test("Funding lifecycle tables emit canonical enterprise audit events",async()=>{
  const migration=await read("migrations/0143_writer_route_consolidation.sql");
  for(const table of [
    "vyndi_funding_loan_ledger",
    "vyndi_funding_grants",
    "vyndi_funding_grant_receipts",
    "vyndi_funding_grant_utilisation",
    "vyndi_funding_grant_conditions"
  ]) assert.ok(migration.includes(table),table);
  for(const action of [
    "FUNDING_LOAN_DRAWDOWN_RECORDED",
    "FUNDING_LOAN_INTEREST_ACCRUED",
    "FUNDING_LOAN_PRINCIPAL_REPAID",
    "FUNDING_LOAN_INTEREST_REPAID",
    "FUNDING_GRANT_CREATED",
    "FUNDING_GRANT_RECEIPT_LINKED",
    "FUNDING_GRANT_UTILISATION_POSTED",
    "FUNDING_GRANT_CONDITION_RECORDED"
  ]) assert.ok(migration.includes(action),action);
});

test("critical command routes never own direct database writers",async()=>{
  for(const path of [
    "src/routes/command/sales.tsx",
    "src/routes/command/inventory.tsx",
    "src/routes/command/quality.tsx",
    "src/routes/command/people-office.tsx",
    "src/routes/command/funding.tsx",
    "src/routes/command/recovery.tsx"
  ]){
    const source=await read(path);
    assert.doesNotMatch(source,/from\s+["']@\/lib\/db["']/);
    assert.doesNotMatch(source,/createServerFn\s*\(/);
  }
});
