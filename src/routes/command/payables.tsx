import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { ArrowRight, BadgeCheck, Banknote, FileSearch, RotateCcw } from "lucide-react";
import { useState } from "react";
import { Kpi, Panel } from "@/components/kpi";
import {
  approveSupplierInvoice,
  getPayablesData,
  postSupplierInvoice,
} from "@/lib/procure-to-pay-authority";
import {
  getSupplierPaymentHistory,
  postSupplierPaymentCash,
  reverseSupplierPaymentCash,
} from "@/lib/supplier-payment-cash-authority";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/command/payables")({
  loader: async () => {
    const [base, payments] = await Promise.all([getPayablesData(), getSupplierPaymentHistory()]);
    return { ...base, payments };
  },
  component: Payables,
});
const today = () => new Date().toISOString().slice(0, 10);
const number = (row: Record<string, unknown>, key: string) => Number(row[key] ?? 0);
const text = (row: Record<string, unknown>, key: string) => String(row[key] ?? "");
const money = (value: unknown) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(Number(value ?? 0));

function Payables() {
  const data = Route.useLoaderData();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [draft, setDraft] = useState({
    id: "",
    purchaseOrderId: "",
    invoiceNumber: "",
    invoiceOn: today(),
    quantityInvoiced: 1,
    amountExGstInr: 0,
    gstInr: 0,
    sourceReference: "",
  });
  const open = data.payables.filter(
    (row) => number(row, "amount_open_inr") > 0 && text(row, "status") !== "blocked",
  );
  const blocked = data.payables.filter((row) => text(row, "status") === "blocked").length;
  const dueValue = open.reduce((sum, row) => sum + number(row, "amount_open_inr"), 0);
  const matched = data.payables.filter((row) => text(row, "status") === "matched").length;

  function choosePo(id: string) {
    const po = data.purchaseOrders.find((row) => text(row, "id") === id);
    const quantity = po ? number(po, "quantity_accepted") : 1;
    setDraft({
      ...draft,
      purchaseOrderId: id,
      quantityInvoiced: quantity,
      amountExGstInr: po ? quantity * number(po, "unit_price_inr") : 0,
    });
  }

  async function run(task: () => Promise<unknown>, success: string) {
    setBusy(true);
    setMessage("");
    try {
      await task();
      setMessage(success);
      await router.invalidate();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Finance transaction could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    setBusy(true);
    setMessage("");
    try {
      const result = await postSupplierInvoice({ data: draft });
      setMessage(result.message);
      await router.invalidate();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Supplier invoice could not be recorded.");
    } finally {
      setBusy(false);
    }
  }

  async function approve(id: string) {
    await run(() => approveSupplierInvoice({ data: { id } }), `${id} approved for payment.`);
  }

  async function pay(row: Record<string, unknown>) {
    const amountRaw = window.prompt("Payment amount · INR", String(number(row, "amount_open_inr")));
    if (!amountRaw) return;
    const planMonthRaw = window.prompt("Canonical cash plan month · enter M1–M36 as a number", "1")?.trim();
    if (!planMonthRaw) return;
    const paymentPlanMonth = Number(planMonthRaw.replace(/^M/i, ""));
    if (!Number.isInteger(paymentPlanMonth) || paymentPlanMonth < 1 || paymentPlanMonth > 36) {
      setMessage("Payment cash plan month must be M1–M36. It is not inferred from the payment date.");
      return;
    }
    const sourceReference = window.prompt("Unique bank / UTR payment evidence reference")?.trim();
    if (!sourceReference) return;
    await run(
      () =>
        postSupplierPaymentCash({
          data: {
            id: `PAY-${crypto.randomUUID()}`,
            supplierInvoiceId: text(row, "id"),
            paymentPlanMonth,
            paidOn: today(),
            amountInr: Number(amountRaw),
            sourceReference,
          },
        }),
      `Payment posted against ${text(row, "id")} and reconciled to canonical cash.`,
    );
  }

  async function reversePayment(row: Record<string, unknown>) {
    const reason = window.prompt("Reversal evidence / reason")?.trim();
    if (!reason) return;
    await run(
      () => reverseSupplierPaymentCash({ data: { id: text(row, "id"), reversedOn: today(), reason } }),
      `${text(row, "id")} reversed through AP, Bank and canonical cash where applicable.`,
    );
  }

  return (
    <main className="mx-auto max-w-7xl space-y-6">
      <header className="flex flex-col gap-4 border-b border-border pb-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-green">Finance · procure to pay</p>
          <h1 className="mt-2 font-display text-4xl text-accent">Accounts Payable</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
            Supplier invoices pass a deterministic three-way match before approval. Evidenced payments now post Trade Payables → Bank 1000 → verified canonical cash/VIBPE in one transaction with an explicit M1–M36 cash month.
          </p>
        </div>
        <Link to="/command/purchase-execution" className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-semibold text-muted hover:border-accent hover:text-accent">
          Purchase orders <ArrowRight className="size-4" />
        </Link>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Open payable" value={money(dueValue)} hint={`${open.length} approved or matched invoices`} />
        <Kpi label="Awaiting approval" value={String(matched)} hint="Three-way match passed" tone={matched ? "warn" : "ok"} />
        <Kpi label="Blocked mismatch" value={String(blocked)} hint="Cannot be approved or paid" tone={blocked ? "danger" : "ok"} />
        <Kpi label="Payment register" value={String(data.payments.length)} hint="Controlled and legacy payment evidence" />
      </div>

      {message ? <div role="status" className="rounded-lg border border-border bg-surface px-4 py-3 text-sm text-muted">{message}</div> : null}

      <Panel title="Record supplier invoice" kicker="PO + accepted GRN + invoice">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Field label="Received purchase order">
            <select className="control mt-1.5" value={draft.purchaseOrderId} onChange={(e) => choosePo(e.target.value)}>
              <option value="">Select PO</option>
              {data.purchaseOrders.map((row) => (
                <option key={text(row, "id")} value={text(row, "id")}>{text(row, "id")} · {text(row, "supplier_name")} · accepted {number(row, "quantity_accepted")}</option>
              ))}
            </select>
          </Field>
          <Field label="Internal invoice ID"><input className="control mt-1.5 uppercase" value={draft.id} onChange={(e) => setDraft({ ...draft, id: e.target.value })} placeholder="AP-2026-001" /></Field>
          <Field label="Supplier invoice number"><input className="control mt-1.5" value={draft.invoiceNumber} onChange={(e) => setDraft({ ...draft, invoiceNumber: e.target.value })} /></Field>
          <Field label="Invoice date"><input className="control mt-1.5" type="date" value={draft.invoiceOn} onChange={(e) => setDraft({ ...draft, invoiceOn: e.target.value })} /></Field>
          <Field label="Quantity invoiced"><input className="control mt-1.5" type="number" min="0.01" step="0.01" value={draft.quantityInvoiced} onChange={(e) => setDraft({ ...draft, quantityInvoiced: Number(e.target.value) })} /></Field>
          <Field label="Amount before GST · INR"><input className="control mt-1.5" type="number" min="0" step="0.01" value={draft.amountExGstInr} onChange={(e) => setDraft({ ...draft, amountExGstInr: Number(e.target.value) })} /></Field>
          <Field label="GST · INR"><input className="control mt-1.5" type="number" min="0" step="0.01" value={draft.gstInr} onChange={(e) => setDraft({ ...draft, gstInr: Number(e.target.value) })} /></Field>
          <Field label="Invoice evidence"><input className="control mt-1.5" value={draft.sourceReference} onChange={(e) => setDraft({ ...draft, sourceReference: e.target.value })} placeholder="Invoice file / document ref" /></Field>
        </div>
        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
          <button type="button" disabled={busy || !draft.id || !draft.purchaseOrderId || !draft.invoiceNumber || !draft.sourceReference} onClick={() => void submit()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-bg disabled:opacity-40">
            <FileSearch className="size-4" />Run three-way match
          </button>
          <p className="text-xs leading-5 text-muted">A mismatch is saved as blocked evidence; it cannot be silently overridden.</p>
        </div>
      </Panel>

      <Panel title="Payable register" kicker="Matched → independently approved → controlled payment">
        {data.payables.length === 0 ? <div className="rounded-xl border border-dashed border-border p-6 text-sm text-muted">No supplier invoices have been recorded.</div> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1150px] text-sm">
              <thead className="border-b border-border text-[10px] uppercase tracking-wider text-subtle"><tr><th className="px-3 py-3 text-left">Invoice / supplier</th><th className="px-3 py-3 text-left">PO</th><th className="px-3 py-3 text-right">Invoice</th><th className="px-3 py-3 text-right">Paid</th><th className="px-3 py-3 text-right">Open</th><th className="px-3 py-3 text-left">Due</th><th className="px-3 py-3 text-left">Match</th><th className="px-3 py-3 text-left">Status</th><th className="px-3 py-3 text-left">Action</th></tr></thead>
              <tbody>{data.payables.map((row) => { const status = text(row, "status"); return (
                <tr key={text(row, "id")} className="border-t border-border/70">
                  <td className="px-3 py-3"><span className="font-mono text-xs">{text(row, "invoice_number")}</span><span className="block text-xs text-muted">{text(row, "supplier_name")}</span></td>
                  <td className="px-3 py-3 font-mono text-xs">{text(row, "purchase_order_id")}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{money(row.invoice_total_inr)}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{money(row.amount_paid_inr)}</td>
                  <td className="px-3 py-3 text-right font-semibold tabular-nums">{money(row.amount_open_inr)}</td>
                  <td className="px-3 py-3">{text(row, "due_on")}</td>
                  <td className="max-w-xs px-3 py-3 text-xs leading-5 text-muted">{text(row, "match_message")}</td>
                  <td className={cn("px-3 py-3 text-xs font-semibold uppercase", status === "blocked" ? "text-danger" : status === "paid" ? "text-ok" : "text-warn")}>{status.replaceAll("_", " ")}</td>
                  <td className="px-3 py-3">
                    {status === "matched" ? <button disabled={busy} onClick={() => void approve(text(row, "id"))} className="inline-flex min-h-11 items-center gap-2 text-xs font-semibold text-accent"><BadgeCheck className="size-4" />Approve</button> : null}
                    {["approved", "part_paid"].includes(status) ? <button disabled={busy} onClick={() => void pay(row)} className="inline-flex min-h-11 items-center gap-2 text-xs font-semibold text-accent"><Banknote className="size-4" />Post payment</button> : null}
                    {status === "blocked" ? <span className="text-xs text-danger">Resolve PO / GRN / invoice</span> : null}
                  </td>
                </tr>); })}</tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Supplier Payment Register" kicker="Bank evidence · explicit cash month · reversible audit trail">
        {data.payments.length === 0 ? <div className="rounded-xl border border-dashed border-border p-6 text-sm text-muted">No supplier payments recorded.</div> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1200px] text-sm">
              <thead className="border-b border-border text-[10px] uppercase tracking-wider text-subtle"><tr><th className="px-3 py-3 text-left">Payment</th><th className="px-3 py-3 text-left">Invoice / supplier</th><th className="px-3 py-3 text-left">Cash month</th><th className="px-3 py-3 text-right">Amount</th><th className="px-3 py-3 text-left">Bank evidence</th><th className="px-3 py-3 text-left">Journal / cash revision</th><th className="px-3 py-3 text-left">Status</th><th className="px-3 py-3 text-left">Action</th></tr></thead>
              <tbody>{data.payments.map((row) => (
                <tr key={text(row, "id")} className="border-t border-border/70">
                  <td className="px-3 py-3 font-mono text-xs">{text(row, "id")}<span className="block font-sans text-muted">{text(row, "paid_on")}</span></td>
                  <td className="px-3 py-3">{text(row, "invoice_number")}<span className="block text-xs text-muted">{text(row, "supplier_name")}</span></td>
                  <td className="px-3 py-3 font-semibold">{row.plan_month ? `M${String(row.plan_month)}` : "Legacy · not inferred"}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{money(row.amount_inr)}</td>
                  <td className="max-w-xs px-3 py-3 text-xs break-words">{text(row, "cash_evidence_reference") || text(row, "source_reference")}</td>
                  <td className="px-3 py-3 text-xs"><span className="font-mono">{text(row, "journal_id") || "Legacy"}</span><span className="block text-muted">{row.cash_actual_revision ? `Actual R${String(row.cash_actual_revision)} · cash ₹${Number(row.new_closing_cash_lakh ?? 0).toFixed(2)}L` : "No historical cash revision inferred"}</span></td>
                  <td className={cn("px-3 py-3 text-xs font-semibold uppercase", text(row, "status") === "reversed" ? "text-muted" : "text-ok")}>{text(row, "status")}</td>
                  <td className="px-3 py-3">{text(row, "status") === "posted" ? <button disabled={busy} onClick={() => void reversePayment(row)} className="inline-flex min-h-11 items-center gap-2 text-xs font-semibold text-accent"><RotateCcw className="size-4" />Reverse</button> : <span className="text-xs text-muted">{text(row, "reversal_reason")}</span>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs leading-5 text-muted">Payment plan month is explicit governance data and is never inferred from the calendar payment date. Legacy payments remain visible without manufactured M-number history.</p>
      </Panel>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="text-xs font-medium text-muted">{label}{children}</label>;
}
