import { useState } from "react";
import type { FinancialStatementPack } from "@/lib/finance/financial-statements";
import { reconcilePostedStatementsWithTallyCsv } from "@/lib/finance/tally-ca-session";

type Comparison = ReturnType<typeof reconcilePostedStatementsWithTallyCsv>;
const MAX_CSV_BYTES = 2_000_000;

/** Works only on bytes loaded into this browser session. Never stores files or changes journals. */
export function TallyCaReconciliation({ pack }: { pack: FinancialStatementPack }) {
  const [mappingText, setMappingText] = useState("{}");
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState("");
  const [digest, setDigest] = useState("");
  const [confirmSource, setConfirmSource] = useState(false);
  const [result, setResult] = useState<Comparison | null>(null);
  const [error, setError] = useState("");

  async function selectFile(file?: File) {
    setCsv(""); setDigest(""); setFileName(""); setResult(null); setConfirmSource(false); setError("");
    if (!file) return;
    if (file.size === 0 || file.size > MAX_CSV_BYTES) {
      setError("Select a nonempty normalized CSV file no larger than 2 MB.");
      return;
    }
    try {
      const bytes = await file.arrayBuffer();
      if (!globalThis.crypto?.subtle) throw new Error("Secure content hashing is unavailable.");
      const hash = await globalThis.crypto.subtle.digest("SHA-256", bytes);
      const sha = Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      if (text.length > MAX_CSV_BYTES) throw new Error("CSV text exceeds the allowed size.");
      setCsv(text); setDigest(sha); setFileName(file.name);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not read the file.");
    }
  }

  function compare() {
    setResult(null); setError("");
    if (!confirmSource) {
      setError("Confirm the company, period, and leaf-ledger basis before comparison.");
      return;
    }
    try {
      const mapping: unknown = JSON.parse(mappingText);
      if (!mapping || typeof mapping !== "object" || Array.isArray(mapping) ||
          Object.values(mapping).some((value) => typeof value !== "string")) {
        throw new Error("Mapping must be a JSON object of Tally ledger name to VYNDI account code.");
      }
      const next = reconcilePostedStatementsWithTallyCsv({
        pack, tallyCsv: csv, mapping: mapping as Record<string, string>,
      });
      setResult(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Comparison could not be completed.");
    }
  }

  function exportReview() {
    if (!result || !digest) return;
    const payload = {
      reportType: "VYNDI_TALLY_RECONCILIATION_REVIEW_ONLY",
      generatedAt: new Date().toISOString(),
      fileName, fileSha256: digest,
      tallyCompanyAndPeriodUserDeclared: true,
      reconciled: result.status === "reconciled",
      ...result,
      caCertified: false,
      statutoryFilingValidated: false,
      reviewerApproval: "NOT_OBTAINED",
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type:"application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `VYNDI_Tally_Review_${pack.period.toDate}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="rounded-xl border border-border bg-surface p-5" aria-label="Tally trial balance reconciliation">
      <h2 className="text-xl font-semibold text-accent">Tally / CA reconciliation</h2>
      <p className="mt-2 text-sm text-muted">
        Compare this period’s <strong>posted VYNDI trial balance</strong> with a manually normalized
        Tally export. The file stays in this browser tab; no Tally server is contacted and
        no journal is changed. Matching arithmetic does not constitute a CA audit opinion.
      </p>
      <p className="mt-2 text-xs text-muted">
        Period: {pack.period.fromDate}–{pack.period.toDate} · Posted journals through date:
        {" "}{pack.evidence.throughDateJournalCount} · VYNDI accounts: {pack.trialBalance.length}
      </p>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div>
          <label className="block text-sm font-semibold" htmlFor="tally-csv-file">
            Normalized Tally CSV (Ledger,Debit,Credit)
          </label>
          <input id="tally-csv-file" className="mt-2 block w-full text-sm" type="file"
            accept=".csv,text/csv" onChange={(event) => void selectFile(event.currentTarget.files?.[0])} />
          <p className="mt-2 text-xs text-muted">
            Maximum 2 MB. Include individual ledgers, not Tally group totals.
            Validate the export’s company and accounting period before proceeding.
          </p>
          {digest ? <p className="mt-2 break-all text-xs text-muted">SHA-256: {digest}</p> : null}
        </div>
        <div>
          <label className="block text-sm font-semibold" htmlFor="tally-mapping">
            Explicit ledger mapping (JSON: Tally ledger name → VYNDI account code)
          </label>
          <textarea id="tally-mapping" rows={4} className="control mt-2 w-full font-mono text-xs"
            value={mappingText} spellCheck={false}
            onChange={(event) => {setMappingText(event.target.value);setResult(null);}} />
          <p className="mt-2 text-xs text-muted">
            No automatic name matching. This mapping is user-supplied and still requires independent review.
          </p>
        </div>
      </div>
      <details className="mt-3 rounded border border-border px-3 py-2">
        <summary className="cursor-pointer text-sm">VYNDI posted account codes for mapping</summary>
        <div className="mt-2 max-h-40 overflow-y-auto text-xs text-muted">
          {pack.trialBalance.map((row) => <p key={row.accountCode}>{row.accountCode} — {row.accountName}</p>)}
        </div>
      </details>
      <label className="mt-4 flex items-start gap-2 text-sm">
        <input type="checkbox" checked={confirmSource}
          onChange={(event) => {setConfirmSource(event.target.checked);setResult(null);}} />
        <span>I selected the correct Tally company, period and leaf-ledger export. This declaration is
          not independent verification.</span>
      </label>
      <div className="mt-4 flex flex-wrap gap-3">
        <button type="button" onClick={compare} disabled={!csv || !digest}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-bg disabled:opacity-50">
          Compare posted balances
        </button>
        <button type="button" onClick={exportReview} disabled={!result || !digest}
          className="rounded-lg border border-border px-4 py-2 text-sm font-semibold disabled:opacity-50">
          Export review report
        </button>
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
      {result && (
        <div className="mt-4 space-y-3" role="status">
          <p className={result.status === "reconciled" ? "font-semibold text-ok" : "font-semibold text-danger"}>
            {result.status === "reconciled" ? "Arithmetic matched — CA review still required" :
              "BLOCKED — discrepancies require review"}
          </p>
          <p className="text-xs text-muted">
            {result.tallyRows} mapped Tally ledgers · {result.diff.differences.length} unmatched/different accounts.
            Company, export completeness, source authenticity and statutory filing remain unverified.
          </p>
          {result.diff.differences.length > 0 && (
            <div className="max-h-64 overflow-auto rounded border border-border">
              <table className="w-full min-w-[560px] text-left text-xs">
                <thead><tr><th className="p-2">Code</th><th className="p-2">Ledger</th>
                  <th className="p-2">VYNDI (₹)</th><th className="p-2">Tally (₹)</th>
                  <th className="p-2">Exception</th></tr></thead>
                <tbody>{result.diff.differences.map((row) => (
                  <tr key={row.code} className="border-t border-border">
                    <td className="p-2">{row.code}</td><td className="p-2">{row.name}</td>
                    <td className="p-2">{row.vyndiBalanceInr ?? "—"}</td>
                    <td className="p-2">{row.tallyBalanceInr ?? "—"}</td>
                    <td className="p-2">{row.reason}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
