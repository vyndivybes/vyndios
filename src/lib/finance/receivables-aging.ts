/** Read-only INR projection of posted bill allocations, scoped by the caller to one entity.
 * Does not approve, post, persist, reverse or certify completeness of source records.
 */
export type AgingInvoice = {
  id: string;
  partyId: string;
  issueDate: string;
  dueDate: string;
  amountInr: number;
};
export type AgingReceipt = { id: string; invoiceId: string; postedDate: string; amountInr: number };
export type AgingInput = { asOfDate: string; invoices: readonly AgingInvoice[]; receipts: readonly AgingReceipt[] };

export function calendarDay(value: string): number {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Invalid calendar date.");
  const time = Date.parse(value + "T00:00:00Z");
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) throw new Error("Invalid calendar date.");
  return time / 86_400_000;
}

export function inrToPaise(value: number): number {
  const paise = Math.round(value * 100);
  if (!Number.isFinite(value) || value < 0 || !Number.isSafeInteger(paise) || Math.abs(value * 100 - paise) > 1e-6) {
    throw new Error("Invalid amount: expected nonnegative finite INR in safe integer paise.");
  }
  return paise;
}

export function addPaise(left: number, right: number): number {
  const total = left + right;
  if (!Number.isSafeInteger(total)) throw new Error("Total amount exceeds safe integer paise.");
  return total;
}

function identity(value: string): void {
  if (typeof value !== "string" || !value.trim() || value !== value.trim()) throw new Error("Nonempty canonical ID required.");
}

export function computeReceivableAging(input: AgingInput) {
  const asOf = calendarDay(input.asOfDate);
  const invoices = new Map<string, { invoice: AgingInvoice; issued: number; due: number; amount: number }>();
  for (const invoice of input.invoices) {
    identity(invoice.id);
    identity(invoice.partyId);
    if (invoices.has(invoice.id)) throw new Error("Duplicate invoice ID.");
    const issued = calendarDay(invoice.issueDate);
    const due = calendarDay(invoice.dueDate);
    if (due < issued) throw new Error("Due date is before invoice issue date.");
    invoices.set(invoice.id, { invoice, issued, due, amount: inrToPaise(invoice.amountInr) });
  }
  const receiptIds = new Set<string>();
  const allocated = new Map<string, number>();
  const paidAsOf = new Map<string, number>();
  // Validate the entire supplied snapshot, including future rows, before projecting the cutoff.
  for (const receipt of input.receipts) {
    identity(receipt.id);
    identity(receipt.invoiceId);
    if (receiptIds.has(receipt.id)) throw new Error("Duplicate receipt allocation ID.");
    receiptIds.add(receipt.id);
    const source = invoices.get(receipt.invoiceId);
    if (!source) throw new Error("Unknown invoice for receipt.");
    const posted = calendarDay(receipt.postedDate);
    if (posted < source.issued) throw new Error("Receipt allocation is before invoice issue date.");
    const amount = inrToPaise(receipt.amountInr);
    if (amount === 0) throw new Error("Receipt amount must be positive.");
    const total = addPaise(allocated.get(receipt.invoiceId) ?? 0, amount);
    if (total > source.amount) throw new Error("Receipt allocation exceeds invoice amount.");
    allocated.set(receipt.invoiceId, total);
    if (posted <= asOf) paidAsOf.set(receipt.invoiceId, addPaise(paidAsOf.get(receipt.invoiceId) ?? 0, amount));
  }
  const buckets = { notDueInr: 0, overdue1To30Inr: 0, overdue31To60Inr: 0, overdue61To90Inr: 0, overdueOver90Inr: 0 };
  let total = 0;
  const lines = [];
  for (const { invoice, issued, due, amount } of invoices.values()) {
    if (issued > asOf) continue;
    const paid = paidAsOf.get(invoice.id) ?? 0;
    const outstanding = amount - paid;
    const daysOverdue = Math.max(0, asOf - due);
    const bucket = daysOverdue === 0 ? "notDueInr" : daysOverdue <= 30 ? "overdue1To30Inr" : daysOverdue <= 60 ? "overdue31To60Inr" : daysOverdue <= 90 ? "overdue61To90Inr" : "overdueOver90Inr";
    buckets[bucket] = addPaise(buckets[bucket], outstanding);
    total = addPaise(total, outstanding);
    lines.push({ ...invoice, paidInr: paid / 100, outstandingInr: outstanding / 100, daysOverdue, bucket });
  }
  for (const key of Object.keys(buckets) as (keyof typeof buckets)[]) buckets[key] /= 100;
  return { asOfDate: input.asOfDate, lines, buckets, totalOutstandingInr: total / 100 };
}
