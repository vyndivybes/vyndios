export type AccountType = "asset" | "liability" | "equity" | "revenue" | "expense";

export type LedgerAccount = {
  code: string;
  name: string;
  type: AccountType;
};

export const CORE_CHART_OF_ACCOUNTS: LedgerAccount[] = [
  { code: "1000", name: "Bank", type: "asset" },
  { code: "1100", name: "Trade Receivables", type: "asset" },
  { code: "1200", name: "Raw Material Inventory", type: "asset" },
  { code: "1210", name: "Work in Progress", type: "asset" },
  { code: "1220", name: "Finished Goods", type: "asset" },
  { code: "1300", name: "Input GST / Tax Credit", type: "asset" },
  { code: "1400", name: "Supplier Recoverables / Advances", type: "asset" },
  { code: "1500", name: "Fixed Assets", type: "asset" },
  { code: "1590", name: "Accumulated Depreciation", type: "asset" },
  { code: "2000", name: "Trade Payables", type: "liability" },
  { code: "2100", name: "Output GST / Tax Payable", type: "liability" },
  { code: "2200", name: "Payroll / Statutory Payables", type: "liability" },
  { code: "2300", name: "Debt", type: "liability" },
  { code: "2400", name: "Founder / Director Current Account", type: "liability" },
  { code: "2450", name: "Third-Party Reimbursements Payable", type: "liability" },
  { code: "2460", name: "External Support Clearing", type: "liability" },
  { code: "3000", name: "Equity / Capital", type: "equity" },
  { code: "3100", name: "Retained Earnings", type: "equity" },
  { code: "4000", name: "Product Revenue", type: "revenue" },
  { code: "5000", name: "Cost of Goods Sold", type: "expense" },
  { code: "5100", name: "Direct Labour", type: "expense" },
  { code: "5200", name: "Manufacturing Overhead", type: "expense" },
  { code: "6100", name: "People / Payroll Expense", type: "expense" },
  { code: "6200", name: "Office / Facility Expense", type: "expense" },
  { code: "6250", name: "Travel / Business Development Expense", type: "expense" },
  { code: "6300", name: "Professional / Statutory Expense", type: "expense" },
  { code: "6400", name: "Outsourcing Expense", type: "expense" },
  { code: "6500", name: "Depreciation Expense", type: "expense" },
  { code: "6600", name: "Finance Cost", type: "expense" },
];

export type JournalLine = {
  accountCode: string;
  debitInr?: number;
  creditInr?: number;
  memo?: string;
};

export type JournalStatus = "draft" | "posted" | "reversed";

export type JournalEntry = {
  id: string;
  entryDate: string;
  sourceType: string;
  sourceId: string;
  description: string;
  status: JournalStatus;
  lines: JournalLine[];
  postedAt?: string;
  reversedEntryId?: string;
};

export type TrialBalanceRow = LedgerAccount & {
  debitInr: number;
  creditInr: number;
  balanceInr: number;
};

const amount = (value: number | undefined) => Math.max(0, Number(value ?? 0));
const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export function journalTotals(entry: Pick<JournalEntry, "lines">) {
  const debitInr = round(entry.lines.reduce((sum, line) => sum + amount(line.debitInr), 0));
  const creditInr = round(entry.lines.reduce((sum, line) => sum + amount(line.creditInr), 0));
  return { debitInr, creditInr, differenceInr: round(debitInr - creditInr) };
}

export function validateJournal(entry: Pick<JournalEntry, "lines">, chart: LedgerAccount[] = CORE_CHART_OF_ACCOUNTS) {
  const knownAccounts = new Set(chart.map((account) => account.code));
  const errors: string[] = [];
  if (entry.lines.length < 2) errors.push("A journal entry requires at least two lines.");
  for (const line of entry.lines) {
    if (!knownAccounts.has(line.accountCode)) errors.push(`Unknown account ${line.accountCode}.`);
    const debit = amount(line.debitInr);
    const credit = amount(line.creditInr);
    if ((debit > 0 && credit > 0) || (debit === 0 && credit === 0)) {
      errors.push(`Account ${line.accountCode} must contain either a debit or a credit amount.`);
    }
  }
  const totals = journalTotals(entry);
  if (Math.abs(totals.differenceInr) > 0.01) errors.push(`Journal is not balanced by ₹${Math.abs(totals.differenceInr).toFixed(2)}.`);
  return { valid: errors.length === 0, errors, ...totals };
}

export function postJournal(entry: JournalEntry, postedAt = new Date().toISOString()): JournalEntry {
  if (entry.status !== "draft") throw new Error(`Only draft journals can be posted; ${entry.id} is ${entry.status}.`);
  const validation = validateJournal(entry);
  if (!validation.valid) throw new Error(validation.errors.join(" "));
  return { ...entry, status: "posted", postedAt, lines: entry.lines.map((line) => ({ ...line })) };
}

export function reverseJournal(entry: JournalEntry, reversalId: string, entryDate: string): JournalEntry {
  if (entry.status !== "posted") throw new Error(`Only posted journals can be reversed; ${entry.id} is ${entry.status}.`);
  return {
    id: reversalId,
    entryDate,
    sourceType: "journal_reversal",
    sourceId: entry.id,
    description: `Reversal of ${entry.id}: ${entry.description}`,
    status: "draft",
    reversedEntryId: entry.id,
    lines: entry.lines.map((line) => ({
      accountCode: line.accountCode,
      debitInr: amount(line.creditInr),
      creditInr: amount(line.debitInr),
      memo: line.memo,
    })),
  };
}

export function buildTrialBalance(entries: JournalEntry[], chart: LedgerAccount[] = CORE_CHART_OF_ACCOUNTS): TrialBalanceRow[] {
  const posted = entries.filter((entry) => entry.status === "posted");
  return chart.map((account) => {
    let debitInr = 0;
    let creditInr = 0;
    for (const entry of posted) {
      for (const line of entry.lines) {
        if (line.accountCode !== account.code) continue;
        debitInr += amount(line.debitInr);
        creditInr += amount(line.creditInr);
      }
    }
    debitInr = round(debitInr);
    creditInr = round(creditInr);
    return { ...account, debitInr, creditInr, balanceInr: round(debitInr - creditInr) };
  });
}

export function supplierInvoiceJournal(input: {
  id: string;
  entryDate: string;
  supplierInvoiceId: string;
  inventoryOrExpenseAccountCode: string;
  taxableValueInr: number;
  inputGstInr: number;
}): JournalEntry {
  const taxable = amount(input.taxableValueInr);
  const gst = amount(input.inputGstInr);
  return {
    id: input.id,
    entryDate: input.entryDate,
    sourceType: "supplier_invoice",
    sourceId: input.supplierInvoiceId,
    description: `Supplier invoice ${input.supplierInvoiceId}`,
    status: "draft",
    lines: [
      { accountCode: input.inventoryOrExpenseAccountCode, debitInr: taxable },
      ...(gst > 0 ? [{ accountCode: "1300", debitInr: gst }] : []),
      { accountCode: "2000", creditInr: taxable + gst },
    ],
  };
}

export function materialIssueJournal(input: { id: string; entryDate: string; issueId: string; amountInr: number }): JournalEntry {
  const value = amount(input.amountInr);
  return {
    id: input.id,
    entryDate: input.entryDate,
    sourceType: "material_issue",
    sourceId: input.issueId,
    description: `Material issue ${input.issueId}`,
    status: "draft",
    lines: [
      { accountCode: "1210", debitInr: value },
      { accountCode: "1200", creditInr: value },
    ],
  };
}

export function productionCompletionJournal(input: { id: string; entryDate: string; jobCardId: string; finishedGoodsValueInr: number }): JournalEntry {
  const value = amount(input.finishedGoodsValueInr);
  return {
    id: input.id,
    entryDate: input.entryDate,
    sourceType: "production_completion",
    sourceId: input.jobCardId,
    description: `Production completion ${input.jobCardId}`,
    status: "draft",
    lines: [
      { accountCode: "1220", debitInr: value },
      { accountCode: "1210", creditInr: value },
    ],
  };
}

export function salesInvoiceJournal(input: {
  id: string;
  entryDate: string;
  invoiceId: string;
  taxableValueInr: number;
  outputGstInr: number;
}): JournalEntry {
  const taxable = amount(input.taxableValueInr);
  const gst = amount(input.outputGstInr);
  return {
    id: input.id,
    entryDate: input.entryDate,
    sourceType: "sales_invoice",
    sourceId: input.invoiceId,
    description: `Sales invoice ${input.invoiceId}`,
    status: "draft",
    lines: [
      { accountCode: "1100", debitInr: taxable + gst },
      { accountCode: "4000", creditInr: taxable },
      ...(gst > 0 ? [{ accountCode: "2100", creditInr: gst }] : []),
    ],
  };
}

export function cogsRecognitionJournal(input: { id: string; entryDate: string; dispatchId: string; costInr: number }): JournalEntry {
  const value = amount(input.costInr);
  return {
    id: input.id,
    entryDate: input.entryDate,
    sourceType: "dispatch_cogs",
    sourceId: input.dispatchId,
    description: `COGS recognition ${input.dispatchId}`,
    status: "draft",
    lines: [
      { accountCode: "5000", debitInr: value },
      { accountCode: "1220", creditInr: value },
    ],
  };
}

export function cashReceiptJournal(input: { id: string; entryDate: string; receiptId: string; amountInr: number }): JournalEntry {
  const value = amount(input.amountInr);
  return {
    id: input.id,
    entryDate: input.entryDate,
    sourceType: "customer_receipt",
    sourceId: input.receiptId,
    description: `Customer receipt ${input.receiptId}`,
    status: "draft",
    lines: [
      { accountCode: "1000", debitInr: value },
      { accountCode: "1100", creditInr: value },
    ],
  };
}

export function supplierPaymentJournal(input: { id: string; entryDate: string; paymentId: string; amountInr: number }): JournalEntry {
  const value = amount(input.amountInr);
  return {
    id: input.id,
    entryDate: input.entryDate,
    sourceType: "supplier_payment",
    sourceId: input.paymentId,
    description: `Supplier payment ${input.paymentId}`,
    status: "draft",
    lines: [
      { accountCode: "2000", debitInr: value },
      { accountCode: "1000", creditInr: value },
    ],
  };
}
