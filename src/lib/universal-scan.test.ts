import assert from "node:assert/strict";
import test from "node:test";
import {
  evidenceTargetTypeForKind,
  parseUniversalScanPayload,
  scanRouteForKind,
} from "./universal-scan.ts";

test("explicit VYNDI QR payloads resolve supported governed record types", () => {
  assert.deepEqual(parseUniversalScanPayload("VYNDI:TRV:TRV-001"), {
    raw: "VYNDI:TRV:TRV-001",
    recognized: true,
    kind: "traveller",
    identifier: "TRV-001",
    signature: null,
  });
  assert.equal(parseUniversalScanPayload("VYNDI:SKU:HB-AL-420").kind, "inventory_item");
  assert.equal(parseUniversalScanPayload("VYNDI:NCR:NCR-2026-0087").kind, "quality_ncr");
  assert.equal(parseUniversalScanPayload("VYNDI:ASSET:CNC-004").kind, "equipment");
});

test("scanner payload keeps an optional signature separate from the authoritative identifier", () => {
  const parsed = parseUniversalScanPayload("VYNDI:JOB:JBC-0042:sig-v1-abc");
  assert.equal(parsed.kind, "job_card");
  assert.equal(parsed.identifier, "JBC-0042");
  assert.equal(parsed.signature, "sig-v1-abc");
});

test("common raw shop-floor identifiers are recognized without requiring a QR wrapper", () => {
  assert.equal(parseUniversalScanPayload("JBC-abc").kind, "job_card");
  assert.equal(parseUniversalScanPayload("TRV-abc").kind, "traveller");
  assert.equal(parseUniversalScanPayload("PO-abc").kind, "purchase_order");
  assert.equal(parseUniversalScanPayload("GRN-abc").kind, "grn");
  assert.equal(parseUniversalScanPayload("NCR-abc").kind, "quality_ncr");
  assert.equal(parseUniversalScanPayload("CAPA-abc").kind, "quality_capa");
  assert.equal(parseUniversalScanPayload("MWO-abc").kind, "maintenance_work_order");
});

test("unknown scanner values remain search-only rather than being fabricated into a business object", () => {
  const parsed = parseUniversalScanPayload("782055");
  assert.equal(parsed.recognized, false);
  assert.equal(parsed.kind, "unknown");
  assert.equal(parsed.identifier, "782055");
  assert.equal(evidenceTargetTypeForKind(parsed.kind), null);
});

test("scan routes reuse canonical workspaces instead of creating scanner-owned business truth", () => {
  assert.equal(scanRouteForKind("job_card"), "/command/production");
  assert.equal(scanRouteForKind("inventory_item"), "/command/inventory");
  assert.equal(scanRouteForKind("quality_capa"), "/command/quality");
  assert.equal(scanRouteForKind("maintenance_work_order"), "/command/manufacturing");
  assert.equal(scanRouteForKind("unknown"), null);
});
