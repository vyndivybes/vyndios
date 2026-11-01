/**
 * Store 01 dock-side preflight. Advisory only: never posts a GRN, invoice,
 * inventory movement, payment, robot task, or quality release.
 * Canonical three-way matching remains post_vyndi_supplier_invoice in SQL.
 */
export type Store01DockInput = {
  purchaseOrderId: string;
  poStatus: string;
  quantityOpen: number;
  unitPriceInr: number;
  physicallyReceived: number;
  invoiceQuantity: number;
  invoiceValueExGstInr: number;
  invoiceNumber: string;
  deliveryReference: string;
  invoiceEvidenceReference: string;
  coldChainRequired: boolean;
  temperatureLogReference: string;
};

export type Store01DockFinding = {
  code: string;
  severity: "block" | "review";
  message: string;
};

export type Store01DockResult = {
  disposition: "HOLD_FOR_REVIEW" | "PREPARE_QUARANTINED_GRN";
  findings: Store01DockFinding[];
  expectedInvoiceValueExGstInr: number | null;
  invoiceVarianceInr: number | null;
  invoiceQuantityVariance: number | null;
};

const toPaise = (value: number) => Math.round((value + Number.EPSILON) * 100);
const positive = (value: number) => Number.isFinite(value) && value > 0;
const nonNegative = (value: number) => Number.isFinite(value) && value >= 0;

/**
 * Document scanning or an AI extractor can propose values for these fields,
 * but a user must review source evidence and post through governed screens.
 */
export function preflightStore01Dock(input: Store01DockInput): Store01DockResult {
  const findings: Store01DockFinding[] = [];
  const add = (code: string, severity: Store01DockFinding["severity"], message: string) =>
    findings.push({ code, severity, message });

  if (!input.purchaseOrderId.trim()) add("PO_REQUIRED", "block", "Choose an authorized purchase order.");
  if (!["issued", "part_received"].includes(input.poStatus)) {
    add("PO_NOT_ISSUED", "block", "Purchase order must be issued or part received.");
  }
  if (!positive(input.quantityOpen)) add("NO_PO_BALANCE", "block", "No open PO quantity is available.");
  if (!nonNegative(input.unitPriceInr)) add("PO_PRICE_INVALID", "block", "PO unit price is not valid.");
  if (!positive(input.physicallyReceived)) add("COUNT_REQUIRED", "block", "Record a positive physical count.");
  if (!positive(input.invoiceQuantity)) add("INVOICE_QTY_REQUIRED", "block", "Record the supplier's invoiced quantity.");
  if (!nonNegative(input.invoiceValueExGstInr)) add("INVOICE_VALUE_INVALID", "block", "Record a valid taxable invoice amount.");
  if (!input.invoiceNumber.trim()) add("INVOICE_NUMBER_REQUIRED", "block", "Record the original supplier invoice number.");
  if (!input.deliveryReference.trim()) add("DELIVERY_EVIDENCE_REQUIRED", "block", "Delivery document reference is required.");
  if (!input.invoiceEvidenceReference.trim()) add("INVOICE_EVIDENCE_REQUIRED", "block", "Source invoice evidence reference is required.");
  if (input.coldChainRequired && !input.temperatureLogReference.trim()) {
    add("TEMPERATURE_EVIDENCE_REQUIRED", "block", "Temperature-sensitive materials require handling and out-time evidence.");
  }

  if (positive(input.quantityOpen) && positive(input.physicallyReceived) &&
      input.physicallyReceived > input.quantityOpen + 0.0001) {
    add("OVER_DELIVERY", "review", "Physical count exceeds the open purchase order quantity.");
  }
  if (positive(input.physicallyReceived) && positive(input.invoiceQuantity) &&
      Math.abs(input.physicallyReceived - input.invoiceQuantity) > 0.0001) {
    add("DELIVERY_INVOICE_QUANTITY_MISMATCH", "review",
      "Physical count differs from the supplier invoice quantity; investigate shortage or excess.");
  }

  const expected = nonNegative(input.unitPriceInr) && positive(input.invoiceQuantity)
    ? toPaise(input.unitPriceInr * input.invoiceQuantity) / 100
    : null;
  const actual = nonNegative(input.invoiceValueExGstInr)
    ? toPaise(input.invoiceValueExGstInr) / 100
    : null;
  const variance = expected !== null && actual !== null
    ? (toPaise(actual) - toPaise(expected)) / 100
    : null;

  if (variance !== null && Math.abs(variance) > 0.01) {
    add("PO_INVOICE_PRICE_MISMATCH", "review",
      "Supplier taxable amount does not equal invoice quantity multiplied by the governed PO price.");
  }

  return {
    disposition: findings.length ? "HOLD_FOR_REVIEW" : "PREPARE_QUARANTINED_GRN",
    findings,
    expectedInvoiceValueExGstInr: expected,
    invoiceVarianceInr: variance,
    invoiceQuantityVariance: positive(input.physicallyReceived) && positive(input.invoiceQuantity)
      ? input.physicallyReceived - input.invoiceQuantity
      : null,
  };
}
