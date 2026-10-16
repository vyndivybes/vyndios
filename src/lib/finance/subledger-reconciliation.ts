import { validateJournal, type JournalEntry } from "./general-ledger.ts";
import { addPaise, calendarDay, inrToPaise } from "./receivables-aging.ts";

/** Diagnostic only. A match is not a close/approval authority or proof of source completeness.
 * Supply complete same-entity posted journals, including opening balances and reversal entries.
 */
export function reconcileSubledger(input: {
  asOfDate: string;
  kind: "receivable" | "payable";
  totalOutstandingInr: number;
  journals: readonly JournalEntry[];
}) {
  const cutoff = calendarDay(input.asOfDate);
  if (input.kind !== "receivable" && input.kind !== "payable") throw new Error("Unsupported subledger kind.");
  const accountCode = input.kind === "receivable" ? "1100" : "2000";
  const subledger = inrToPaise(input.totalOutstandingInr);
  const seen = new Set<string>();
  const journalIds: string[] = [];
  let balance = 0;
  for (const journal of input.journals) {
    if (!journal.id?.trim() || seen.has(journal.id)) throw new Error("Missing or duplicate journal ID.");
    seen.add(journal.id);
    const day = calendarDay(journal.entryDate);
    // Mirrors the canonical posted-only ledger. Reversals must be supplied as posted entries.
    if (journal.status !== "posted" || day > cutoff) continue;
    const validation = validateJournal(journal);
    if (!validation.valid) throw new Error("Invalid posted journal: " + validation.errors.join(" "));
    for (const line of journal.lines) {
      if (line.accountCode !== accountCode) continue;
      const debit = inrToPaise(line.debitInr ?? 0);
      const credit = inrToPaise(line.creditInr ?? 0);
      balance = addPaise(balance, input.kind === "receivable" ? debit - credit : credit - debit);
    }
    if (journal.lines.some(line => line.accountCode === accountCode)) journalIds.push(journal.id);
  }
  const difference = addPaise(balance, -subledger);
  return { asOfDate: input.asOfDate, accountCode, journalIds, ledgerBalanceInr: balance / 100,
    subledgerBalanceInr: subledger / 100, differenceInr: difference / 100, reconciled: difference === 0 };
}
