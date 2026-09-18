import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useMemo, useState, type ReactNode } from "react";
import { Kpi, Panel } from "@/components/kpi";
import {
  getSalesLedgerWorkspace,
  issueCustomerCreditNote,
  issueSpareSaleInvoice,
  postCustomerRefund,
  postCustomerReturn,
  postSpareSaleDispatch,
  reverseCustomerRefund,
  reverseSpareSaleDispatch,
} from "@/lib/sales-ledger-authority";

export const Route = createFileRoute("/command/sales-ledger")({
  loader: () => getSalesLedgerWorkspace(),
  component: SalesLedgerWorkspace,
});

const text = (row: Record<string, unknown>, key: string) => String(row[key] ?? "");
const num = (row: Record<string, unknown>, key: string) => Number(row[key] ?? 0);
const money = (value: unknown) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(Number(value ?? 0));
const today = () => new Date().toISOString().slice(0, 10);
type TaxMode = "cgst_sgst" | "igst" | "zero_rated" | "exempt";

function SalesLedgerWorkspace() {
  const data = Route.useLoaderData();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [dispatch, setDispatch] = useState({
    planMonth: 1,
    inventoryItemId: data.inventory[0]?.id ?? "",
    quantity: 1,
    unitPriceInr: 0,
    channel: "direct" as "direct" | "dealer" | "online",
    dispatchOn: today(),
    sourceReference: "",
    selectedIdentityUid: "",
  });
  const uninvoiced = data.spareSales.filter((row) => text(row, "status") === "dispatched" && !text(row, "invoice_id"));
  const [invoice, setInvoice] = useState({
    spareSaleId: text(uninvoiced[0] ?? {}, "id"),
    sourceReference: "",
    recipientName: "",
    recipientGstin: "",
    recipientAddress: "",
    deliveryAddress: "",
    placeOfSupplyCode: "",
    hsnSac: "8714",
    itemDescription: "",
    unitCode: "NOS",
    taxRatePct: 18,
    taxMode: "cgst_sgst" as TaxMode,
    creditTermsDays: 0,
    creditTermsReference: "",
    taxEvidenceReference: "",
  });
  const returnableInvoices = data.ledger.filter((row) => text(row, "invoice_status") === "issued");
  const [customerReturn, setCustomerReturn] = useState({
    invoiceId: text(returnableInvoices[0] ?? {}, "invoice_id"),
    planMonth: 1,
    returnedOn: today(),
    quantity: 1,
    disposition: "quarantine" as "restock" | "quarantine" | "scrap",
    identityUid: "",
    reason: "",
    sourceReference: "",
  });

  const selectedItem = data.inventory.find((item) => item.id === dispatch.inventoryItemId);
  const selectedReturnInvoice = returnableInvoices.find((row) => text(row, "invoice_id") === customerReturn.invoiceId);
  const returnIdentityOptions = data.identities.filter((identity) =>
    selectedReturnInvoice?.sale_type === "bicycle" ? identity.identityKind === "finished_product" : true
  );
  const identityOptions = useMemo(
    () => data.identities.filter((identity) => identity.partSku.toUpperCase() === (selectedItem?.sku ?? "").toUpperCase()),
    [data.identities, selectedItem?.sku],
  );
  const issued = data.ledger.filter((row) => text(row, "invoice_status") === "issued");
  const bicycle = issued.filter((row) => text(row, "sale_type") === "bicycle");
  const spares = issued.filter((row) => text(row, "sale_type") === "spare_component");
  const taxable = (rows: Record<string, unknown>[]) => rows.reduce((sum, row) => sum + num(row, "taxable_value_inr"), 0);
  const openAr = issued.reduce((sum, row) => sum + num(row, "balance_inr"), 0);

  async function run(task: () => Promise<unknown>, success: string) {
    setBusy(true);
    setMessage("");
    try {
      await task();
      setMessage(success);
      await router.invalidate();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Sales action could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  async function createDispatch() {
    if (!selectedItem) return;
    const id = `SP-${crypto.randomUUID()}`;
    await run(
      () => postSpareSaleDispatch({ data: {
        id,
        planMonth: dispatch.planMonth,
        inventoryItemId: selectedItem.id,
        quantity: dispatch.quantity,
        unitPriceInr: dispatch.unitPriceInr,
        channel: dispatch.channel,
        dispatchOn: dispatch.dispatchOn,
        sourceReference: dispatch.sourceReference,
        selectedIdentityUid: dispatch.selectedIdentityUid || undefined,
      } }),
      `${id} posted. FIFO inventory and COGS moved; revenue remains zero until invoice issue.`,
    );
  }

  async function createInvoice() {
    const sale = data.spareSales.find((row) => text(row, "id") === invoice.spareSaleId);
    if (!sale) return;
    const id = `INV-SP-${crypto.randomUUID()}`;
    await run(
      () => issueSpareSaleInvoice({ data: {
        id,
        spareSaleId: invoice.spareSaleId,
        sourceReference: invoice.sourceReference,
        recipientName: invoice.recipientName,
        recipientGstin: invoice.recipientGstin || undefined,
        recipientAddress: invoice.recipientAddress,
        deliveryAddress: invoice.deliveryAddress,
        placeOfSupplyCode: invoice.placeOfSupplyCode,
        hsnSac: invoice.hsnSac,
        itemDescription: invoice.itemDescription || `${text(sale, "item_name")} · ${text(sale, "sku")}`,
        unitCode: invoice.unitCode,
        taxRatePct: invoice.taxMode === "zero_rated" || invoice.taxMode === "exempt" ? 0 : invoice.taxRatePct,
        taxMode: invoice.taxMode,
        reverseCharge: false,
        eInvoiceRequired: false,
        taxEvidenceReference: invoice.taxEvidenceReference,
        creditTermsDays: invoice.creditTermsDays,
        creditTermsReference: invoice.creditTermsReference,
      } }),
      `${id} issued. Sales Ledger, GST, Trade Receivable and due date were posted.`,
    );
  }

  async function reverseDispatch(row: Record<string, unknown>) {
    const reason = window.prompt("Controlled reversal reason", "")?.trim();
    if (!reason) return;
    await run(
      () => reverseSpareSaleDispatch({ data: { id: text(row, "id"), reason } }),
      `${text(row, "id")} reversed. Inventory and FIFO COGS were restored through controlled reversal.`,
    );
  }

  async function createCustomerReturn() {
    if (!customerReturn.invoiceId) return;
    const id = `RMA-${crypto.randomUUID()}`;
    await run(
      () => postCustomerReturn({ data: {
        id,
        invoiceId: customerReturn.invoiceId,
        planMonth: customerReturn.planMonth,
        returnedOn: customerReturn.returnedOn,
        quantity: customerReturn.quantity,
        disposition: customerReturn.disposition,
        identityUid: customerReturn.identityUid || undefined,
        reason: customerReturn.reason,
        sourceReference: customerReturn.sourceReference,
      } }),
      `${id} recorded. Original invoice/dispatch remain intact; stock/COGS moved only if disposition is restock.`,
    );
  }

  async function issueCreditNote(row: Record<string, unknown>) {
    const sourceReference = window.prompt("Credit-note evidence / document reference")?.trim();
    if (!sourceReference) return;
    const id = `CN-${crypto.randomUUID()}`;
    await run(
      () => issueCustomerCreditNote({ data: { id, customerReturnId: text(row, "id"), creditOn: today(), sourceReference } }),
      `${id} issued. Revenue, output GST and receivable were reduced without voiding the original invoice.`,
    );
  }

  async function refundCredit(row: Record<string, unknown>) {
    const amountRaw = window.prompt("Customer refund amount · INR", text(row, "credit_open_inr"))?.trim();
    if (!amountRaw) return;
    const monthRaw = window.prompt("Canonical cash month · M1–M36", "1")?.trim();
    if (!monthRaw) return;
    const paymentPlanMonth = Number(monthRaw.replace(/^M/i, ""));
    if (!Number.isInteger(paymentPlanMonth) || paymentPlanMonth < 1 || paymentPlanMonth > 36) {
      setMessage("Customer refund cash month must be M1–M36; it is never inferred from the refund date.");
      return;
    }
    const evidenceReference = window.prompt("Unique bank / UTR refund evidence")?.trim();
    if (!evidenceReference) return;
    const id = `REF-${crypto.randomUUID()}`;
    await run(
      () => postCustomerRefund({ data: { id, creditNoteId: text(row, "id"), paymentPlanMonth, refundedOn: today(), amountInr: Number(amountRaw), evidenceReference } }),
      `${id} posted through Bank and verified canonical cash.`,
    );
  }

  async function reverseRefund(row: Record<string, unknown>) {
    const reason = window.prompt("Refund reversal evidence / reason")?.trim();
    if (!reason) return;
    await run(
      () => reverseCustomerRefund({ data: { id: text(row, "id"), reversedOn: today(), reason } }),
      `${text(row, "id")} refund reversed through Bank and canonical cash.`,
    );
  }

  return (
    <main className="mx-auto max-w-7xl space-y-6">
      <header className="flex flex-col gap-4 border-b border-border pb-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-green">Finance · actual invoiced sales authority</p>
          <h1 className="mt-2 font-display text-4xl text-accent">Sales Ledger</h1>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-muted">Actual invoices only. Bicycle and spare/component revenue remain separately visible while consolidating into total revenue, AR, Bank and canonical cash. Spare sales reuse Master Inventory FIFO and existing controlled identities; OEM identities are never replaced.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/command/sales" className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-muted hover:border-accent hover:text-accent">Demand & Orders</Link>
          <Link to="/command/receivables" className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-muted hover:border-accent hover:text-accent">Receivables</Link>
          <Link to="/command/accounting" className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-muted hover:border-accent hover:text-accent">Accounting</Link>
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Actual taxable sales" value={money(taxable(issued))} hint="Issued invoices only" />
        <Kpi label="Bicycle sales" value={money(taxable(bicycle))} hint={`${bicycle.length} invoice(s)`} />
        <Kpi label="Spare/component sales" value={money(taxable(spares))} hint={`${spares.length} invoice(s)`} />
        <Kpi label="Open receivable" value={money(openAr)} hint="Gross less collections" tone={openAr > 0 ? "warn" : "ok"} />
      </div>
      {message ? <div role="status" className="rounded-lg border border-border bg-surface px-4 py-3 text-sm text-muted">{message}</div> : null}

      <Panel title="Spare / component dispatch" kicker="Master Inventory → FIFO issue → COGS · no bicycle job card">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Field label="Plan month"><input className="control mt-1.5" type="number" min="1" max="36" value={dispatch.planMonth} onChange={(e) => setDispatch({ ...dispatch, planMonth: Number(e.target.value) })} /></Field>
          <Field label="Controlled component"><select className="control mt-1.5" value={dispatch.inventoryItemId} onChange={(e) => setDispatch({ ...dispatch, inventoryItemId: e.target.value, selectedIdentityUid: "" })}><option value="">Select component</option>{data.inventory.map((item) => <option key={item.id} value={item.id}>{item.sku} · {item.name} · ATP {item.availableToPromise}</option>)}</select></Field>
          <Field label="Quantity"><input className="control mt-1.5" type="number" min="0.0001" step="0.0001" value={dispatch.quantity} onChange={(e) => setDispatch({ ...dispatch, quantity: Number(e.target.value) })} /></Field>
          <Field label="Unit sale price · ₹"><input className="control mt-1.5" type="number" min="0.01" step="0.01" value={dispatch.unitPriceInr} onChange={(e) => setDispatch({ ...dispatch, unitPriceInr: Number(e.target.value) })} /></Field>
          <Field label="Channel"><select className="control mt-1.5" value={dispatch.channel} onChange={(e) => setDispatch({ ...dispatch, channel: e.target.value as typeof dispatch.channel })}><option value="direct">Direct</option><option value="dealer">Dealer</option><option value="online">Online</option></select></Field>
          <Field label="Dispatch date"><input className="control mt-1.5" type="date" value={dispatch.dispatchOn} onChange={(e) => setDispatch({ ...dispatch, dispatchOn: e.target.value })} /></Field>
          <Field label="Dispatch / customer evidence"><input className="control mt-1.5" value={dispatch.sourceReference} onChange={(e) => setDispatch({ ...dispatch, sourceReference: e.target.value })} /></Field>
          <Field label={`Controlled identity · ${selectedItem?.traceabilityClass === "A" ? "Class A" : "optional"}`}><select className="control mt-1.5" value={dispatch.selectedIdentityUid} onChange={(e) => setDispatch({ ...dispatch, selectedIdentityUid: e.target.value })}><option value="">Infer from FIFO allocation</option>{identityOptions.map((identity) => <option key={identity.identityUid} value={identity.identityUid}>{identity.visibleId} · OEM {identity.oemSerialNumber || identity.oemPartNumber || "n/a"}</option>)}</select></Field>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3"><button type="button" disabled={busy || !selectedItem || dispatch.quantity <= 0 || dispatch.unitPriceInr <= 0 || !dispatch.sourceReference} onClick={() => void createDispatch()} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-bg disabled:opacity-40">Post spare dispatch</button><p className="text-xs text-muted">ATP {selectedItem?.availableToPromise ?? 0} · reserved {selectedItem?.reservedQuantity ?? 0} · traceability {selectedItem?.traceabilityClass ?? "—"}. Serial selection cannot bypass FIFO.</p></div>
      </Panel>

      <Panel title="Spare tax invoice" kicker="Dispatch → Sales Ledger → GST → Trade Receivable">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Field label="Un-invoiced dispatch"><select className="control mt-1.5" value={invoice.spareSaleId} onChange={(e) => setInvoice({ ...invoice, spareSaleId: e.target.value })}><option value="">Select dispatch</option>{uninvoiced.map((row) => <option key={text(row, "id")} value={text(row, "id")}>{text(row, "id")} · {text(row, "sku")}</option>)}</select></Field>
          <Field label="Customer"><input className="control mt-1.5" value={invoice.recipientName} onChange={(e) => setInvoice({ ...invoice, recipientName: e.target.value })} /></Field>
          <Field label="Customer GSTIN"><input className="control mt-1.5" value={invoice.recipientGstin} onChange={(e) => setInvoice({ ...invoice, recipientGstin: e.target.value.toUpperCase() })} /></Field>
          <Field label="Place of supply · State code"><input className="control mt-1.5" maxLength={2} value={invoice.placeOfSupplyCode} onChange={(e) => setInvoice({ ...invoice, placeOfSupplyCode: e.target.value })} /></Field>
          <Field label="Invoice address"><input className="control mt-1.5" value={invoice.recipientAddress} onChange={(e) => setInvoice({ ...invoice, recipientAddress: e.target.value })} /></Field>
          <Field label="Delivery address"><input className="control mt-1.5" value={invoice.deliveryAddress} onChange={(e) => setInvoice({ ...invoice, deliveryAddress: e.target.value })} /></Field>
          <Field label="HSN"><input className="control mt-1.5" value={invoice.hsnSac} onChange={(e) => setInvoice({ ...invoice, hsnSac: e.target.value })} /></Field>
          <Field label="Description"><input className="control mt-1.5" value={invoice.itemDescription} onChange={(e) => setInvoice({ ...invoice, itemDescription: e.target.value })} /></Field>
          <Field label="Tax mode"><select className="control mt-1.5" value={invoice.taxMode} onChange={(e) => setInvoice({ ...invoice, taxMode: e.target.value as TaxMode })}><option value="cgst_sgst">CGST + SGST</option><option value="igst">IGST</option><option value="zero_rated">Zero rated</option><option value="exempt">Exempt</option></select></Field>
          <Field label="GST rate %"><input className="control mt-1.5" type="number" min="0" max="100" step="0.01" disabled={invoice.taxMode === "zero_rated" || invoice.taxMode === "exempt"} value={invoice.taxRatePct} onChange={(e) => setInvoice({ ...invoice, taxRatePct: Number(e.target.value) })} /></Field>
          <Field label="Credit terms · days"><input className="control mt-1.5" type="number" min="0" max="365" value={invoice.creditTermsDays} onChange={(e) => setInvoice({ ...invoice, creditTermsDays: Number(e.target.value) })} /></Field>
          <Field label="Credit terms evidence"><input className="control mt-1.5" value={invoice.creditTermsReference} onChange={(e) => setInvoice({ ...invoice, creditTermsReference: e.target.value })} /></Field>
          <Field label="Invoice source reference"><input className="control mt-1.5" value={invoice.sourceReference} onChange={(e) => setInvoice({ ...invoice, sourceReference: e.target.value })} /></Field>
          <Field label="Tax evidence reference"><input className="control mt-1.5" value={invoice.taxEvidenceReference} onChange={(e) => setInvoice({ ...invoice, taxEvidenceReference: e.target.value })} /></Field>
        </div>
        <button type="button" disabled={busy || !invoice.spareSaleId || !invoice.recipientName || !invoice.recipientAddress || !invoice.deliveryAddress || !/^\d{2}$/.test(invoice.placeOfSupplyCode) || !invoice.sourceReference || !invoice.taxEvidenceReference || !invoice.creditTermsReference} onClick={() => void createInvoice()} className="mt-4 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-bg disabled:opacity-40">Issue spare tax invoice</button>
      </Panel>

      <Panel title="Customer return / RMA" kicker="Invoice → controlled identity → disposition → credit note → refund">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Field label="Issued invoice"><select className="control mt-1.5" value={customerReturn.invoiceId} onChange={(e) => setCustomerReturn({ ...customerReturn, invoiceId:e.target.value, identityUid:"" })}><option value="">Select invoice</option>{returnableInvoices.map((row) => <option key={row.invoice_id} value={row.invoice_id}>{row.invoice_id} · {row.sale_type === "bicycle" ? "Bicycle" : "Spare"} · {row.item_reference}</option>)}</select></Field>
          <Field label="Return plan month"><input className="control mt-1.5" type="number" min="1" max="36" value={customerReturn.planMonth} onChange={(e) => setCustomerReturn({ ...customerReturn, planMonth:Number(e.target.value) })} /></Field>
          <Field label="Returned on"><input className="control mt-1.5" type="date" value={customerReturn.returnedOn} onChange={(e) => setCustomerReturn({ ...customerReturn, returnedOn:e.target.value })} /></Field>
          <Field label="Quantity"><input className="control mt-1.5" type="number" min="0.0001" step="0.0001" value={customerReturn.quantity} onChange={(e) => setCustomerReturn({ ...customerReturn, quantity:Number(e.target.value) })} /></Field>
          <Field label="Disposition"><select className="control mt-1.5" value={customerReturn.disposition} onChange={(e) => setCustomerReturn({ ...customerReturn, disposition:e.target.value as typeof customerReturn.disposition })}><option value="quarantine">Quarantine · no ATP / COGS reversal</option><option value="restock">Restock · restore inventory + COGS</option><option value="scrap">Scrap · no inventory restoration</option></select></Field>
          <Field label={selectedReturnInvoice?.sale_type === "bicycle" ? "Finished-product identity · required" : "Controlled identity · Class A auto-validates"}><select className="control mt-1.5" value={customerReturn.identityUid} onChange={(e) => setCustomerReturn({ ...customerReturn, identityUid:e.target.value })}><option value="">Use original spare identity / select bicycle serial</option>{returnIdentityOptions.map((identity) => <option key={identity.identityUid} value={identity.identityUid}>{identity.visibleId} · {identity.oemSerialNumber || identity.oemPartNumber || identity.identityKind}</option>)}</select></Field>
          <Field label="RMA / return reason"><input className="control mt-1.5" value={customerReturn.reason} onChange={(e) => setCustomerReturn({ ...customerReturn, reason:e.target.value })} /></Field>
          <Field label="Return evidence"><input className="control mt-1.5" value={customerReturn.sourceReference} onChange={(e) => setCustomerReturn({ ...customerReturn, sourceReference:e.target.value })} placeholder="RMA / inspection / receipt ref" /></Field>
        </div>
        <button type="button" disabled={busy || !customerReturn.invoiceId || customerReturn.quantity<=0 || !customerReturn.reason || !customerReturn.sourceReference || (selectedReturnInvoice?.sale_type === "bicycle" && !customerReturn.identityUid)} onClick={() => void createCustomerReturn()} className="mt-4 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-bg disabled:opacity-40">Post controlled return</button>
        <p className="mt-2 text-xs leading-5 text-muted">Bicycles and Class-A spares are one controlled identity per return. Quarantine/scrap never silently increase available stock. The original invoice remains immutable audit history.</p>
      </Panel>

      <Panel title="Return / credit / refund register" kicker="Append-only commercial correction chain">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data.customerReturns.map((row) => <article key={text(row, "id")} className="rounded-xl border border-border p-4 text-sm"><div className="flex items-start justify-between gap-2"><div><p className="font-mono text-xs text-accent">{text(row, "id")}</p><p className="mt-1 font-semibold">{text(row, "invoice_id")} · {text(row, "sale_type")}</p></div><span className="text-[10px] font-semibold uppercase text-muted">{text(row, "disposition")}</span></div><p className="mt-2 text-xs text-muted">Qty {text(row, "quantity")} · M{text(row, "plan_month")} · restored COGS {money(row.restored_cogs_inr)}</p><p className="mt-1 text-xs text-muted break-words">{text(row, "reason")}</p>{!text(row, "credit_note_id") ? <button type="button" disabled={busy} onClick={() => void issueCreditNote(row)} className="mt-3 text-xs font-semibold text-accent">Issue governed credit note</button> : <p className="mt-3 text-xs text-green">Credit {text(row, "credit_note_id")} · {money(row.credit_note_gross_inr)}</p>}</article>)}
          {!data.customerReturns.length ? <p className="text-sm text-muted">No customer returns / RMAs recorded.</p> : null}
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data.customerCreditNotes.map((row) => <article key={text(row, "id")} className="rounded-xl border border-border p-4 text-sm"><p className="font-mono text-xs text-accent">{text(row, "id")} · invoice {text(row, "invoice_id")}</p><p className="mt-2 text-muted">Credit {money(row.gross_amount_inr)} · refunded {money(row.refunded_inr)} · open {money(row.credit_open_inr)}</p>{number(row, "credit_open_inr")>0 ? <button type="button" disabled={busy} onClick={() => void refundCredit(row)} className="mt-3 text-xs font-semibold text-accent">Post customer refund</button> : null}</article>)}
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data.customerRefunds.map((row) => <article key={text(row, "id")} className="rounded-xl border border-border p-4 text-sm"><p className="font-mono text-xs text-accent">{text(row, "id")} · {text(row, "credit_note_id")}</p><p className="mt-2 text-muted">M{text(row, "plan_month")} · {money(row.amount_inr)} · {text(row, "status")}</p><p className="mt-1 text-xs text-muted break-words">{text(row, "evidence_reference")}</p>{text(row, "status")==="posted" ? <button type="button" disabled={busy} onClick={() => void reverseRefund(row)} className="mt-3 text-xs font-semibold text-warn">Reverse refund</button> : <p className="mt-3 text-xs text-muted">{text(row, "reversal_reason")}</p>}</article>)}
        </div>
      </Panel>

      <Panel title="Actual Sales Ledger" kicker="Bicycles and aftermarket separately classified">
        <div className="overflow-x-auto"><table className="min-w-[1380px] w-full text-left text-xs"><thead className="border-b border-border text-[10px] uppercase tracking-wider text-subtle"><tr><Th>Invoice</Th><Th>Date</Th><Th>Type</Th><Th>Customer</Th><Th>Item / identity</Th><Th>Qty</Th><Th>Taxable</Th><Th>GST</Th><Th>Gross</Th><Th>Credits</Th><Th>Collected</Th><Th>Refunded</Th><Th>Balance</Th><Th>Due</Th><Th>Status</Th></tr></thead><tbody>{data.ledger.map((row) => <tr key={text(row, "invoice_id")} className="border-b border-border/60 align-top"><Td><span className="font-mono text-accent">{text(row, "invoice_id")}</span></Td><Td>{text(row, "issued_on")}</Td><Td>{text(row, "sale_type") === "spare_component" ? "Spare / component" : "Bicycle"}<div className="text-muted">{text(row, "channel")}</div></Td><Td>{text(row, "customer_name")}<div className="text-muted">{text(row, "customer_gstin")}</div></Td><Td>{text(row, "item_reference")}<div className="text-muted">{text(row, "vyndi_identity") || "—"}</div><div className="text-muted">OEM {text(row, "oem_serial_number") || text(row, "oem_part_number") || "—"}</div></Td><Td>{text(row, "quantity")} {text(row, "unit_code")}</Td><Td>{money(row.taxable_value_inr)}</Td><Td>{money(row.gst_inr)}</Td><Td>{money(row.gross_amount_inr)}</Td><Td>{money(row.credit_note_gross_inr)}</Td><Td>{money(row.collected_inr)}</Td><Td>{money(row.refunded_inr)}</Td><Td>{money(row.balance_inr)}{row.refund_due_inr > 0 ? <div className="text-warn">Refund due {money(row.refund_due_inr)}</div> : null}</Td><Td>{text(row, "due_on") || "Legacy"}<div className="text-muted">{text(row, "aging_bucket")}</div></Td><Td>{text(row, "invoice_status")}<div className="text-muted">{text(row, "payment_status")}</div></Td></tr>)}{!data.ledger.length ? <tr><td colSpan={15} className="py-6 text-center text-muted">No actual invoiced sales yet.</td></tr> : null}</tbody></table></div>
      </Panel>

      <Panel title="Spare dispatch register" kicker="Inventory and FIFO lineage before invoice">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{data.spareSales.map((row) => <article key={text(row, "id")} className="rounded-xl border border-border p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-mono text-xs text-accent">{text(row, "id")}</p><p className="mt-1 font-semibold">{text(row, "sku")} · {text(row, "item_name")}</p></div><span className="text-[10px] font-semibold uppercase text-muted">{text(row, "status")}</span></div><dl className="mt-3 grid grid-cols-2 gap-2 text-xs text-muted"><Stat label="Quantity" value={`${text(row, "quantity")} ${text(row, "unit")}`} /><Stat label="Sale value" value={money(num(row, "quantity") * num(row, "unit_price_inr"))} /><Stat label="FIFO COGS" value={money(row.fifo_cost_inr)} /><Stat label="Invoice" value={text(row, "invoice_id") || "Pending"} /></dl>{text(row, "status") === "dispatched" && !text(row, "invoice_id") ? <button type="button" disabled={busy} onClick={() => void reverseDispatch(row)} className="mt-3 text-xs font-semibold text-warn">Reverse dispatch</button> : null}</article>)}{!data.spareSales.length ? <p className="text-sm text-muted">No spare/component dispatch has been posted.</p> : null}</div>
      </Panel>

      <div className="rounded-xl border border-green/30 bg-green/5 p-4 text-xs leading-5 text-muted"><p className="font-semibold text-green">Controlled accounting path</p><p className="mt-1">Spare dispatch: Master Inventory → FIFO COGS Dr 5000 / Cr 1200. Invoice: Dr 1100 Trade Receivable / Cr 4000 Product Revenue + Cr 2100 Output GST. Collection remains in Receivables: Dr 1000 Bank / Cr 1100 Trade Receivable → verified canonical cash → VIBPE. Spare quantities do not enter bicycle unit actuals.</p></div>
    </main>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="text-xs font-medium text-muted"><span>{label}</span>{children}</label>; }
function Stat({ label, value }: { label: string; value: string }) { return <div><dt className="text-[10px] uppercase tracking-wider text-subtle">{label}</dt><dd className="mt-1 break-words font-medium text-fg">{value}</dd></div>; }
function Th({ children }: { children: ReactNode }) { return <th className="px-2 py-2">{children}</th>; }
function Td({ children }: { children: ReactNode }) { return <td className="px-2 py-3">{children}</td>; }
