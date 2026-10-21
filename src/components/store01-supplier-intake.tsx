import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Panel } from "@/components/kpi";
import { preflightStore01Dock } from "@/lib/store01-dock-preflight";

type Row = Record<string, unknown>;
type PreparedDockDraft = {
  purchaseOrderId: string;
  quantityReceived: number;
  sourceReference: string;
  invoiceNumber: string;
  invoiceEvidenceReference: string;
  temperatureLogReference: string;
};

const value = (row: Row, key: string) => String(row[key] ?? "");
const qty = (row: Row, key: string) => Number(row[key] ?? 0);
const money = (amount: number | null) =>
  amount === null ? "—" : new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(amount);

export function Store01SupplierIntake({
  purchaseOrders,
  onPrepare,
}: {
  purchaseOrders: Row[];
  onPrepare: (draft: PreparedDockDraft) => void;
}) {
  const [poId, setPoId] = useState("");
  const [physicallyReceived, setPhysicallyReceived] = useState(0);
  const [invoiceQuantity, setInvoiceQuantity] = useState(0);
  const [invoiceValueExGstInr, setInvoiceValueExGstInr] = useState(0);
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [deliveryReference, setDeliveryReference] = useState("");
  const [invoiceEvidenceReference, setInvoiceEvidenceReference] = useState("");
  const [coldChainRequired, setColdChainRequired] = useState(false);
  const [temperatureLogReference, setTemperatureLogReference] = useState("");
  const po = purchaseOrders.find((row) => value(row, "id") === poId);
  const preview = preflightStore01Dock({
    purchaseOrderId: poId,
    poStatus: value(po ?? {}, "status"),
    quantityOpen: qty(po ?? {}, "quantity_open"),
    unitPriceInr: qty(po ?? {}, "unit_price_inr"),
    physicallyReceived,
    invoiceQuantity,
    invoiceValueExGstInr,
    invoiceNumber,
    deliveryReference,
    invoiceEvidenceReference,
    coldChainRequired,
    temperatureLogReference,
  });

  function choosePo(next: string) {
    const selected = purchaseOrders.find((row) => value(row, "id") === next);
    const open = selected ? qty(selected, "quantity_open") : 0;
    const price = selected ? qty(selected, "unit_price_inr") : 0;
    setPoId(next);
    setPhysicallyReceived(open);
    setInvoiceQuantity(open);
    setInvoiceValueExGstInr(Math.round(open * price * 100) / 100);
  }

  return (
    <Panel title="Store 01 · Supplier delivery & invoice preflight" kicker="Advisory intake · no automatic stock or finance posting">
      <p className="mb-4 text-sm text-muted">
        Compare the counted supplier parts, issued PO and invoice before preparing a quarantined GRN.
        Barcode scanners acting as keyboards may enter IDs and document references. Invoice fields are
        manually verified at this stage; OCR and robot actions are not connected.
      </p>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <label className="text-xs font-semibold text-muted">
          Issued purchase order
          <select className="control mt-1.5" value={poId} onChange={(event) => choosePo(event.target.value)}>
            <option value="">Select PO</option>
            {purchaseOrders.filter((row) =>
              ["issued", "part_received"].includes(value(row, "status")) && qty(row, "quantity_open") > 0
            ).map((row) => (
              <option key={value(row, "id")} value={value(row, "id")}>
                {value(row, "id")} · {value(row, "sku")} · {value(row, "supplier_name")}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-semibold text-muted">
          Physically counted quantity
          <input className="control mt-1.5" type="number" min="0" step="0.0001" value={physicallyReceived}
            onChange={(event) => setPhysicallyReceived(Number(event.target.value))} />
        </label>
        <label className="text-xs font-semibold text-muted">
          Supplier invoiced quantity
          <input className="control mt-1.5" type="number" min="0" step="0.0001" value={invoiceQuantity}
            onChange={(event) => setInvoiceQuantity(Number(event.target.value))} />
        </label>
        <label className="text-xs font-semibold text-muted">
          Invoice taxable value (INR, ex GST)
          <input className="control mt-1.5" type="number" min="0" step="0.01" value={invoiceValueExGstInr}
            onChange={(event) => setInvoiceValueExGstInr(Number(event.target.value))} />
        </label>
        <label className="text-xs font-semibold text-muted">
          Original supplier invoice number
          <input className="control mt-1.5" value={invoiceNumber}
            onChange={(event) => setInvoiceNumber(event.target.value)} placeholder="Supplier-issued number" />
        </label>
        <label className="text-xs font-semibold text-muted">
          Delivery document / challan reference
          <input className="control mt-1.5" value={deliveryReference}
            onChange={(event) => setDeliveryReference(event.target.value)} placeholder="Scan or type reference" />
        </label>
        <label className="text-xs font-semibold text-muted">
          Invoice evidence reference
          <input className="control mt-1.5" value={invoiceEvidenceReference}
            onChange={(event) => setInvoiceEvidenceReference(event.target.value)} placeholder="Scanned document reference" />
        </label>
        <label className="text-xs font-semibold text-muted">
          Temperature / out-time log reference
          <input className="control mt-1.5" value={temperatureLogReference}
            onChange={(event) => setTemperatureLogReference(event.target.value)}
            placeholder={coldChainRequired ? "Required evidence" : "When applicable"} />
        </label>
      </div>
      <label className="mt-4 flex min-h-11 items-center gap-3 text-sm text-muted">
        <input type="checkbox" checked={coldChainRequired}
          onChange={(event) => setColdChainRequired(event.target.checked)} />
        Temperature-sensitive material (for example, qualified prepreg)
      </label>
      <div className="mt-4 rounded-lg border border-border bg-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-semibold text-accent">
            {preview.disposition === "PREPARE_QUARANTINED_GRN" ? "Intake preflight clear" : "Intake held for review"}
          </p>
          <span className="font-mono text-xs text-muted">
            Expected ex-GST {money(preview.expectedInvoiceValueExGstInr)} · variance {money(preview.invoiceVarianceInr)}
          </span>
        </div>
        {preview.findings.length > 0 ? (
          <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-muted">
            {preview.findings.map((finding) => (
              <li key={finding.code}>{finding.code.replaceAll("_", " ")} · {finding.message}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-xs text-muted">
            Documentary preflight only. Incoming inspection and quality release are still mandatory.
          </p>
        )}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-4">
        <button type="button" disabled={preview.disposition !== "PREPARE_QUARANTINED_GRN"}
          className="min-h-11 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-bg disabled:cursor-not-allowed disabled:opacity-40"
          onClick={() => onPrepare({
            purchaseOrderId: poId,
            quantityReceived: physicallyReceived,
            sourceReference: deliveryReference,
            invoiceNumber,
            invoiceEvidenceReference,
            temperatureLogReference: coldChainRequired ? temperatureLogReference : "",
          })}>
          Prepare quarantined GRN draft
        </button>
        <Link to="/command/payables" className="text-sm font-semibold text-accent underline-offset-4 hover:underline">
          Open governed supplier invoice matching
        </Link>
      </div>
      <p className="mt-3 text-xs text-muted">
        Preparing a draft does not create inventory, approve an invoice or release material. A separate
        authorized receiving transaction and Finance three-way match remain mandatory.
      </p>
    </Panel>
  );
}
