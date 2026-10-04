import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read=(path)=>readFile(new URL(`../${path}`,import.meta.url),"utf8");
const [thread,authority,panel,intelligence,vibpe,pkg]=await Promise.all([
  read("src/lib/digital-product-thread.ts"),
  read("src/lib/enterprise-digital-thread-authority.ts"),
  read("src/components/enterprise-digital-thread-panel.tsx"),
  read("src/routes/command/intelligence.tsx"),
  read("src/lib/vibpe-governance-queries.ts"),
  read("package.json"),
]);

test("Package M extends the existing Digital Product Thread instead of creating a second graph authority",()=>{
  assert.match(thread,/extendEnterpriseDigitalThread/);
  for(const token of ["supplier","purchase_order","goods_receipt","inventory_lot","inventory_movement","traveller","equipment","operator","quality_inspection","ncr","capa","sales_order","invoice","job_cost","risk"]) assert.ok(thread.includes(token),token);
  assert.doesNotMatch(authority,/create table/i);
});

test("enterprise thread authority reads canonical procurement FIFO production quality finance and risk evidence",()=>{
  for(const token of ["vyndi_purchase_orders","vyndi_goods_receipts","epr_inventory_fifo_allocations","epr_travellers","epr_operation_controls","vyndi_quality_inspections","vyndi_quality_ncrs","vyndi_quality_capas","vyndi_quality_releases","vyndi_shipments","vyndi_invoices","epr_job_cost_snapshots","vyndi_risk_intelligence"]) assert.ok(authority.includes(token),token);
  assert.match(authority,/SERIAL_SHIPMENT_ALLOCATION_MISSING/);
  assert.match(authority,/canAccessRoute/);
  assert.match(authority,/\/command\/intelligence/);
});

test("Product Intelligence exposes cross-domain trace and exactness without inferring missing serial dispatch identity",()=>{
  assert.match(intelligence,/EnterpriseDigitalThreadPanel/);
  assert.match(panel,/Enterprise Digital Thread/);
  assert.match(panel,/Impact/);
  assert.match(panel,/Serial → shipment/);
  assert.match(panel,/not inferred/i);
  assert.match(panel,/serialShipmentExact/);
});

test("VIBPE can answer enterprise digital-thread and affected-by questions from canonical evidence",()=>{
  assert.match(vibpe,/isEnterpriseDigitalThreadQuestion/);
  assert.match(vibpe,/enterpriseDigitalThreadAnswer/);
  assert.match(vibpe,/affected/i);
  assert.match(vibpe,/Serial → shipment identity/);
  assert.match(vibpe,/EXACT/);
  assert.match(vibpe,/INCOMPLETE\/LEGACY/);
});

test("aggregate test gate includes Package M unit and integration coverage",()=>{
  assert.match(pkg,/vyndi-enterprise-digital-thread\.test\.mjs/);
  assert.match(pkg,/enterprise-digital-thread-model\.test\.ts/);
});
