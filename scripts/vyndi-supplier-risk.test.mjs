import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read=(path)=>readFile(new URL(`../${path}`,import.meta.url),"utf8");
const [model,authority,migration,route,component,vibpe,ux]=await Promise.all([
  read("src/lib/supplier-risk-model.ts"),
  read("src/lib/supplier-risk-authority.ts"),
  read("migrations/0108_vyndi_supplier_risk.sql"),
  read("src/routes/command/procurement.tsx"),
  read("src/components/supplier-risk-panel.tsx"),
  read("src/lib/vibpe-governance-queries.ts"),
  read("scripts/operator-ux-hardening.mjs"),
]);

test("Supplier Risk separates governed ratings from empirical delivery and quality evidence",()=>{
  assert.match(model,/singleSourceProbability:null/);
  assert.match(model,/governedReliabilityPct/);
  assert.match(model,/deliveryForecast/);
  assert.match(model,/actualLeadTime/);
  assert.match(model,/incomingQuality/);
  assert.match(model,/No geographic or geopolitical supplier risk is inferred/);
});

test("Supplier Risk derives only from approved lanes and PO GRN evidence",()=>{
  assert.match(authority,/vyndi_approved_supplier_lanes/);
  assert.match(authority,/vyndi_purchase_orders/);
  assert.match(authority,/vyndi_goods_receipts/);
  assert.match(authority,/supplier_approval_status='approved'/);
  assert.match(migration,/Immutable Supplier Risk snapshots/);
  assert.match(authority,/SUPPLIER_RISK_CAPTURED/);
});

test("Procurement Control owns Supplier Risk intelligence",()=>{
  assert.match(route,/SupplierRiskPanel/);
  assert.match(component,/Supplier Risk Intelligence/);
  assert.match(component,/SINGLE SOURCE/);
  assert.match(component,/Late probability/);
  assert.match(component,/Reject probability/);
});

test("VIBPE reports only captured governed Supplier Risk evidence",()=>{
  assert.match(vibpe,/isSupplierRiskIntelligenceQuestion/);
  assert.match(vibpe,/vyndi_supplier_risk_runs/);
  assert.match(vibpe,/No governed Supplier Risk snapshot has been captured/);
});

test("Procurement stays in responsive qualification",()=>{
  assert.match(ux,/\/command\/procurement/);
});
