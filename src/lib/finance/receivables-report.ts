import type { Sql } from "../db.ts";
import type { JournalEntry } from "./general-ledger.ts";
import { addPaise, calendarDay, computeReceivableAging, inrToPaise, type AgingInvoice } from "./receivables-aging.ts";
import { reconcileSubledger } from "./subledger-reconciliation.ts";

type Invoice = Omit<AgingInvoice, "dueDate"> & { dueDate: string | null; status: string; creditProfileStatus: string };
type Movement = { id: string; invoiceId: string; postedDate: string; amountInr: number; status: string };
export type ReceivablesSnapshot = { invoices: Invoice[]; collections: Movement[]; credits: Movement[]; refunds: Movement[]; journals: JournalEntry[] };
// No durable customer master ID exists on these invoices. partyId is the invoice's
// source reference, not an invented customer identity; reports remain bill-wise.
export const RECEIVABLES_SNAPSHOT_SQL = `select jsonb_build_object(
  'invoices',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,
    'partyId',coalesce(i.sales_order_id,i.spare_sale_id,i.id),'issueDate',coalesce((select entry_date from epr_finance_journals where source_type='sales_invoice' and source_id=i.id and status='posted'),i.issued_at::date)::text,
    'dueDate',i.due_on::text,'amountInr',case when i.gross_amount_inr>0 then i.gross_amount_inr else round(i.amount_lakh*100000,2) end,
    'status',i.status,'creditProfileStatus',i.credit_profile_status) order by i.id) from vyndi_invoices i),'[]'::jsonb),
  'collections',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'invoiceId',c.invoice_id,
    'postedDate',coalesce((select entry_date from epr_finance_journals where source_type='customer_receipt' and source_id=c.id and status='posted'),c.posted_at::date)::text,'amountInr',round(c.amount_lakh*100000,2),'status',c.status) order by c.id)
    from vyndi_collections c),'[]'::jsonb),
  'credits',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'invoiceId',c.invoice_id,
    'postedDate',c.credit_on::text,'amountInr',c.gross_amount_inr,'status',c.status) order by c.id)
    from vyndi_customer_credit_notes c),'[]'::jsonb),
  'refunds',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'invoiceId',c.invoice_id,
    'postedDate',r.refunded_on::text,'amountInr',r.amount_inr,'status',r.status) order by r.id)
    from vyndi_customer_refunds r join vyndi_customer_credit_notes c on c.id=r.credit_note_id),'[]'::jsonb),
  'journals',coalesce((select jsonb_agg(jsonb_build_object('id',j.id,'entryDate',j.entry_date::text,
    'sourceType',j.source_type,'sourceId',j.source_id,'description',j.description,'status',j.status,'reversedEntryId',j.reversed_entry_id,
    'lines',coalesce((select jsonb_agg(jsonb_build_object('accountCode',l.account_code,'debitInr',l.debit_inr,'creditInr',l.credit_inr)
      order by l.line_no) from epr_finance_journal_lines l where l.journal_id=j.id),'[]'::jsonb)) order by j.entry_date,j.id)
    from epr_finance_journals j where j.status='posted' and (j.source_type in
      ('sales_invoice','sales_invoice_reversal','customer_receipt','customer_receipt_reversal','customer_credit_note','customer_refund','customer_refund_reversal')
      or exists(select 1 from epr_finance_journal_lines l where l.journal_id=j.id and l.account_code='1100'))),'[]'::jsonb)
) as snapshot`;

const arPaise = (journal: JournalEntry) => journal.lines.filter(line => line.accountCode === "1100").reduce(
  (sum, line) => addPaise(sum, inrToPaise(line.debitInr ?? 0) - inrToPaise(line.creditInr ?? 0)), 0);

export function buildReceivablesAgingReport(snapshot: ReceivablesSnapshot, asOfDate: string) {
  const cutoff = calendarDay(asOfDate);
  const journals = snapshot.journals.filter(row => row.status === "posted");
  const sources = new Map<string, JournalEntry>();
  const reversals = new Map<string, JournalEntry[]>();
  for (const journal of journals) {
    const key = JSON.stringify([journal.sourceType, journal.sourceId]);
    if (sources.has(key)) throw new Error("Duplicate posted journal source.");
    sources.set(key, journal);
    if (journal.reversedEntryId) reversals.set(journal.reversedEntryId, [...reversals.get(journal.reversedEntryId) ?? [], journal]);
  }
  const find = (kind: string, id: string) => sources.get(JSON.stringify([kind, id]));
  const active = (journal: JournalEntry, status: string) => {
    const allReversals = reversals.get(journal.id) ?? [];
    if (["void", "reversed"].includes(status) && !allReversals.length) throw new Error("Missing reversal journal: " + journal.id);
    if (calendarDay(journal.entryDate) > cutoff) return false;
    const effective = allReversals.filter(row => calendarDay(row.entryDate) <= cutoff);
    if (effective.length > 1 || effective.some(row => calendarDay(row.entryDate) < calendarDay(journal.entryDate) || arPaise(row) !== -arPaise(journal))) {
      throw new Error("Invalid receivable reversal: " + journal.id);
    }
    return !effective.length;
  };
  const bills = new Map<string, { invoice: Invoice; gross: number; collected: number; credited: number; refunded: number }>();
  const sourceJournalIds: string[] = [];
  for (const invoice of snapshot.invoices) {
    if (bills.has(invoice.id)) throw new Error("Duplicate invoice ID.");
    const journal = find("sales_invoice", invoice.id);
    if (!journal) {
      if (calendarDay(invoice.issueDate) <= cutoff && invoice.status === "issued") throw new Error("Missing posted customer invoice journal: " + invoice.id);
      continue;
    }
    if (!active(journal, invoice.status)) continue;
    const gross = inrToPaise(invoice.amountInr);
    // Posted journal dates own accounting cutoffs, including timestamp-based sources.
    if (journal.entryDate !== invoice.issueDate || arPaise(journal) !== gross) throw new Error("Customer invoice source/ledger mismatch: " + invoice.id);
    bills.set(invoice.id, { invoice, gross, collected: 0, credited: 0, refunded: 0 });
    sourceJournalIds.push(journal.id);
  }
  for (const [rows, kind, field, sign] of [
    [snapshot.collections, "customer_receipt", "collected", -1],
    [snapshot.credits, "customer_credit_note", "credited", -1],
    [snapshot.refunds, "customer_refund", "refunded", 1],
  ] as const) {
    const seen = new Set<string>();
    for (const movement of rows) {
      if (seen.has(movement.id)) throw new Error("Duplicate movement ID.");
      seen.add(movement.id);
      const journal = find(kind, movement.id);
      if (!journal) {
        if (calendarDay(movement.postedDate) <= cutoff) throw new Error("Missing posted customer movement journal: " + movement.id);
        continue;
      }
      if (!active(journal, movement.status)) continue;
      const amount = inrToPaise(movement.amountInr);
      if (!amount || journal.entryDate !== movement.postedDate || arPaise(journal) !== sign * amount) throw new Error("Customer movement source/ledger mismatch: " + movement.id);
      const bill = bills.get(movement.invoiceId);
      if (!bill || calendarDay(movement.postedDate) < calendarDay(bill.invoice.issueDate)) throw new Error("Customer movement has no active earlier invoice: " + movement.id);
      bill[field] = addPaise(bill[field], amount);
      sourceJournalIds.push(journal.id);
    }
  }
  let outstanding = 0; let creditBalance = 0; let unagedTotal = 0;
  const unaged: { id: string; outstandingInr: number; reason: string }[] = [];
  const balances = [];
  const ageable: AgingInvoice[] = [];
  for (const bill of bills.values()) {
    const { invoice, gross, collected, credited, refunded } = bill;
    if (credited > gross || collected > gross || refunded > credited || refunded > collected) throw new Error("Customer allocations exceed evidenced invoice/collections: " + invoice.id);
    const net = addPaise(addPaise(gross, -collected), addPaise(-credited, refunded));
    const open = Math.max(0, net); const credit = Math.max(0, -net);
    outstanding = addPaise(outstanding, open); creditBalance = addPaise(creditBalance, credit);
    balances.push({ id: invoice.id, grossInr: gross / 100, collectedInr: collected / 100, creditedInr: credited / 100, refundedInr: refunded / 100, outstandingInr: open / 100, creditBalanceInr: credit / 100 });
    if (invoice.creditProfileStatus !== "controlled" || !invoice.dueDate) {
      unaged.push({ id: invoice.id, outstandingInr: open / 100, reason: "No evidenced credit terms/due date" });
      unagedTotal = addPaise(unagedTotal, open);
    } else {
      // Age the already reconciled open amount; this creates no synthetic payment allocation.
      ageable.push({ ...invoice, dueDate: invoice.dueDate, amountInr: open / 100 });
    }
  }
  const aging = computeReceivableAging({ asOfDate, invoices: ageable, receipts: [] });
  aging.lines = aging.lines.map(line => {
    const bill = bills.get(line.id)!;
    return { ...line, amountInr: bill.gross / 100, paidInr: (bill.gross - inrToPaise(line.outstandingInr)) / 100 };
  });
  const reconciliation = reconcileSubledger({ asOfDate, kind: "receivable", totalOutstandingInr: outstanding / 100,
    creditBalanceInr: creditBalance / 100, journals: snapshot.journals });
  return { entity: "Vāyú Shastr Private Limited", currency: "INR", aging, reconciliation, sourceJournalIds, diagnosticOnly: true as const,
    balances, unaged, unagedTotalInr: unagedTotal / 100, totalOutstandingInr: outstanding / 100, creditBalanceInr: creditBalance / 100,
    completeAging: unaged.length === 0 };
}

export async function loadReceivablesAgingReport(sql: Pick<Sql, "query">, asOfDate: string) {
  calendarDay(asOfDate);
  const rows = await sql.query<{ snapshot: ReceivablesSnapshot }>(RECEIVABLES_SNAPSHOT_SQL);
  if (rows.length !== 1 || !rows[0]?.snapshot) throw new Error("Receivables snapshot is unavailable.");
  return buildReceivablesAgingReport(rows[0].snapshot, asOfDate);
}
