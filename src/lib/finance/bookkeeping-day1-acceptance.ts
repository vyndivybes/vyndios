/**
 * First-use bookkeeping acceptance, deliberately independent of closing a period.
 *
 * Evidence entries are references to independently verified artifacts, NOT
 * self-attestation or a substitute for an external CA's professional judgment.
 * A new company with no activity can qualify the software before its first journal.
 */
export const DAY1_BOOKKEEPING_REQUIREMENTS = [
  { id: "ENTITY_TAX_APPLICABILITY_CONFIG", label: "Company, financial-year and tax applicability configuration" },
  { id: "AUTH_RBAC_CSRF", label: "Authenticated and authorized finance reads and writes; CSRF protections" },
  { id: "INDEPENDENT_HIGH_RISK_APPROVAL", label: "High-risk maker/checker enforced by server and database" },
  { id: "ACCRUAL_DOUBLE_ENTRY", label: "Accrual books and balanced double-entry account posting" },
  { id: "IMMUTABLE_POSTED_JOURNALS", label: "Posted journal protection, period locks and reversible correction" },
  { id: "NON_DISABLEABLE_TRANSACTION_AUDIT_TRAIL", label: "Non-disableable, dated audit trail for every books transaction and edit" },
  { id: "SOURCE_DOCUMENT_LINEAGE", label: "Vouchers and attachments linked to posted financial transactions" },
  { id: "BOOKS_RETENTION_AND_EXPORT", label: "Readable, exportable, retrievable books, vouchers and audit logs with retention" },
  { id: "DAILY_INDIA_BOOKS_BACKUP", label: "Daily backup of electronic books on servers physically located in India" },
  { id: "INDEPENDENT_RESTORE_DRILL", label: "Independent recovery drill for accounting books and audit trail" },
  { id: "GST_APPLICABILITY_AND_EVIDENCE", label: "GST applicability, invoice tax, credit control, reconciliation evidence and exports" },
  { id: "TDS_APPLICABILITY_AND_EVIDENCE", label: "TDS applicability and payroll/vendor deduction evidence workflow" },
  { id: "MANUFACTURING_INVENTORY_VALUATION", label: "Manufacturing inventory issues, WIP, finished-goods valuation and COGS" },
  { id: "AR_AP_BANK_WORKFLOWS", label: "Customer/vendor subledgers, receipts, payments and bank reconciliation" },
  { id: "TRIAL_BALANCE_AND_STATEMENTS", label: "Balanced trial balance, ledgers, P&L and balance sheet with CA exports" },
  { id: "SYNTHETIC_END_TO_END_FINANCE_JOURNEY", label: "Isolated synthetic procurement-to-dispatch, posting and bank journey" },
  { id: "BASELINE_RELEASE_AND_MIGRATION", label: "Exact deployed SHA, migrations, role privileges and rollback proven" },
  { id: "OPENING_BALANCE_PROCEDURE", label: "Controlled opening balances including a valid zero-opening new company" },
] as const;

export type Day1GateId = typeof DAY1_BOOKKEEPING_REQUIREMENTS[number]["id"];

export type Day1Evidence = {
  gate: Day1GateId;
  outcome: "pass" | "fail" | "unverified";
  evidenceRef: string;
  verifier: string;
  verifiedAt: string;
  baselineSha: string;
};

export type Day1Decision = {
  state: "QUALIFIED_FOR_DAY1_BOOKKEEPING" | "NOT_YET_QUALIFIED";
  baselineSha: string;
  passed: Day1GateId[];
  outstanding: Day1GateId[];
  findings: Array<{ gate: Day1GateId; passed: boolean; reason: string }>;
};

/** Deliberately exclude real period-close, bank-session and CA-pack records. */
export function evaluateBookkeepingDay1(
  baselineSha: string,
  evidence: readonly Day1Evidence[],
): Day1Decision {
  const validSha = /^[a-f0-9]{40}$/i.test(baselineSha);
  const counts = new Map<string, number>();
  for (const record of evidence) {
    counts.set(record.gate, (counts.get(record.gate) ?? 0) + 1);
  }
  const findings = DAY1_BOOKKEEPING_REQUIREMENTS.map(({ id }) => {
    const matched = evidence.find(record => record.gate === id);
    let reason = "";
    if (!validSha) reason = "Release baseline must be a full 40-character commit SHA.";
    else if (counts.get(id) !== 1 || !matched) reason = "Exactly one independently verified evidence record is required.";
    else if (matched.outcome !== "pass") reason = "Acceptance test has not passed.";
    else if (matched.baselineSha !== baselineSha) reason = "Evidence does not match the release SHA.";
    else if (!matched.evidenceRef?.trim()) reason = "Verifiable evidence reference is absent.";
    else if (!matched.verifier?.trim()) reason = "Verifying actor is absent.";
    else if (!matched.verifiedAt || !Number.isFinite(Date.parse(matched.verifiedAt))) reason = "Verification timestamp is invalid.";
    return { gate: id, passed: reason === "", reason };
  });
  return {
    state: findings.every(row => row.passed) ? "QUALIFIED_FOR_DAY1_BOOKKEEPING" : "NOT_YET_QUALIFIED",
    baselineSha,
    passed: findings.filter(row => row.passed).map(row => row.gate),
    outstanding: findings.filter(row => !row.passed).map(row => row.gate),
    findings,
  };
}
