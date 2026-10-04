import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const read=(p)=>readFile(new URL(`../${p}`,import.meta.url),"utf8");
const [migration,model,authority,panel,route,vibpe,controls,pkg]=await Promise.all([
  read("migrations/0114_vyndi_supplier_performance.sql"),
  read("src/lib/supplier-performance-model.ts"),
  read("src/lib/supplier-performance-authority.ts"),
  read("src/components/supplier-performance-panel.tsx"),
  read("src/routes/command/procurement.tsx"),
  read("src/lib/vibpe-governance-queries.ts"),
  read("src/lib/data/manufacturing-control.ts"),
  read("package.json"),
]);

test("Package O extends supplier authority with append-only response evidence and immutable scorecard snapshots",()=>{
  assert.match(migration,/vyndi_supplier_response_events/);
  assert.match(migration,/vyndi_supplier_performance_runs/);
  assert.match(migration,/supersedes_event_id/);
  assert.match(migration,/vyndi_reject_supplier_performance_mutation/);
  assert.match(migration,/before update or delete/i);
});

test("supplier scorecard keeps dimensions explicit instead of inventing a weighted supplier score",()=>{
  for(const token of ["otifPct","rejectPpm","acceptanceYieldPct","capaEffectivenessEvidencePct","costVariancePct","traceabilityCompletenessPct","meanResponseHours","medianResponseHours","evidenceCoveragePct"]) assert.ok(model.includes(token),token);
  assert.doesNotMatch(model,/weightedScore|overallScore|Math\.random/);
});

test("scorecard authority derives from canonical suppliers PO GRN QMS invoice and response evidence",()=>{
  for(const token of ["vyndi_suppliers","vyndi_purchase_orders","vyndi_goods_receipts","vyndi_quality_inspections","vyndi_quality_ncrs","vyndi_quality_capas","vyndi_supplier_invoices","vyndi_supplier_response_events"]) assert.match(authority,new RegExp(token));
  assert.match(authority,/recordSupplierResponseEvent/);
  assert.match(authority,/captureSupplierPerformanceSnapshot/);
  assert.match(authority,/type SupplierPerformanceResult/);
});

test("Procurement Control owns the supplier performance scorecard beside existing supplier risk",()=>{
  assert.match(route,/SupplierRiskPanel/);
  assert.match(route,/SupplierPerformancePanel/);
  assert.match(panel,/Supplier Performance & Quality Scorecard/);
  assert.match(panel,/OTIF/);
  assert.match(panel,/PPM/);
  assert.match(panel,/Traceability/);
  assert.match(panel,/Responsiveness/);
});

test("VIBPE answers supplier performance questions only from governed scorecard evidence",()=>{
  assert.match(vibpe,/isSupplierPerformanceQuestion/);
  assert.match(vibpe,/supplierPerformanceAnswer/);
  assert.match(vibpe,/OTIF/);
  assert.match(vibpe,/PPM/);
  assert.match(vibpe,/cost variance/i);
});

test("Manufacturing M-15 moves from planned to verification only when the scorecard capability exists",()=>{
  assert.match(controls,/id: "M-15"[\s\S]*status: "verify"/);
  assert.match(controls,/Supplier scorecard authority implemented/);
});

test("aggregate test gate includes Package O",()=>{
  assert.match(pkg,/vyndi-supplier-performance\.test\.mjs/);
  assert.match(pkg,/supplier-performance-model\.test\.ts/);
});


test("Package O TypeScript source contains no connector escape artifacts",()=>{
  for(const [name,source] of [
    ["model",model],
    ["authority",authority],
    ["panel",panel],
    ["vibpe",vibpe],
  ]){
    assert.equal(source.includes("\\`"),false,`${name} contains an escaped backtick artifact`);
    assert.equal(source.includes("\\\${"),false,`${name} contains an escaped template placeholder artifact`);
  }
});
