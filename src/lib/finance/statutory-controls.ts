export type GstLedgerLine = {
  id: string;
  period: string;
  direction: "input" | "output";
  taxableValueInr: number;
  gstInr: number;
  eligibleItc?: boolean;
  evidenceReference?: string;
};

export type GstPeriodSummary = {
  period: string;
  outputGstInr: number;
  eligibleInputGstInr: number;
  ineligibleInputGstInr: number;
  unverifiedInputGstInr: number;
  netGstPayableInr: number;
  missingEvidenceCount: number;
};

const positive = (value: number | null | undefined) => Math.max(0, Number(value ?? 0));
const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export function summarizeGstPeriod(lines: GstLedgerLine[], period: string): GstPeriodSummary {
  const periodLines = lines.filter((line) => line.period === period);
  const outputGstInr = periodLines
    .filter((line) => line.direction === "output")
    .reduce((sum, line) => sum + positive(line.gstInr), 0);
  const eligibleInputGstInr = periodLines
    .filter((line) => line.direction === "input" && line.eligibleItc === true)
    .reduce((sum, line) => sum + positive(line.gstInr), 0);
  const ineligibleInputGstInr = periodLines
    .filter((line) => line.direction === "input" && line.eligibleItc === false)
    .reduce((sum, line) => sum + positive(line.gstInr), 0);
  const unverifiedInputGstInr = periodLines
    .filter((line) => line.direction === "input" && line.eligibleItc === undefined)
    .reduce((sum, line) => sum + positive(line.gstInr), 0);
  return {
    period,
    outputGstInr: round(outputGstInr),
    eligibleInputGstInr: round(eligibleInputGstInr),
    ineligibleInputGstInr: round(ineligibleInputGstInr),
    unverifiedInputGstInr: round(unverifiedInputGstInr),
    netGstPayableInr: round(Math.max(0, outputGstInr - eligibleInputGstInr)),
    missingEvidenceCount: periodLines.filter((line) => !line.evidenceReference?.trim()).length,
  };
}

export type BankBookLine = {
  id: string;
  date: string;
  amountInr: number;
  reference?: string;
};

export type BankStatementLine = {
  id: string;
  date: string;
  amountInr: number;
  reference?: string;
};

export type BankReconciliationResult = {
  matched: Array<{ bookId: string; statementId: string }>;
  unmatchedBookIds: string[];
  unmatchedStatementIds: string[];
  bookTotalInr: number;
  statementTotalInr: number;
  differenceInr: number;
};

const normalizedRef = (value?: string) => value?.trim().toLowerCase() ?? "";

export function reconcileBank(book: BankBookLine[], statement: BankStatementLine[]): BankReconciliationResult {
  const used = new Set<string>();
  const matched: Array<{ bookId: string; statementId: string }> = [];

  for (const bookLine of book) {
    const ref = normalizedRef(bookLine.reference);
    const candidate = statement.find((statementLine) => {
      if (used.has(statementLine.id)) return false;
      if (round(statementLine.amountInr) !== round(bookLine.amountInr)) return false;
      const statementRef = normalizedRef(statementLine.reference);
      if (ref && statementRef) return ref === statementRef;
      return statementLine.date === bookLine.date;
    });
    if (!candidate) continue;
    used.add(candidate.id);
    matched.push({ bookId: bookLine.id, statementId: candidate.id });
  }

  const matchedBookIds = new Set(matched.map((item) => item.bookId));
  const bookTotalInr = round(book.reduce((sum, line) => sum + Number(line.amountInr ?? 0), 0));
  const statementTotalInr = round(statement.reduce((sum, line) => sum + Number(line.amountInr ?? 0), 0));
  return {
    matched,
    unmatchedBookIds: book.filter((line) => !matchedBookIds.has(line.id)).map((line) => line.id),
    unmatchedStatementIds: statement.filter((line) => !used.has(line.id)).map((line) => line.id),
    bookTotalInr,
    statementTotalInr,
    differenceInr: round(bookTotalInr - statementTotalInr),
  };
}

export type FixedAssetRecord = {
  assetId: string;
  description: string;
  capitalizationDate: string;
  acquisitionCostInr: number;
  usefulLifeMonths: number;
  accumulatedDepreciationInr: number;
  location?: string;
  custodian?: string;
  sourceReference?: string;
  status: "active" | "idle" | "disposed";
};

export function fixedAssetNetBookValue(asset: FixedAssetRecord) {
  return round(Math.max(0, positive(asset.acquisitionCostInr) - positive(asset.accumulatedDepreciationInr)));
}

export type PayrollControlRecord = {
  payrollId: string;
  period: string;
  grossPayInr: number;
  deductionsInr: number;
  employerCostInr: number;
  tdsOrStatutoryPayableInr: number;
  paymentReference?: string;
  returnEvidenceReference?: string;
};

export type StatutoryControlStatus = {
  id: "GST" | "BANK" | "ASSET" | "PAYROLL";
  ready: boolean;
  exceptions: string[];
};

export function evaluateStatutoryControls(input: {
  gst?: GstPeriodSummary;
  bank?: BankReconciliationResult;
  assets?: FixedAssetRecord[];
  payroll?: PayrollControlRecord[];
}): StatutoryControlStatus[] {
  const gstExceptions = !input.gst
    ? ["GST period summary not supplied."]
    : [
        ...(input.gst.missingEvidenceCount > 0 ? [`${input.gst.missingEvidenceCount} GST line(s) are missing evidence references.`] : []),
        ...(input.gst.unverifiedInputGstInr > 0 ? [`₹${input.gst.unverifiedInputGstInr.toFixed(2)} of input GST has not been explicitly approved as eligible ITC.`] : []),
      ];

  const bankExceptions = !input.bank
    ? ["Bank reconciliation not supplied."]
    : [
        ...(input.bank.unmatchedBookIds.length ? [`${input.bank.unmatchedBookIds.length} book transaction(s) unmatched.`] : []),
        ...(input.bank.unmatchedStatementIds.length ? [`${input.bank.unmatchedStatementIds.length} statement transaction(s) unmatched.`] : []),
        ...(Math.abs(input.bank.differenceInr) > 0.01 ? [`Bank reconciliation difference is ₹${Math.abs(input.bank.differenceInr).toFixed(2)}.`] : []),
      ];

  const assetExceptions = !input.assets
    ? ["Fixed-asset register not supplied."]
    : input.assets.filter((asset) => asset.status !== "disposed" && !asset.sourceReference?.trim()).map((asset) => `${asset.assetId} is missing capitalization evidence.`);

  const payrollExceptions = !input.payroll
    ? ["Payroll control ledger not supplied."]
    : input.payroll.flatMap((record) => [
        ...(!record.paymentReference?.trim() ? [`${record.payrollId} is missing payroll payment evidence.`] : []),
        ...(record.tdsOrStatutoryPayableInr > 0 && !record.returnEvidenceReference?.trim() ? [`${record.payrollId} is missing statutory/TDS return evidence.`] : []),
      ]);

  return [
    { id: "GST", ready: gstExceptions.length === 0, exceptions: gstExceptions },
    { id: "BANK", ready: bankExceptions.length === 0, exceptions: bankExceptions },
    { id: "ASSET", ready: assetExceptions.length === 0, exceptions: assetExceptions },
    { id: "PAYROLL", ready: payrollExceptions.length === 0, exceptions: payrollExceptions },
  ];
}
