import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read=(path)=>readFile(new URL(`../${path}`,import.meta.url),"utf8");
const [migration,dispatch,operations,thread,pkg]=await Promise.all([
  read("migrations/0112_vyndi_serialized_dispatch_thread.sql"),
  read("src/lib/dispatch-authority.ts"),
  read("src/routes/command/operations.tsx"),
  read("src/lib/enterprise-digital-thread-authority.ts"),
  read("package.json"),
]);

test("future dispatch uses governed serial allocation without inventing legacy shipment identity",()=>{
  assert.match(migration,/serial_allocation_required boolean not null default false/);
  assert.match(migration,/vyndi_shipment_serial_allocations/);
  assert.match(migration,/where status='active'/);
  assert.match(migration,/unique.*quality_release|quality_release.*unique/i);
  assert.match(migration,/unique.*traveller|traveller.*unique/i);
  assert.match(migration,/legacy/i);
});

test("serialized allocation is fail-closed to current released serials from the same Job Card and order",()=>{
  assert.match(migration,/allocate_vyndi_shipment_serial/);
  assert.match(migration,/decision='released'/);
  assert.match(migration,/superseded_at is null/);
  assert.match(migration,/job_card_id/);
  assert.match(migration,/sales_order_id/);
  assert.match(migration,/Shipment serialized capacity is already complete|allocation capacity/i);
});

test("shipment identity remains historical while current Quality Release coverage is a separate control",()=>{
  assert.match(migration,/allocated_serial_count/);
  assert.match(migration,/current_released_serial_count/);
  assert.match(migration,/serialization_complete/);
  assert.match(migration,/release_coverage_complete/);
  assert.match(dispatch,/currentReleasedSerialCount/);
  assert.match(dispatch,/releaseCoverageComplete/);
});

test("future invoice insert requires exact serialized shipment coverage",()=>{
  assert.match(migration,/vyndi_require_serialized_dispatch_before_invoice/);
  assert.match(migration,/serial_allocation_required/);
  assert.match(migration,/active_serials/);
  assert.match(migration,/Serialized dispatch allocation is incomplete/i);
});

test("shipment reversal releases active serialized allocations without deleting audit history",()=>{
  assert.match(migration,/vyndi_reverse_serial_allocations_with_shipment/);
  assert.match(migration,/status='reversed'/);
  assert.match(migration,/SHIPMENT_SERIAL_ALLOCATION_REVERSED/);
  assert.doesNotMatch(migration,/delete from vyndi_shipment_serial_allocations/i);
});

test("dispatch authority exposes candidates allocation and controlled deallocation",()=>{
  assert.match(dispatch,/allocatedSerialCount/);
  assert.match(dispatch,/serialNumbers/);
  assert.match(dispatch,/listDispatchSerialCandidates/);
  assert.match(dispatch,/allocateDispatchSerial/);
  assert.match(dispatch,/deallocateDispatchSerial/);
  assert.match(dispatch,/allocate_vyndi_shipment_serial/);
  assert.match(dispatch,/deallocate_vyndi_shipment_serial/);
});

test("Operations shows exact serialized dispatch status and lets operators assign released serials",()=>{
  assert.match(operations,/Serialized/);
  assert.match(operations,/Allocate serial/);
  assert.match(operations,/allocatedSerialCount/);
  assert.match(operations,/serialNumbers/);
});

test("Enterprise Digital Thread consumes exact shipment allocations and withholds the gap only when incomplete",()=>{
  assert.match(thread,/vyndi_shipment_serial_allocations/);
  assert.match(thread,/quality_release_id/);
  assert.match(thread,/serialShipmentExact/);
  assert.match(thread,/SERIAL_SHIPMENT_ALLOCATION_MISSING/);
  assert.match(thread,/allocatedSerialByShipment/);
});

test("aggregate test gate includes serialized dispatch closure",()=>{
  assert.match(pkg,/vyndi-serialized-dispatch-thread\.test\.mjs/);
});


test("dispatch register preserves the legacy CREATE OR REPLACE VIEW column contract and appends new serialization fields",()=>{
  const viewStart=migration.indexOf("create or replace view vyndi_dispatch_register as");
  const viewEnd=migration.indexOf("comment on view vyndi_dispatch_register",viewStart);
  const view=migration.slice(viewStart,viewEnd);
  const legacy=[
    "s.id as shipment_id",
    "s.sales_order_id",
    "o.revision as sales_order_revision",
    "s.job_card_id",
    "s.plan_month",
    "s.units",
    "s.status",
    "s.owner_workspace",
    "s.source_reference",
    "s.posted_by",
    "s.posted_at",
    "current_quality_release_count",
    "i.id as invoice_id",
    "i.status as invoice_status",
    "i.amount_lakh as invoice_amount_lakh",
  ];
  let cursor=-1;
  for(const token of legacy){
    const next=view.indexOf(token,cursor+1);
    assert.ok(next>cursor,`legacy dispatch view column order changed at ${token}`);
    cursor=next;
  }
  assert.ok(view.indexOf("s.serial_allocation_required",cursor)>cursor,"new serialization columns must be appended after legacy columns");
});
