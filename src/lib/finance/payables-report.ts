import type { Sql } from "../db.ts";
import type { JournalEntry } from "./general-ledger.ts";
import { computePayableAging } from "./payables-aging.ts";
import { addPaise, calendarDay, inrToPaise, type AgingInvoice, type AgingReceipt } from "./receivables-aging.ts";
import { reconcileSubledger } from "./subledger-reconciliation.ts";

type Invoice = AgingInvoice & { status: string };
type Payment = AgingReceipt & { status: string };
type SupplierReturn = AgingReceipt;
export type PayablesSnapshot = {
  invoices: Invoice[];
  payments: Payment[];
  returns: SupplierReturn[];
  journals: JournalEntry[];
};

/** One statement supplies one PostgreSQL MVCC snapshot. No LIMIT or current-status
 * filter may silently discard historical payments or posted reversal entries.
 * This schema contains the single Vāyú Shastr company books; it has no tenant selector.
 */
export const PAYABLES_SNAPSHOT_SQL = `
select jsonb_build_object(
  'invoices', coalesce((select jsonb_agg(jsonb_build_object(
    'id',i.id,'partyId',p.supplier_id,'issueDate',i.invoice_on::text,
    'dueDate',i.due_on::text,'amountInr',i.amount_ex_gst_inr+i.gst_inr,'status',i.status
  ) order by i.invoice_on,i.id) from vyndi_supplier_invoices i
    join vyndi_purchase_orders p on p.id=i.purchase_order_id), '[]'::jsonb),
  'payments', coalesce((select jsonb_agg(jsonb_build_object(
    'id',p.id,'invoiceId',p.supplier_invoice_id,'postedDate',p.paid_on::text,
    'amountInr',p.amount_inr,'status',p.status
  ) order by p.paid_on,p.id) from vyndi_supplier_payments p), '[]'::jsonb),
  'returns', coalesce((select jsonb_agg(jsonb_build_object(
    'id',r.id,'invoiceId',r.supplier_invoice_id,'postedDate',r.returned_on::text,
    'amountInr',r.ap_offset_inr
  ) order by r.returned_on,r.id) from vyndi_supplier_returns r), '[]'::jsonb),
  'journals', coalesce((select jsonb_agg(jsonb_build_object(
    'id',j.id,'entryDate',j.entry_date::text,'sourceType',j.source_type,'sourceId',j.source_id,
    'description',j.description,'status',j.status,'reversedEntryId',j.reversed_entry_id,
    'lines',coalesce((select jsonb_agg(jsonb_build_object(
      'accountCode',l.account_code,'debitInr',l.debit_inr,'creditInr',l.credit_inr
    ) order by l.line_no) from epr_finance_journal_lines l where l.journal_id=j.id),'[]'::jsonb)
  ) order by j.entry_date,j.id) from epr_finance_journals j
  where j.status='posted' and (
    j.source_type in ('supplier_invoice','supplier_invoice_reversal','supplier_payment',
      'supplier_payment_reversal','supplier_return_debit_note')
    or exists(select 1 from epr_finance_journal_lines l where l.journal_id=j.id and l.account_code='2000')
  )), '[]'::jsonb)
) as snapshot`;

function payablePaise(journal: JournalEntry): number {
  return journal.lines.filter(line => line.accountCode === "2000").reduce(
    (sum, line) => addPaise(sum, inrToPaise(line.creditInr ?? 0) - inrToPaise(line.debitInr ?? 0)), 0);
}

/** Historical balances follow journal entry dates, including backdated postings.
 * Missing source evidence stops the report instead of fabricating dates or zero balances.
 */
export function buildPayablesAgingReport(snapshot: PayablesSnapshot, asOfDate: string) {
  const cutoff = calendarDay(asOfDate);
  const posted = snapshot.journals.filter(journal => journal.status === "posted");
  const originals = new Map<string, JournalEntry>();
  const reversalsByOriginal = new Map<string, JournalEntry[]>();
  for (const journal of posted) {
    const key = JSON.stringify([journal.sourceType, journal.sourceId]);
    if (originals.has(key)) throw new Error("Duplicate posted journal source.");
    originals.set(key, journal);
    if (journal.reversedEntryId) {
      const reversals = reversalsByOriginal.get(journal.reversedEntryId) ?? [];
      reversals.push(journal);
      reversalsByOriginal.set(journal.reversedEntryId, reversals);
    }
  }
  const find = (kind: string, id: string) => originals.get(JSON.stringify([kind, id]));
  const active = (journal: JournalEntry) => {
    if (calendarDay(journal.entryDate) > cutoff) return false;
    const reversals = (reversalsByOriginal.get(journal.id) ?? []).filter(row => calendarDay(row.entryDate) <= cutoff);
    if (reversals.length > 1) throw new Error("Multiple reversals for journal " + journal.id);
    if (reversals.length === 0) return true;
    const reversal = reversals[0];
    if (calendarDay(reversal.entryDate) < calendarDay(journal.entryDate)
      || payablePaise(reversal) !== -payablePaise(journal)) throw new Error("Invalid payable reversal for " + journal.id);
    return false;
  };
  const invoices: AgingInvoice[] = [];
  const payments: AgingReceipt[] = [];
  const sourceJournalIds: string[] = [];
  for (const invoice of snapshot.invoices) {
    const journal = find("supplier_invoice", invoice.id);
    if (!journal) {
      if (calendarDay(invoice.issueDate) <= cutoff && ["approved", "part_paid", "paid"].includes(invoice.status)) {
        throw new Error("Missing posted supplier invoice journal: " + invoice.id);
      }
      continue;
    }
    if (invoice.status === "void" && !reversalsByOriginal.has(journal.id)) {
      throw new Error("Missing supplier invoice reversal journal: " + invoice.id);
    }
    if (!active(journal)) continue;
    if (journal.entryDate !== invoice.issueDate || payablePaise(journal) !== inrToPaise(invoice.amountInr)) {
      throw new Error("Supplier invoice source/ledger mismatch: " + invoice.id);
    }
    invoices.push(invoice);
    sourceJournalIds.push(journal.id);
  }
  const addAllocations = (rows: readonly AgingReceipt[], kind: string) => {
    for (const row of rows) {
      const journal = find(kind, row.id);
      if (!journal) {
        if (calendarDay(row.postedDate) <= cutoff && inrToPaise(row.amountInr) > 0) {
          throw new Error("Missing posted allocation journal: " + kind + "/" + row.id);
        }
        continue;
      }
      if ("status" in row && row.status === "reversed" && !reversalsByOriginal.has(journal.id)) {
        throw new Error("Missing allocation reversal journal: " + kind + "/" + row.id);
      }
      if (!active(journal)) continue;
      if (journal.entryDate !== row.postedDate || payablePaise(journal) !== -inrToPaise(row.amountInr)) {
        throw new Error("Allocation source/ledger mismatch: " + kind + "/" + row.id);
      }
      sourceJournalIds.push(journal.id);
      if (row.amountInr > 0) payments.push({ ...row, id: JSON.stringify([kind, row.id]) });
    }
  };
  addAllocations(snapshot.payments, "supplier_payment");
  // Only the AP offset reduces this bill. The recoverable portion belongs to account 1400.
  addAllocations(snapshot.returns, "supplier_return_debit_note");
  const aging = computePayableAging({ asOfDate, invoices, payments });
  const reconciliation = reconcileSubledger({ asOfDate, kind: "payable",
    totalOutstandingInr: aging.totalOutstandingInr, journals: snapshot.journals });
  return { entity: "Vāyú Shastr Private Limited", currency: "INR", aging, reconciliation,
    sourceJournalIds, diagnosticOnly: true as const };
}

export async function loadPayablesAgingReport(sql: Pick<Sql, "query">, asOfDate: string) {
  calendarDay(asOfDate);
  const rows = await sql.query<{ snapshot: PayablesSnapshot }>(PAYABLES_SNAPSHOT_SQL);
  if (rows.length !== 1 || !rows[0]?.snapshot) throw new Error("Payables snapshot is unavailable.");
  return buildPayablesAgingReport(rows[0].snapshot, asOfDate);
}
