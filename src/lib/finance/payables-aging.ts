import { computeReceivableAging, type AgingInvoice, type AgingReceipt } from "./receivables-aging.ts";

/** Same bill-wise arithmetic for approved supplier invoices and posted payment allocations.
 * Callers must supply one entity's authorized snapshot. No payment or approval is performed.
 */
export function computePayableAging(input: {
  asOfDate: string;
  invoices: readonly AgingInvoice[];
  payments: readonly AgingReceipt[];
}) {
  return computeReceivableAging({ ...input, receipts: input.payments });
}
