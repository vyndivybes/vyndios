/** Read-only, fail-closed trial-balance comparison for CA review.
 * Tally rows must already have been mapped to canonical account codes by a
 * human-approved chart-of-accounts mapping. No external system is mutated.
 */
export type TrialBalanceInputRow = {
  code: string;
  name: string;
  debitInr: number;
  creditInr: number;
};
export type TrialBalanceDifference = {
  code: string;
  name: string;
  vyndiBalanceInr: number | null;
  tallyBalanceInr: number | null;
  differenceInr: number | null;
  reason: "missing_in_tally" | "missing_in_vyndi" | "balance_mismatch";
};
type Normalized = { code: string; name: string; balancePaise: number; debitPaise: number; creditPaise: number };
function paise(amount: number): number {
  if (!Number.isFinite(amount) || amount < 0 || !Number.isSafeInteger(Math.round(amount * 100)) ||
      Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-6) {
    throw new Error("Invalid monetary value: require finite nonnegative INR with at most two decimals");
  }
  return Math.round(amount * 100);
}
function normalize(rows: TrialBalanceInputRow[], source: string): Map<string, Normalized> {
  const out = new Map<string, Normalized>();
  for (const row of rows) {
    const code = row.code?.trim();
    if (!code || !row.name?.trim()) throw new Error("Invalid account identifier/name");
    if (out.has(code)) throw new Error(`Duplicate account code in ${source}: ${code}`);
    const debitPaise = paise(row.debitInr);
    const creditPaise = paise(row.creditInr);
    out.set(code, { code, name: row.name.trim(), debitPaise, creditPaise, balancePaise: debitPaise - creditPaise });
  }
  return out;
}
export function reconcileTallyTrialBalance(vyndiRows: TrialBalanceInputRow[], tallyRows: TrialBalanceInputRow[]) {
  const v = normalize(vyndiRows, "VYNDI");
  const t = normalize(tallyRows, "Tally");
  const vyndiNetPaise = [...v.values()].reduce((sum, row) => sum + row.balancePaise, 0);
  const tallyNetPaise = [...t.values()].reduce((sum, row) => sum + row.balancePaise, 0);
  const differences: TrialBalanceDifference[] = [];
  for (const code of new Set([...v.keys(), ...t.keys()])) {
    const a = v.get(code), b = t.get(code);
    if (a && b && a.balancePaise === b.balancePaise) continue;
    differences.push({
      code,
      name: a?.name ?? b!.name,
      vyndiBalanceInr: a ? a.balancePaise / 100 : null,
      tallyBalanceInr: b ? b.balancePaise / 100 : null,
      differenceInr: a && b ? (a.balancePaise - b.balancePaise) / 100 : null,
      reason: !a ? "missing_in_vyndi" : !b ? "missing_in_tally" : "balance_mismatch",
    });
  }
  differences.sort((a, b) => a.code.localeCompare(b.code));
  const vyndiBalanced = vyndiNetPaise === 0, tallyBalanced = tallyNetPaise === 0;
  return {
    status: vyndiBalanced && tallyBalanced && differences.length === 0 ? "reconciled" as const : "blocked" as const,
    vyndiBalanced,
    tallyBalanced,
    vyndiNetInr: vyndiNetPaise / 100,
    tallyNetInr: tallyNetPaise / 100,
    differences,
    // Never implies CA certification or statutory acceptance.
    caCertified: false as const,
  };
}
