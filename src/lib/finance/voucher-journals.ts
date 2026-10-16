import type { JournalEntry } from "./general-ledger.ts";

/** Pure voucher-to-ledger projection. Posting and idempotency must be enforced by the DB-backed authority. */
export type VoucherKind = "receipt" | "payment" | "contra" | "journal" | "sales" | "purchase" | "credit_note" | "debit_note";
export type VoucherInput = {
  id: string;
  entryDate: string;
  reference: string;
  kind: VoucherKind;
  amountInr: number;
  debitAccountCode: string;
  creditAccountCode: string;
  memo?: string;
};
const kinds = new Set<VoucherKind>(["receipt","payment","contra","journal","sales","purchase","credit_note","debit_note"]);
const currencyAmount = (n: number) => Number.isFinite(n) && n > 0 && Math.abs(n * 100 - Math.round(n * 100)) <= 1e-6;
export function createVoucherJournal(input: VoucherInput): JournalEntry {
  if (!kinds.has(input.kind)) throw new Error("Unsupported voucher kind.");
  if (!input.id?.trim()) throw new Error("Voucher ID is required.");
  if (!input.reference?.trim()) throw new Error("Voucher source reference is required.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.entryDate) || Number.isNaN(Date.parse(input.entryDate + "T00:00:00Z"))) {
    throw new Error("Voucher entry date is invalid.");
  }
  if (!currencyAmount(input.amountInr)) throw new Error("Voucher amount must be positive finite INR in paise.");
  if (!input.debitAccountCode?.trim() || !input.creditAccountCode?.trim() || input.debitAccountCode === input.creditAccountCode) {
    throw new Error("Voucher must use two different nonempty accounts.");
  }
  return {
    id: input.id.trim(),
    entryDate: input.entryDate,
    sourceType: "voucher_" + input.kind,
    sourceId: input.reference.trim(),
    description: input.memo?.trim() || input.kind.replace("_"," ") + " voucher " + input.reference.trim(),
    status: "draft",
    lines: [
      { accountCode: input.debitAccountCode.trim(), debitInr: input.amountInr },
      { accountCode: input.creditAccountCode.trim(), creditInr: input.amountInr },
    ],
  };
}
