import type { FinancialStatementPack } from './financial-statements.ts';
import { importTallyTrialBalanceCsv } from './tally-import.mjs';
import { reconcileTallyTrialBalance } from './tally-reconciliation.ts';

type PostedPack = Pick<FinancialStatementPack, 'period' | 'trialBalance' | 'evidence'>;

function isDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value + 'T00:00:00Z')) &&
    new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
}

/** Compare authoritative posted-ledger statements with manually normalized,
 * explicitly mapped Tally data. No Tally network connection or writeback.
 * "reconciled" is arithmetic only, never a CA approval or statutory declaration.
 */
export function reconcilePostedStatementsWithTallyCsv(input: {
  pack: PostedPack;
  tallyCsv: string;
  mapping: Record<string, string>;
}) {
  const { pack, tallyCsv, mapping } = input;
  if (!pack || !pack.period || !isDate(pack.period.fromDate) ||
      !isDate(pack.period.toDate) || pack.period.fromDate > pack.period.toDate ||
      Date.parse(pack.period.toDate) - Date.parse(pack.period.fromDate) > 366 * 86400000) {
    throw new Error('Invalid accounting period');
  }
  if (!Array.isArray(pack.trialBalance) || pack.trialBalance.length === 0 ||
      !pack.evidence || !Number.isSafeInteger(pack.evidence.throughDateJournalCount) ||
      pack.evidence.throughDateJournalCount < 1) {
    throw new Error('Empty or unavailable posted accounting actuals');
  }
  const posted = pack.trialBalance.map((r) => {
    if (!r.accountCode || !r.accountName || ![r.debitInr,r.creditInr,r.balanceInr].every(Number.isFinite) ||
        Math.abs(r.debitInr - r.creditInr - r.balanceInr) > 0.011) {
      throw new Error('Posted trial balance inconsistent with balance');
    }
    return {code: r.accountCode, name: r.accountName, debitInr:r.debitInr, creditInr:r.creditInr};
  });
  const acceptedCodes = new Set(posted.map((row) => row.code));
  if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping) ||
      Object.values(mapping).some((code) => !acceptedCodes.has(code))) {
    throw new Error('Unknown mapped VYNDI account code');
  }
  const tally = importTallyTrialBalanceCsv(tallyCsv, mapping);
  const diff = reconcileTallyTrialBalance(posted, tally.rows);
  return {
    status: diff.status,
    source: 'POSTED_GENERAL_LEDGER' as const,
    period: {...pack.period},
    postedJournalCount: pack.evidence.throughDateJournalCount,
    tallyRows: tally.rows.length,
    diff,
    caCertified:false as const,
    sourceCompletenessVerified:false as const,
    tallyExportProvenanceVerified:false as const,
  };
}
