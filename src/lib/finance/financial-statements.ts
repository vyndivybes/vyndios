import { CORE_CHART_OF_ACCOUNTS, type AccountType } from "./general-ledger.ts";

export type StatementLedgerLine = {
  journalId: string;
  entryDate: string;
  sourceType: string;
  sourceId: string;
  accountCode: string;
  debitInr: number;
  creditInr: number;
};

export type StatementJobCost = {
  jobCardId: string;
  model: string;
  plannedQuantity: number;
  completedQuantity: number;
  materialActualInr: number;
  materialStandardInr: number;
  materialVarianceInr: number;
  directLabourInr: number;
  outsourcingInr: number;
  manufacturingConsumablesInr: number;
  manufacturingDepreciationInr: number;
  supportDepreciationInr: number;
  overheadInr: number;
  scrapInr: number;
  reworkInr: number;
  totalActualCostInr: number;
  finishedGoodsValueInr: number;
  wipValueInr: number;
};

export type StatementAmountRow = {
  label: string;
  amountInr: number;
  note?: string;
  emphasis?: "subtotal" | "total";
};

export type StatementSection = {
  title: string;
  rows: StatementAmountRow[];
  resultLabel: string;
  resultInr: number;
  note?: string;
};

export type TrialBalanceStatementRow = {
  accountCode: string;
  accountName: string;
  accountType: AccountType;
  debitInr: number;
  creditInr: number;
  balanceInr: number;
};

export type FinancialStatementPack = {
  period: { fromDate: string; toDate: string };
  trading: {
    accrual: StatementSection;
    cash: StatementSection;
  };
  profitLoss: {
    accrual: StatementSection;
    cash: StatementSection;
  };
  costAccount: {
    rows: StatementAmountRow[];
    totalActualCostInr: number;
    finishedGoodsValueInr: number;
    wipValueInr: number;
    plannedQuantity: number;
    completedQuantity: number;
    weightedUnitCostInr: number;
    snapshotCount: number;
    reconciliationDifferenceInr: number;
  };
  balanceSheet: {
    assets: StatementAmountRow[];
    liabilities: StatementAmountRow[];
    equity: StatementAmountRow[];
    totalAssetsInr: number;
    totalLiabilitiesEquityInr: number;
    balanceDifferenceInr: number;
  };
  cashFlow: {
    rows: StatementAmountRow[];
    openingCashInr: number;
    closingCashInr: number;
    netChangeInCashInr: number;
    reconciliationDifferenceInr: number;
  };
  fundFlow: {
    sources: StatementAmountRow[];
    applications: StatementAmountRow[];
    totalSourcesInr: number;
    totalApplicationsInr: number;
    reconciliationDifferenceInr: number;
    openingWorkingCapitalInr: number;
    closingWorkingCapitalInr: number;
  };
  basisReconciliation: {
    accrualRevenueInr: number;
    cashCustomerReceiptsInr: number;
    revenueTimingDifferenceInr: number;
    accrualOperatingResultInr: number;
    cashOperatingResultInr: number;
    resultTimingDifferenceInr: number;
    closingReceivablesInr: number;
    closingPayablesInr: number;
  };
  trialBalance: TrialBalanceStatementRow[];
  evidence: {
    periodJournalCount: number;
    periodLineCount: number;
    throughDateJournalCount: number;
    latestEntryDate: string | null;
    jobCostSnapshotCount: number;
  };
};

const EPSILON = 0.01;
const EXPENSE_CODES = new Set(["5000", "5100", "5200", "6100", "6200", "6300", "6400", "6500", "6600"]);
const OPERATING_EXPENSE_CODES = ["5100", "5200", "6100", "6200", "6300", "6400", "6500", "6600"];
const CURRENT_ASSET_CODES = ["1000", "1100", "1200", "1210", "1220", "1300", "1400"];
const CURRENT_LIABILITY_CODES = ["2000", "2100", "2200"];

const round = (value: number) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const sum = (values: number[]) => round(values.reduce((total, value) => total + Number(value || 0), 0));
const isWithin = (date: string, fromDate: string, toDate: string) => date >= fromDate && date <= toDate;

function debitBalance(lines: StatementLedgerLine[], accountCode: string) {
  return round(lines
    .filter((line) => line.accountCode === accountCode)
    .reduce((total, line) => total + line.debitInr - line.creditInr, 0));
}

function creditBalance(lines: StatementLedgerLine[], accountCode: string) {
  return round(-debitBalance(lines, accountCode));
}

function debitMovement(lines: StatementLedgerLine[], accountCode: string) {
  return round(lines
    .filter((line) => line.accountCode === accountCode)
    .reduce((total, line) => total + line.debitInr - line.creditInr, 0));
}

function creditMovement(lines: StatementLedgerLine[], accountCode: string) {
  return round(-debitMovement(lines, accountCode));
}

function periodNetResult(lines: StatementLedgerLine[]) {
  const revenue = creditMovement(lines, "4000");
  const expenses = sum([...EXPENSE_CODES].map((code) => debitMovement(lines, code)));
  return round(revenue - expenses);
}

function currentWorkingCapital(lines: StatementLedgerLine[]) {
  const currentAssets = sum(CURRENT_ASSET_CODES.map((code) => debitBalance(lines, code)));
  const currentLiabilities = sum(CURRENT_LIABILITY_CODES.map((code) => creditBalance(lines, code)));
  return {
    currentAssets,
    currentLiabilities,
    workingCapital: round(currentAssets - currentLiabilities),
  };
}

function cashMovements(lines: StatementLedgerLine[]) {
  const groups = new Map<string, StatementLedgerLine[]>();
  for (const line of lines) {
    const existing = groups.get(line.journalId) ?? [];
    existing.push(line);
    groups.set(line.journalId, existing);
  }

  let operating = 0;
  let investing = 0;
  let financing = 0;
  let customerCash = 0;
  let supplierCashPaid = 0;
  let otherOperatingNetOutflow = 0;

  for (const journalLines of groups.values()) {
    const bankDelta = round(journalLines
      .filter((line) => line.accountCode === "1000")
      .reduce((total, line) => total + line.debitInr - line.creditInr, 0));
    if (Math.abs(bankDelta) <= EPSILON) continue;

    const sourceType = journalLines[0]?.sourceType.toLowerCase() ?? "";
    const accountCodes = new Set(journalLines.map((line) => line.accountCode));
    const isInvesting =
      accountCodes.has("1500") ||
      accountCodes.has("1590") ||
      /fixed[_ -]?asset|capex|capital[_ -]?asset/.test(sourceType);
    const isFinancing =
      accountCodes.has("2300") ||
      accountCodes.has("3000") ||
      /funding|equity|capital[_ -]?(receipt|contribution)|debt|loan/.test(sourceType);

    if (isInvesting) {
      investing = round(investing + bankDelta);
      continue;
    }
    if (isFinancing) {
      financing = round(financing + bankDelta);
      continue;
    }

    operating = round(operating + bankDelta);

    const customerMovement =
      accountCodes.has("1100") ||
      /customer[_ -]?(receipt|collection|refund)|collection/.test(sourceType);
    const administrativeMovement =
      /people|payroll|office|facility|professional|statutory|outsourcing|tax/.test(sourceType);
    const supplierMovement =
      !administrativeMovement &&
      (accountCodes.has("2000") ||
        accountCodes.has("1400") ||
        /supplier[_ -]?(payment|refund)/.test(sourceType));

    if (customerMovement) {
      customerCash = round(customerCash + bankDelta);
    } else if (supplierMovement) {
      supplierCashPaid = round(supplierCashPaid - bankDelta);
    } else {
      otherOperatingNetOutflow = round(otherOperatingNetOutflow - bankDelta);
    }
  }

  return {
    operating,
    investing,
    financing,
    customerCash,
    supplierCashPaid,
    otherOperatingNetOutflow,
    netChange: round(operating + investing + financing),
  };
}

function statementTrialBalance(lines: StatementLedgerLine[]): TrialBalanceStatementRow[] {
  return CORE_CHART_OF_ACCOUNTS.map((account) => {
    const debitInr = round(lines
      .filter((line) => line.accountCode === account.code)
      .reduce((total, line) => total + line.debitInr, 0));
    const creditInr = round(lines
      .filter((line) => line.accountCode === account.code)
      .reduce((total, line) => total + line.creditInr, 0));
    return {
      accountCode: account.code,
      accountName: account.name,
      accountType: account.type,
      debitInr,
      creditInr,
      balanceInr: round(debitInr - creditInr),
    };
  }).filter((row) => Math.abs(row.debitInr) > EPSILON || Math.abs(row.creditInr) > EPSILON);
}

export function buildFinancialStatements(input: {
  lines: StatementLedgerLine[];
  jobCosts: StatementJobCost[];
  fromDate: string;
  toDate: string;
}): FinancialStatementPack {
  const throughDateLines = input.lines.filter((line) => line.entryDate <= input.toDate);
  const openingLines = throughDateLines.filter((line) => line.entryDate < input.fromDate);
  const periodLines = throughDateLines.filter((line) => isWithin(line.entryDate, input.fromDate, input.toDate));

  const accrualRevenue = creditMovement(periodLines, "4000");
  const cogs = debitMovement(periodLines, "5000");
  const grossProfit = round(accrualRevenue - cogs);
  const operatingExpenses = OPERATING_EXPENSE_CODES.map((code) => ({
    code,
    amountInr: debitMovement(periodLines, code),
  }));
  const operatingExpenseTotal = sum(operatingExpenses.map((row) => row.amountInr));
  const accrualNetResult = round(grossProfit - operatingExpenseTotal);

  const accountName = new Map(CORE_CHART_OF_ACCOUNTS.map((account) => [account.code, account.name]));
  const pnlRows: StatementAmountRow[] = [
    { label: "Gross profit", amountInr: grossProfit, emphasis: "subtotal" },
    ...operatingExpenses
      .filter((row) => Math.abs(row.amountInr) > EPSILON)
      .map((row) => ({ label: accountName.get(row.code) ?? row.code, amountInr: -row.amountInr })),
  ];

  const cash = cashMovements(periodLines);
  const cashGrossMargin = round(cash.customerCash - cash.supplierCashPaid);
  const cashOperatingResult = round(cashGrossMargin - cash.otherOperatingNetOutflow);

  const materialActual = sum(input.jobCosts.map((row) => row.materialActualInr));
  const materialStandard = sum(input.jobCosts.map((row) => row.materialStandardInr));
  const materialVariance = sum(input.jobCosts.map((row) => row.materialVarianceInr));
  const directLabour = sum(input.jobCosts.map((row) => row.directLabourInr));
  const outsourcing = sum(input.jobCosts.map((row) => row.outsourcingInr));
  const manufacturingConsumables = sum(input.jobCosts.map((row) => row.manufacturingConsumablesInr));
  const manufacturingDepreciation = sum(input.jobCosts.map((row) => row.manufacturingDepreciationInr));
  const supportDepreciation = sum(input.jobCosts.map((row) => row.supportDepreciationInr));
  const overhead = sum(input.jobCosts.map((row) => row.overheadInr));
  const scrap = sum(input.jobCosts.map((row) => row.scrapInr));
  const rework = sum(input.jobCosts.map((row) => row.reworkInr));
  const recordedTotalActual = sum(input.jobCosts.map((row) => row.totalActualCostInr));
  const finishedGoodsValue = sum(input.jobCosts.map((row) => row.finishedGoodsValueInr));
  const wipValue = sum(input.jobCosts.map((row) => row.wipValueInr));
  const plannedQuantity = sum(input.jobCosts.map((row) => row.plannedQuantity));
  const completedQuantity = sum(input.jobCosts.map((row) => row.completedQuantity));
  const primeCost = round(materialActual + directLabour + outsourcing);
  const factoryOverhead = round(manufacturingConsumables + manufacturingDepreciation + overhead + scrap + rework);
  const worksCost = round(primeCost + factoryOverhead);
  const costOfProduction = round(worksCost + supportDepreciation);
  const weightedUnitCost = plannedQuantity > 0 ? round(recordedTotalActual / plannedQuantity) : 0;

  const currentAssets = CURRENT_ASSET_CODES.map((code) => ({
    label: accountName.get(code) ?? code,
    amountInr: debitBalance(throughDateLines, code),
  })).filter((row) => Math.abs(row.amountInr) > EPSILON);
  const fixedAssetsNet = round(debitBalance(throughDateLines, "1500") + debitBalance(throughDateLines, "1590"));
  const totalAssets = round(sum(currentAssets.map((row) => row.amountInr)) + fixedAssetsNet);

  const currentLiabilities = CURRENT_LIABILITY_CODES.map((code) => ({
    label: accountName.get(code) ?? code,
    amountInr: creditBalance(throughDateLines, code),
  })).filter((row) => Math.abs(row.amountInr) > EPSILON);
  const debt = creditBalance(throughDateLines, "2300");
  const totalLiabilities = round(sum(currentLiabilities.map((row) => row.amountInr)) + debt);
  const capital = creditBalance(throughDateLines, "3000");
  const retainedEarnings = creditBalance(throughDateLines, "3100");
  const currentUnclosedResult = periodNetResult(throughDateLines);
  const totalEquity = round(capital + retainedEarnings + currentUnclosedResult);
  const totalLiabilitiesEquity = round(totalLiabilities + totalEquity);

  const openingCash = debitBalance(openingLines, "1000");
  const closingCash = debitBalance(throughDateLines, "1000");

  const openingWorking = currentWorkingCapital(openingLines);
  const closingWorking = currentWorkingCapital(throughDateLines);
  const workingCapitalDelta = round(closingWorking.workingCapital - openingWorking.workingCapital);
  const openingFixedAssets = round(debitBalance(openingLines, "1500") + debitBalance(openingLines, "1590"));
  const closingFixedAssets = fixedAssetsNet;
  const fixedAssetDelta = round(closingFixedAssets - openingFixedAssets);
  const openingDebt = creditBalance(openingLines, "2300");
  const closingDebt = debt;
  const debtDelta = round(closingDebt - openingDebt);
  const openingCapital = creditBalance(openingLines, "3000");
  const closingCapital = capital;
  const capitalDelta = round(closingCapital - openingCapital);
  const depreciation = debitMovement(periodLines, "6500");
  const fundsFromOperations = round(accrualNetResult + depreciation);

  const fundSources: StatementAmountRow[] = [];
  const fundApplications: StatementAmountRow[] = [];
  const addSourceOrApplication = (label: string, value: number, positiveIsSource = true) => {
    const amount = round(Math.abs(value));
    if (amount <= EPSILON) return;
    const source = positiveIsSource ? value > 0 : value < 0;
    (source ? fundSources : fundApplications).push({ label, amountInr: amount });
  };
  addSourceOrApplication("Funds from operations", fundsFromOperations, true);
  addSourceOrApplication("Increase / (repayment) of long-term debt", debtDelta, true);
  addSourceOrApplication("Increase / (reduction) in capital", capitalDelta, true);
  addSourceOrApplication("Decrease / (increase) in net fixed assets", fixedAssetDelta, false);
  addSourceOrApplication("Decrease / (increase) in working capital", workingCapitalDelta, false);
  const totalSources = sum(fundSources.map((row) => row.amountInr));
  const totalApplications = sum(fundApplications.map((row) => row.amountInr));

  const periodJournalIds = new Set(periodLines.map((line) => line.journalId));
  const throughDateJournalIds = new Set(throughDateLines.map((line) => line.journalId));
  const latestEntryDate = throughDateLines.length
    ? [...throughDateLines].sort((a, b) => b.entryDate.localeCompare(a.entryDate))[0]?.entryDate ?? null
    : null;

  return {
    period: { fromDate: input.fromDate, toDate: input.toDate },
    trading: {
      accrual: {
        title: "Trading Account · Accrual Basis",
        rows: [
          { label: "Net sales / product revenue", amountInr: accrualRevenue },
          { label: "Less: Cost of goods sold", amountInr: -cogs },
        ],
        resultLabel: "Gross profit / (loss)",
        resultInr: grossProfit,
        note: "Derived from posted Revenue 4000 and COGS 5000 journal balances for the selected period.",
      },
      cash: {
        title: "Trading Account · Cash Basis",
        rows: [
          { label: "Cash received from customers", amountInr: cash.customerCash },
          { label: "Less: Cash paid to suppliers", amountInr: -cash.supplierCashPaid },
        ],
        resultLabel: "Gross cash trading margin",
        resultInr: cashGrossMargin,
        note: "Management cash-basis view. It recognizes customer and supplier cash movements when Bank 1000 changes; it is not a statutory accrual statement.",
      },
    },
    profitLoss: {
      accrual: {
        title: "Profit & Loss Account · Accrual Basis",
        rows: pnlRows,
        resultLabel: "Net profit / (loss)",
        resultInr: accrualNetResult,
        note: "Posted journal revenue and expense balances only. Reversals remain visible through their linked journals.",
      },
      cash: {
        title: "Profit & Loss Account · Cash Basis",
        rows: [
          { label: "Gross cash trading margin", amountInr: cashGrossMargin, emphasis: "subtotal" },
          { label: "Less: Other operating cash payments, net", amountInr: -cash.otherOperatingNetOutflow },
        ],
        resultLabel: "Cash-basis operating result",
        resultInr: cashOperatingResult,
        note: "Timing view for management reconciliation. Financing and investing cash movements are excluded from the operating result.",
      },
    },
    costAccount: {
      rows: [
        { label: "Direct material · actual", amountInr: materialActual, note: `Standard ₹${materialStandard.toFixed(2)} · variance ₹${materialVariance.toFixed(2)}` },
        { label: "Direct labour", amountInr: directLabour },
        { label: "Direct expenses / outsourcing", amountInr: outsourcing },
        { label: "Prime cost", amountInr: primeCost, emphasis: "subtotal" },
        { label: "Manufacturing consumables", amountInr: manufacturingConsumables },
        { label: "Manufacturing depreciation", amountInr: manufacturingDepreciation },
        { label: "Manufacturing overhead", amountInr: overhead },
        { label: "Scrap", amountInr: scrap },
        { label: "Rework", amountInr: rework },
        { label: "Works / factory cost", amountInr: worksCost, emphasis: "subtotal" },
        { label: "Support depreciation / production support", amountInr: supportDepreciation },
        { label: "Derived cost of production", amountInr: costOfProduction, emphasis: "total" },
      ],
      totalActualCostInr: recordedTotalActual,
      finishedGoodsValueInr: finishedGoodsValue,
      wipValueInr: wipValue,
      plannedQuantity,
      completedQuantity,
      weightedUnitCostInr: weightedUnitCost,
      snapshotCount: input.jobCosts.length,
      reconciliationDifferenceInr: round(recordedTotalActual - costOfProduction),
    },
    balanceSheet: {
      assets: [
        ...currentAssets,
        ...(Math.abs(fixedAssetsNet) > EPSILON ? [{ label: "Net fixed assets", amountInr: fixedAssetsNet }] : []),
      ],
      liabilities: [
        ...currentLiabilities,
        ...(Math.abs(debt) > EPSILON ? [{ label: "Debt", amountInr: debt }] : []),
      ],
      equity: [
        ...(Math.abs(capital) > EPSILON ? [{ label: "Equity / capital", amountInr: capital }] : []),
        ...(Math.abs(retainedEarnings) > EPSILON ? [{ label: "Retained earnings", amountInr: retainedEarnings }] : []),
        ...(Math.abs(currentUnclosedResult) > EPSILON ? [{ label: "Unclosed cumulative result", amountInr: currentUnclosedResult }] : []),
      ],
      totalAssetsInr: totalAssets,
      totalLiabilitiesEquityInr: totalLiabilitiesEquity,
      balanceDifferenceInr: round(totalAssets - totalLiabilitiesEquity),
    },
    cashFlow: {
      rows: [
        { label: "Operating activities", amountInr: cash.operating },
        { label: "Investing activities", amountInr: cash.investing },
        { label: "Financing activities", amountInr: cash.financing },
      ],
      openingCashInr: openingCash,
      closingCashInr: closingCash,
      netChangeInCashInr: cash.netChange,
      reconciliationDifferenceInr: round(closingCash - openingCash - cash.netChange),
    },
    fundFlow: {
      sources: fundSources,
      applications: fundApplications,
      totalSourcesInr: totalSources,
      totalApplicationsInr: totalApplications,
      reconciliationDifferenceInr: round(totalSources - totalApplications),
      openingWorkingCapitalInr: openingWorking.workingCapital,
      closingWorkingCapitalInr: closingWorking.workingCapital,
    },
    basisReconciliation: {
      accrualRevenueInr: accrualRevenue,
      cashCustomerReceiptsInr: cash.customerCash,
      revenueTimingDifferenceInr: round(accrualRevenue - cash.customerCash),
      accrualOperatingResultInr: accrualNetResult,
      cashOperatingResultInr: cashOperatingResult,
      resultTimingDifferenceInr: round(accrualNetResult - cashOperatingResult),
      closingReceivablesInr: debitBalance(throughDateLines, "1100"),
      closingPayablesInr: creditBalance(throughDateLines, "2000"),
    },
    trialBalance: statementTrialBalance(throughDateLines),
    evidence: {
      periodJournalCount: periodJournalIds.size,
      periodLineCount: periodLines.length,
      throughDateJournalCount: throughDateJournalIds.size,
      latestEntryDate,
      jobCostSnapshotCount: input.jobCosts.length,
    },
  };
}
