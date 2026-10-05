import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { CheckCircle2, ClipboardCheck, LockKeyhole, PackageSearch, TriangleAlert } from "lucide-react";
import {
  approveInventoryStocktake,
  getInventoryStocktakeControl,
  postInventoryStocktake,
  recordInventoryStocktakeCount,
  startInventoryStocktake,
  submitInventoryStocktake,
} from "@/lib/inventory-stocktake-authority";
import { canPerform } from "@/lib/page-access";
import { getRouteMeta } from "@/lib/page-metadata";

export const Route = createFileRoute("/command/inventory-stocktake")({
  loader: async ({ context }) => {
    const control = await getInventoryStocktakeControl();
    return { ...control, role: context.commandRole };
  },
  component: InventoryStocktake,
});

type Row = Record<string, unknown>;
const text = (value: unknown) => String(value ?? "");
const num = (value: unknown) => Number(value ?? 0);
const today = () => new Date().toISOString().slice(0, 10);
const month = () => today().slice(0, 7);
const money = (value: unknown) => `₹${num(value).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

function LineEditor({ row, onSaved }: { row: Row; onSaved: () => Promise<void> }) {
  const [counted, setCounted] = useState(row.counted_quantity == null ? "" : text(row.counted_quantity));
  const [unitCost, setUnitCost] = useState(row.counted_unit_cost_inr == null ? "" : text(row.counted_unit_cost_inr));
  const [countRef, setCountRef] = useState(text(row.count_reference));
  const [evidenceRef, setEvidenceRef] = useState(text(row.evidence_reference));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function save() {
    setMessage("");
    if (counted === "" || !countRef.trim() || !evidenceRef.trim()) {
      setMessage("Count, count reference and evidence reference are required.");
      return;
    }
    setBusy(true);
    try {
      await recordInventoryStocktakeCount({
        data: {
          stocktakeId: text(row.stocktake_id),
          sku: text(row.sku),
          unit: text(row.unit),
          countedQuantity: Number(counted),
          countedUnitCostInr: unitCost === "" ? undefined : Number(unitCost),
          countReference: countRef,
          evidenceReference: evidenceRef,
        },
      });
      setMessage("Count recorded.");
      await onSaved();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Count could not be recorded.");
    } finally {
      setBusy(false);
    }
  }

  const expected = num(row.expected_quantity);
  const current = counted === "" ? null : Number(counted);
  const variance = current == null || !Number.isFinite(current) ? null : current - expected;
  return (
    <tr className="border-b border-border/60 align-top">
      <td className="px-3 py-3">
        <div className="font-semibold text-fg">{text(row.sku)}</div>
        <div className="mt-1 text-[11px] text-subtle">{text(row.unit)}</div>
      </td>
      <td className="px-3 py-3 text-right tabular-nums">{expected.toLocaleString()}</td>
      <td className="px-3 py-3">
        <input className="control min-w-28 text-right" type="number" min="0" step="0.0001" value={counted}
          onChange={(event) => setCounted(event.target.value)} placeholder="Physical" />
      </td>
      <td className="px-3 py-3 text-right tabular-nums">
        <span className={variance === null ? "text-subtle" : variance === 0 ? "text-green" : "text-warn"}>
          {variance === null ? "—" : variance.toLocaleString()}
        </span>
      </td>
      <td className="px-3 py-3">
        <div className="text-xs text-muted">Book {money(row.book_unit_cost_inr)}</div>
        <input className="control mt-1 min-w-32 text-right" type="number" min="0" step="0.01" value={unitCost}
          onChange={(event) => setUnitCost(event.target.value)}
          placeholder="Cost if found stock" />
      </td>
      <td className="px-3 py-3">
        <input className="control min-w-36" value={countRef} onChange={(event) => setCountRef(event.target.value)}
          placeholder="Count sheet / bin" />
        <input className="control mt-1 min-w-36" value={evidenceRef} onChange={(event) => setEvidenceRef(event.target.value)}
          placeholder="Photo / evidence ref" />
        {message ? <p className="mt-1 text-[11px] text-muted">{message}</p> : null}
      </td>
      <td className="px-3 py-3">
        <button type="button" disabled={busy} onClick={save}
          className="rounded-lg border border-border px-3 py-2 text-xs font-semibold hover:border-accent disabled:opacity-50">
          {busy ? "Saving…" : "Save count"}
        </button>
      </td>
    </tr>
  );
}

function InventoryStocktake() {
  const data = Route.useLoaderData();
  const router = useRouter();
  const page = getRouteMeta("/command/inventory");
  const editable = canPerform(data.role, "edit", page);
  const approvable = canPerform(data.role, "approve", page);
  const sessions = data.sessions as Row[];
  const lines = data.lines as Row[];
  const latest = sessions[0];
  const [period, setPeriod] = useState(month());
  const [effectiveOn, setEffectiveOn] = useState(today());
  const [scopeReference, setScopeReference] = useState("FULL-AUTHORITATIVE-INVENTORY");
  const [evidenceReference, setEvidenceReference] = useState("");
  const [actionEvidence, setActionEvidence] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const counted = useMemo(() => lines.filter((line) => line.counted_quantity != null).length, [lines]);
  const varianceLines = useMemo(
    () => lines.filter((line) => line.counted_quantity != null && Math.abs(num(line.variance_quantity)) > 0.0001).length,
    [lines],
  );

  async function refresh() {
    await router.invalidate();
  }

  async function run(action: "start" | "submit" | "approve" | "post") {
    setMessage("");
    setBusy(true);
    try {
      if (action === "start") {
        const result = await startInventoryStocktake({ data: { period, effectiveOn, scopeReference, evidenceReference } });
        setMessage(`Stocktake started with ${num(result?.line_count)} controlled line(s).`);
      } else if (!latest) {
        throw new Error("No stocktake session is available.");
      } else if (action === "submit") {
        await submitInventoryStocktake({ data: { stocktakeId: text(latest.id), evidenceReference: actionEvidence } });
        setMessage("Stocktake submitted. Physical counts are now locked.");
      } else if (action === "approve") {
        await approveInventoryStocktake({ data: { stocktakeId: text(latest.id), evidenceReference: actionEvidence } });
        setMessage("Independent approval recorded.");
      } else {
        const result = await postInventoryStocktake({ data: { stocktakeId: text(latest.id), evidenceReference: actionEvidence } });
        setMessage(`Posted. Variance lines ${num(result?.variance_line_count)} · gain ${money(result?.gain_value_inr)} · loss ${money(result?.loss_value_inr)}.`);
      }
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Stocktake action failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-7xl space-y-6">
      <header className="border-b border-border pb-6">
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-green">Operate · controlled physical inventory</p>
        <h1 className="mt-2 font-display text-4xl text-accent">Inventory Stocktake</h1>
        <p className="mt-2 max-w-4xl text-sm leading-6 text-muted">
          Freeze the count window, snapshot the authoritative ledger, record physical evidence, submit, obtain independent maker/checker approval,
          then post any variance through the same FIFO, cost-ledger and finance authorities used by normal inventory transactions.
        </p>
      </header>

      <section className="grid gap-3 md:grid-cols-4">
        <div className="rounded-xl border border-border p-4"><PackageSearch className="size-4 text-accent" /><p className="mt-2 text-xs text-muted">Latest status</p><p className="mt-1 text-lg font-semibold">{latest ? text(latest.status).toUpperCase() : "NONE"}</p></div>
        <div className="rounded-xl border border-border p-4"><ClipboardCheck className="size-4 text-accent" /><p className="mt-2 text-xs text-muted">Counted lines</p><p className="mt-1 text-lg font-semibold">{counted} / {lines.length}</p></div>
        <div className="rounded-xl border border-border p-4"><TriangleAlert className="size-4 text-accent" /><p className="mt-2 text-xs text-muted">Variance lines</p><p className="mt-1 text-lg font-semibold">{varianceLines}</p></div>
        <div className="rounded-xl border border-border p-4"><LockKeyhole className="size-4 text-accent" /><p className="mt-2 text-xs text-muted">Control rule</p><p className="mt-1 text-sm font-semibold">No silent quantity edit</p></div>
      </section>

      {!latest || text(latest.status) === "posted" || text(latest.status) === "void" ? (
        <section className="rounded-xl border border-border bg-bg-elevated p-5">
          <h2 className="font-display text-xl">Start period stocktake</h2>
          <p className="mt-1 text-xs leading-5 text-muted">
            Stop receipts/issues during the physical count. Any inventory movement after this snapshot invalidates submission or approval and requires a fresh stocktake.
          </p>
          <div className="mt-4 grid gap-3 md:grid-cols-4">
            <label className="text-xs text-muted">Period<input className="control mt-1" type="month" value={period} onChange={(e) => setPeriod(e.target.value)} /></label>
            <label className="text-xs text-muted">Effective date<input className="control mt-1" type="date" value={effectiveOn} onChange={(e) => setEffectiveOn(e.target.value)} /></label>
            <label className="text-xs text-muted">Scope reference<input className="control mt-1" value={scopeReference} onChange={(e) => setScopeReference(e.target.value)} /></label>
            <label className="text-xs text-muted">Evidence pack reference<input className="control mt-1" value={evidenceReference} onChange={(e) => setEvidenceReference(e.target.value)} placeholder="STOCKTAKE-2026-09" /></label>
          </div>
          <button type="button" disabled={!editable || busy} onClick={() => run("start")}
            className="mt-4 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-bg disabled:opacity-50">Start controlled snapshot</button>
        </section>
      ) : null}

      {latest && text(latest.status) === "draft" ? (
        <section className="overflow-hidden rounded-xl border border-border bg-bg-elevated">
          <div className="p-5">
            <h2 className="font-display text-xl">Physical count · {text(latest.period)}</h2>
            <p className="mt-1 text-xs text-muted">Book snapshot: {text(latest.book_snapshot_at)} · preparer: {text(latest.prepared_by)}</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-y border-border bg-surface/50 text-left text-[10px] uppercase tracking-[0.14em] text-subtle">
                <tr><th className="px-3 py-2">SKU</th><th className="px-3 py-2 text-right">Book</th><th className="px-3 py-2">Physical</th><th className="px-3 py-2 text-right">Variance</th><th className="px-3 py-2">Valuation</th><th className="px-3 py-2">Evidence</th><th className="px-3 py-2">Action</th></tr>
              </thead>
              <tbody>{lines.map((row) => <LineEditor key={`${text(row.sku)}|${text(row.unit)}`} row={row} onSaved={refresh} />)}</tbody>
            </table>
          </div>
        </section>
      ) : null}

      {latest && ["draft","submitted","approved"].includes(text(latest.status)) ? (
        <section className="rounded-xl border border-accent/30 bg-bg-elevated p-5">
          <h2 className="font-display text-xl">Governed action</h2>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-muted">
            Submission locks count rows. Approval must be performed by a different user from the preparer. Posting creates FIFO-safe stock adjustments and the linked inventory-variance journal.
          </p>
          <input className="control mt-4 max-w-xl" value={actionEvidence} onChange={(e) => setActionEvidence(e.target.value)} placeholder="Approval / posting evidence reference" />
          <div className="mt-4 flex flex-wrap gap-2">
            {text(latest.status) === "draft" ? <button type="button" disabled={!editable || busy} onClick={() => run("submit")} className="rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-bg disabled:opacity-50">Submit count</button> : null}
            {text(latest.status) === "submitted" ? <button type="button" disabled={!approvable || busy} onClick={() => run("approve")} className="rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-bg disabled:opacity-50">Approve independently</button> : null}
            {text(latest.status) === "approved" ? <button type="button" disabled={!approvable || busy} onClick={() => run("post")} className="rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-bg disabled:opacity-50">Post approved variance</button> : null}
          </div>
          {message ? <div className="mt-4 flex items-start gap-2 rounded-lg border border-border p-3 text-sm"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-green" /><span>{message}</span></div> : null}
        </section>
      ) : message ? <div className="rounded-lg border border-border p-3 text-sm">{message}</div> : null}

      <section className="rounded-xl border border-border bg-bg-elevated p-5">
        <h2 className="font-display text-xl">Recent stocktake control history</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-[10px] uppercase tracking-[0.14em] text-subtle"><tr><th className="py-2 pr-4">Period</th><th className="py-2 pr-4">Status</th><th className="py-2 pr-4">Prepared</th><th className="py-2 pr-4">Approved</th><th className="py-2 pr-4">Variance lines</th><th className="py-2 pr-4">Gain</th><th className="py-2 pr-4">Loss</th><th className="py-2">Journal</th></tr></thead>
            <tbody>{sessions.map((session) => <tr key={text(session.id)} className="border-t border-border/60"><td className="py-2 pr-4">{text(session.period)}</td><td className="py-2 pr-4 font-semibold">{text(session.status)}</td><td className="py-2 pr-4">{text(session.prepared_by)}</td><td className="py-2 pr-4">{text(session.approved_by) || "—"}</td><td className="py-2 pr-4">{num(session.variance_line_count)}</td><td className="py-2 pr-4">{money(session.gain_value_inr)}</td><td className="py-2 pr-4">{money(session.loss_value_inr)}</td><td className="py-2">{text(session.finance_journal_id) || "—"}</td></tr>)}</tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
