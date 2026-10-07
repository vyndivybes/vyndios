import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { runProductionTransactionalUat } from "@/lib/production-uat-authority";

export const Route = createFileRoute("/command/uat-certification")({
  component: UatCertification,
});

function UatCertification() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Awaited<ReturnType<typeof runProductionTransactionalUat>> | null>(null);

  async function run() {
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const next = await runProductionTransactionalUat({ data: { confirmation: "RUN_ROLLBACK_UAT" } });
      setResult(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Transactional UAT failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6">
      <section className="rounded-2xl border border-slate-300 bg-white p-6 shadow-sm">
        <p className="text-xs font-bold uppercase tracking-wide text-orange-600">Admin certification · rollback-only</p>
        <h1 className="mt-2 text-3xl font-semibold">Production Transactional UAT</h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
          Runs real Funding, People & Office, Inventory and Quality authority mutations inside one serializable PostgreSQL transaction.
          The transaction is forcibly rolled back and a second connection must prove that zero UAT fixture rows remain.
        </p>
        <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
          This route is admin-only and hidden from normal navigation. It never commits certification fixtures.
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => void run()}
          className="mt-5 rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? "Running rollback UAT…" : "Run rollback UAT"}
        </button>
      </section>

      {error ? <div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-800">{error}</div> : null}

      {result ? (
        <section className="rounded-2xl border border-emerald-300 bg-emerald-50 p-6">
          <p className="text-lg font-bold text-emerald-900">PASS · ROLLED BACK</p>
          <p className="mt-2 font-mono text-xs text-emerald-900">{result.runId}</p>
          <p className="mt-2 text-sm text-emerald-900">Remaining fixture rows: {result.remainingFixtureCount}</p>
          <pre data-testid="uat-result" className="mt-4 max-h-[520px] overflow-auto rounded-xl bg-slate-950 p-4 text-xs leading-5 text-slate-100">
            {JSON.stringify(result, null, 2)}
          </pre>
        </section>
      ) : null}
    </main>
  );
}
