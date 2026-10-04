import { useMemo, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { Kpi, Panel } from "@/components/kpi";
import { captureEarnedValueSnapshot, updateEarnedValueEvidence } from "@/lib/earned-value-authority";
import type { buildEarnedValueSnapshot } from "@/lib/earned-value-model";

type Row = Record<string, unknown>;
type Result = ReturnType<typeof buildEarnedValueSnapshot>;
type State = {
  tasks: Row[];
  live: Result;
  latest: {
    id: string;
    asOfDate: string;
    method: string;
    sourceReference: string;
    actorRole: string;
    createdAt: string;
    result: Result;
  } | null;
};

const text = (row: Row, key: string) => row[key] == null ? "" : String(row[key]);
const optionalNumber = (value: string) => {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const money = (value: number | null) => value == null ? "WITHHELD" : "₹" + value.toFixed(2) + "L";
const ratio = (value: number | null) => value == null ? "WITHHELD" : value.toFixed(3);

export function EarnedValuePanel({ state }: { state: State }) {
  const router = useRouter();
  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>({});
  const [sourceReference, setSourceReference] = useState("UI:EARNED_VALUE");
  const [asOfDate, setAsOfDate] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const result = state.live;

  const rows = useMemo(() => state.tasks.map((row) => {
    const id = text(row, "id");
    const draft = drafts[id] ?? {};
    return {
      row,
      id,
      progress: String(draft.progress ?? text(row, "progress_pct")),
      progressRef: String(draft.progressRef ?? text(row, "progress_evidence_ref")),
      actualCost: String(draft.actualCost ?? text(row, "actual_cost_lakh")),
      actualCostRef: String(draft.actualCostRef ?? text(row, "actual_cost_source_ref")),
    };
  }), [state.tasks, drafts]);

  function patch(id: string, key: string, value: string) {
    setDrafts((current) => ({ ...current, [id]: { ...(current[id] ?? {}), [key]: value } }));
  }

  async function save(item: (typeof rows)[number]) {
    setBusy(item.id);
    setMessage("");
    try {
      const status = text(item.row, "status");
      await updateEarnedValueEvidence({ data: {
        taskId: item.id,
        progressPct: status === "in_progress" ? optionalNumber(item.progress) : null,
        progressEvidenceRef: status === "in_progress" ? (item.progressRef.trim() || null) : null,
        actualCostLakh: optionalNumber(item.actualCost),
        actualCostSourceRef: item.actualCost.trim() ? (item.actualCostRef.trim() || null) : null,
        sourceReference,
      } });
      setMessage("Earned Value evidence saved for " + item.id + ".");
      await router.invalidate();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to save Earned Value evidence.");
    } finally {
      setBusy("");
    }
  }

  async function capture() {
    setBusy("capture");
    setMessage("");
    try {
      const response = await captureEarnedValueSnapshot({ data: { asOfDate, sourceReference } });
      setMessage("Earned Value snapshot " + response.id + " captured as immutable governed evidence.");
      await router.invalidate();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to capture Earned Value snapshot.");
    } finally {
      setBusy("");
    }
  }

  return <div className="space-y-4">
    <Panel title="Earned Value Intelligence" kicker="BAC · PV · EV · AC · CPI/SPI · evidence-backed program control">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-8">
        <Kpi label="BAC" value={money(result.bacLakh)} hint="Budget at completion" />
        <Kpi label="PV" value={money(result.pvLakh)} hint={"As of " + result.asOfDate} />
        <Kpi label="EV" value={result.available ? money(result.evLakh) : "WITHHELD"} hint="Computed, never entered" />
        <Kpi label="AC" value={result.available ? money(result.acLakh) : "WITHHELD"} hint="Governed actual cost" />
        <Kpi label="SPI" value={ratio(result.spi)} hint={result.spi == null ? "No valid denominator" : result.spi >= 1 ? "On/ahead of plan" : "Behind plan"} tone={result.spi != null && result.spi < 1 ? "warn" : "ok"} />
        <Kpi label="CPI" value={ratio(result.cpi)} hint={result.cpi == null ? "No valid denominator" : result.cpi >= 1 ? "At/under cost basis" : "Cost inefficiency"} tone={result.cpi != null && result.cpi < 1 ? "warn" : "ok"} />
        <Kpi label="EAC" value={money(result.eacLakh)} hint="BAC / CPI" />
        <Kpi label="VAC" value={money(result.vacLakh)} hint="BAC - EAC" tone={result.vacLakh != null && result.vacLakh < 0 ? "warn" : "ok"} />
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <div className="rounded-lg border border-border p-3 text-xs text-muted"><strong className="text-fg">Progress coverage</strong><p className="mt-1">{result.progressCoveragePct.toFixed(1)}%</p></div>
        <div className="rounded-lg border border-border p-3 text-xs text-muted"><strong className="text-fg">Actual-cost coverage</strong><p className="mt-1">{result.actualCostCoveragePct.toFixed(1)}%</p></div>
        <div className="rounded-lg border border-border p-3 text-xs text-muted"><strong className="text-fg">Performance state</strong><p className={result.available ? "mt-1 text-green" : "mt-1 text-warn"}>{result.available ? "AVAILABLE" : "WITHHELD"}</p></div>
      </div>

      <p className="mt-3 text-xs leading-5 text-muted">{result.reason}</p>
      <p className="mt-2 text-[10px] leading-4 text-subtle">EV is derived from governed task completion/progress evidence. VYNDI does not expose an editable EV amount. In-progress and blocked work preserve evidenced physical progress; active work must carry actual-cost evidence before CPI/EAC are published.</p>

      <div className="mt-4 grid gap-3 md:grid-cols-[180px_1fr_auto]">
        <label className="text-xs text-muted">As-of date<input type="date" className="control mt-1.5 w-full" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} /></label>
        <label className="text-xs text-muted">Evidence / decision reference<input className="control mt-1.5 w-full" value={sourceReference} onChange={(e) => setSourceReference(e.target.value)} /></label>
        <button type="button" disabled={busy === "capture" || !result.available || !sourceReference.trim()} onClick={() => void capture()} className="self-end rounded bg-accent px-4 py-2.5 text-xs font-semibold text-bg disabled:opacity-40">Capture EVM snapshot</button>
      </div>

      {message ? <div role="status" className="mt-3 rounded border border-border bg-surface px-3 py-2 text-xs text-muted">{message}</div> : null}
      {state.latest
        ? <p className="mt-3 text-[10px] text-subtle">Latest immutable run: {state.latest.id} · as of {state.latest.asOfDate} · {state.latest.sourceReference} · captured {state.latest.createdAt}</p>
        : <p className="mt-3 text-[10px] text-subtle">No immutable Earned Value snapshot captured yet.</p>}
    </Panel>

    <Panel title="Earned Value Evidence" kicker="Physical progress + actual cost · source evidence required">
      {rows.length ? <div className="grid gap-3 lg:grid-cols-2">{rows.map((item) => {
        const status = text(item.row, "status");
        const complete = status === "complete";
        const progressEditable = status === "in_progress" || status === "blocked";
        const bac = item.row.cost_lakh == null ? null : Number(item.row.cost_lakh);
        return <article key={item.id} className="rounded-xl border border-border p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><p className="font-semibold text-fg">{text(item.row, "title")}</p><p className="font-mono text-[10px] text-subtle">{item.id} · {status}</p></div>
            <span className="text-xs text-muted">BAC {bac == null ? "not set" : "₹" + bac.toFixed(2) + "L"}</span>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-muted">Physical progress %<input inputMode="decimal" disabled={!progressEditable} className="control mt-1.5 w-full disabled:opacity-50" value={complete ? "100" : item.progress} onChange={(e) => patch(item.id, "progress", e.target.value)} placeholder={progressEditable ? "0–100" : complete ? "100 computed" : "Not applicable"} /></label>
            <label className="text-xs text-muted">Progress evidence<input disabled={!progressEditable} className="control mt-1.5 w-full disabled:opacity-50" value={progressEditable ? item.progressRef : ""} onChange={(e) => patch(item.id, "progressRef", e.target.value)} placeholder={progressEditable ? "EVID-..." : "Derived from status"} /></label>
            <label className="text-xs text-muted">Actual cost ₹L<input inputMode="decimal" className="control mt-1.5 w-full" value={item.actualCost} onChange={(e) => patch(item.id, "actualCost", e.target.value)} placeholder="0.00" /></label>
            <label className="text-xs text-muted">Actual-cost evidence<input className="control mt-1.5 w-full" value={item.actualCostRef} onChange={(e) => patch(item.id, "actualCostRef", e.target.value)} placeholder="Invoice / ledger / approved cost ref" /></label>
          </div>
          <button type="button" disabled={busy === item.id || !sourceReference.trim()} onClick={() => void save(item)} className="mt-3 rounded border border-border px-3 py-2 text-xs font-semibold hover:border-accent disabled:opacity-40">Save evidence</button>
        </article>;
      })}</div> : <p className="text-sm text-muted">No governed program tasks exist. Build the Program & Gate Plan before using Earned Value.</p>}
    </Panel>
  </div>;
}
