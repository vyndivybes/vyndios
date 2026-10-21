import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { preflightStore01Dock, type Store01DockInput } from "./store01-dock-preflight.ts";

const base: Store01DockInput = {
  purchaseOrderId: "PO-001",
  poStatus: "issued",
  quantityOpen: 10,
  unitPriceInr: 100,
  physicallyReceived: 10,
  invoiceQuantity: 10,
  invoiceValueExGstInr: 1000,
  invoiceNumber: "SINV-001",
  deliveryReference: "DC-001",
  invoiceEvidenceReference: "SCAN-001",
  coldChainRequired: false,
  temperatureLogReference: "",
};
const preflight = (overrides: Partial<Store01DockInput> = {}) =>
  preflightStore01Dock({ ...base, ...overrides });

test("matching supplier delivery is only cleared to prepare quarantined GRN, not stock posting", () => {
  const result = preflight();
  assert.equal(result.disposition, "PREPARE_QUARANTINED_GRN");
  assert.deepEqual(result.findings, []);
  assert.equal(result.expectedInvoiceValueExGstInr, 1000);
  assert.equal(result.invoiceVarianceInr, 0);
});

test("over-delivery and short-shipment mismatch are flagged", () => {
  const result = preflight({ physicallyReceived: 11, invoiceQuantity: 10 });
  assert.equal(result.disposition, "HOLD_FOR_REVIEW");
  assert.ok(result.findings.some((f) => f.code === "OVER_DELIVERY"));
  assert.ok(result.findings.some((f) => f.code === "DELIVERY_INVOICE_QUANTITY_MISMATCH"));
});

test("price discrepancies are never classified as clear", () => {
  const result = preflight({ invoiceValueExGstInr: 1100 });
  assert.equal(result.invoiceVarianceInr, 100);
  assert.ok(result.findings.some((f) => f.code === "PO_INVOICE_PRICE_MISMATCH"));
});

test("missing delivery or invoice evidence blocks preflight", () => {
  const result = preflight({ deliveryReference: "", invoiceEvidenceReference: "" });
  assert.equal(result.disposition, "HOLD_FOR_REVIEW");
  assert.ok(result.findings.some((f) => f.code === "DELIVERY_EVIDENCE_REQUIRED"));
  assert.ok(result.findings.some((f) => f.code === "INVOICE_EVIDENCE_REQUIRED"));
});

test("temperature-sensitive prepreg must carry handling evidence", () => {
  const result = preflight({ coldChainRequired: true });
  assert.ok(result.findings.some((f) => f.code === "TEMPERATURE_EVIDENCE_REQUIRED"));
  assert.equal(preflight({ coldChainRequired: true, temperatureLogReference: "TEMP-LOG-101" }).disposition,
    "PREPARE_QUARANTINED_GRN");
});

test("PO authorization is mandatory", () => {
  assert.ok(preflight({ poStatus: "draft" }).findings.some((f) => f.code === "PO_NOT_ISSUED"));
  assert.ok(preflight({ quantityOpen: 0 }).findings.some((f) => f.code === "NO_PO_BALANCE"));
  assert.ok(preflight({ purchaseOrderId: "" }).findings.some((f) => f.code === "PO_REQUIRED"));
});

test("non-finite monetary and physical values fail closed", () => {
  assert.ok(preflight({ invoiceValueExGstInr: Number.NaN }).findings.some((f) => f.code === "INVOICE_VALUE_INVALID"));
  assert.ok(preflight({ physicallyReceived: Infinity }).findings.some((f) => f.code === "COUNT_REQUIRED"));
});

test("receiving integration never automatically accepts or posts receipts or invoices", async () => {
  const page = await readFile(new URL("../routes/command/receiving.tsx", import.meta.url), "utf8");
  const panel = await readFile(new URL("../components/store01-supplier-intake.tsx", import.meta.url), "utf8");
  assert.match(page, /<Store01SupplierIntake/);
  assert.match(page, /inspectionStatus: "quarantine"/);
  assert.match(page, /quantityAccepted: 0/);
  assert.match(panel, /onPrepare/);
  assert.doesNotMatch(panel, /postSupplierInvoice|postGoodsReceiptWithIdentity|postSupplierPaymentCash/);
});
