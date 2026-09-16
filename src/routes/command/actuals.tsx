import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Kpi, Panel } from "@/components/kpi";
import { buildModelWithInputs } from "@/lib/finance/model";
import { useVeloxis } from "@/lib/store";
import {
  clearMonthlyActual,
  listMonthlyActuals,
  saveMonthlyActual,
  type ActualField,
  type ActualsMap,
} from "@/lib/actuals-authority";
import { extractManagementEvidence } from "@/lib/actuals-evidence";

export const Route = createFileRoute("/command/actuals")({ component: Actuals });

const fields: { key: ActualField; label: string; suffix: string; controlled?: boolean }[] = [
  { key: "revenue", label: "Revenue", suffix: "₹L", controlled: true },
  { key: "units", label: "Units sold", suffix: "units", controlled: true },
  { key: "cogs", label: "COGS", suffix: "₹L" },
  { key: "opex", label: "Opex", suffix: "₹L" },
  { key: "closingCash", label: "Closing cash", suffix: "₹L" },
  { key: "inventory", label: "Inventory", suffix: "₹L" },
  { key: "receivables", label: "Receivables", suffix: "₹L", controlled: true },
  { key: "payables", label: "Payables", suffix: "₹L" },
];

const money = (n: number) => `₹${n.toFixed(1)}L`;
const actualGrid =
  "grid-cols-[minmax(0,.45fr)_repeat(8,minmax(0,.72fr))_minmax(0,1.65fr)_minmax(0,.85fr)_minmax(0,1fr)]";
const forecastGrid =
  "grid-cols-[minmax(0,.55fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,.8fr)_minmax(0,2fr)]";

function Actuals() {
  const scenario = useVeloxis((s) => s.scenario);
  const drawStandby = useVeloxis((s) => s.drawStandby);
  const finance = useVeloxis((s) => s.finance);
  const [actuals, setActuals] = useState<ActualsMap>({});
  const [status, setStatus] = useState("Loading central actuals…");
  const [busy, setBusy] = useState<number | null>(null);

  async function reload() {
    const rows = await listMonthlyActuals();
    setActuals(rows);
    setStatus("Central actuals reconciled to transaction ledger");
  }

  useEffect(() => {
    let active = true;
    void listMonthlyActuals()
      .then((rows) => {
        if (active) {
          setActuals(rows);
          setStatus("Central actuals reconciled to transaction ledger");
        }
      })
      .catch((e) => active && setStatus(e instanceof Error ? e.message : "Unable to load actuals"));
    return () => {
      active = false;
    };
  }, []);

  const plan = useMemo(
    () => buildModelWithInputs(scenario, drawStandby, finance),
    [scenario, drawStandby, finance],
  );
  const enteredMonths = Object.keys(actuals)
    .map(Number)
    .filter((m) => fields.some(({ key }) => actuals[m]?.[key] != null))
    .sort((a, b) => a - b);
  const latest = enteredMonths.at(-1) ?? 0;
  const actualRevenue = enteredMonths.reduce((s, m) => s + (actuals[m]?.revenue ?? 0), 0);
  const planRevenue = enteredMonths.reduce((s, m) => s + (plan[m - 1]?.revenue ?? 0), 0);
  const rollingRevenue = plan.reduce(
    (s, row, i) =>
      s + ((i + 1) <= latest && actuals[i + 1]?.revenue != null ? (actuals[i + 1]?.revenue ?? 0) : row.revenue),
    0,
  );

  function edit(month: number, key: ActualField, value: number | null) {
    setActuals((current) => ({ ...current, [month]: { ...current[month], [key]: value } }));
    setStatus(`M${month} edited · not yet posted`);
  }

  function evidence(month: number, value: string) {
    setActuals((current) => ({ ...current, [month]: { ...current[month], sourceReference: value } }));
    setStatus(`M${month} edited · not yet posted`);
  }

  async function save(month: number) {
    const actual = actuals[month] ?? {};
    const normalizedActual = {
      ...actual,
      sourceReference: extractManagementEvidence(actual.sourceReference),
    };
    setBusy(month);
    try {
      await saveMonthlyActual({ data: { month, actual: normalizedActual } });
      await reload();
      setStatus(
        `M${month} reconciled and posted. Revenue, units and receivables came from controlled transactions.`,
      );
    } catch (e) {
      setStatus(e instanceof Error ? e.message : `M${month} save failed`);
    } finally {
      setBusy(null);
    }
  }

  async function clear(month: number) {
    setBusy(month);
    try {
      await clearMonthlyActual({ data: { month } });
      await reload();
      setStatus(`M${month} manual management actuals cleared; transaction-derived fields remain authoritative.`);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : `M${month} clear failed`);
    } finally {
      setBusy(null);
    }
  }

  function fieldControl(month: number, field: (typeof fields)[number]) {
    const actual = actuals[month] ?? {};
    const value = actual[field.key];
    if (field.controlled) {
      return (
        <div
          className="w-full min-w-0 rounded-md border border-border bg-surface px-1.5 py-1.5 text-right text-[10px] xl:text-xs"
          title="Derived from shipment/invoice/collection ledger"
        >
          {value == null ? "—" : Number(value).toFixed(field.key === "units" ? 0 : 1)}
        </div>
      );
    }
    return (
      <input
        aria-label={`M${month} ${field.label}`}
        type="number"
        min={field.key === "closingCash" ? undefined : "0"}
        step="0.1"
        value={value ?? ""}
        onChange={(e) => edit(month, field.key, e.target.value === "" ? null : Number(e.target.value))}
        className="w-full min-w-0 rounded-md border border-border bg-bg px-1.5 py-1.5 text-right text-[10px] text-fg xl:text-xs"
      />
    );
  }

  return (
    <div className="min-w-0 space-y-6">
      <header>
        <p className="text-[11px] uppercase tracking-[0.2em] text-subtle">Finance · central actual books</p>
        <h1 className="font-display text-4xl">Actuals & rolling forecast</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
          Revenue, units sold and receivables are transaction-controlled from issued shipment invoices and collections.
          COGS, Opex, cash, inventory and payables remain evidence-referenced management actuals pending their own ledger
          authorities.
        </p>
        <p className="mt-2 text-xs text-subtle">{status}</p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Actual months" value={String(enteredMonths.length)} hint={latest ? `Through M${latest}` : "No actuals posted"} />
        <Kpi label="Actual revenue" value={money(actualRevenue)} hint="Invoice-derived" />
        <Kpi
          label="Revenue variance"
          value={money(actualRevenue - planRevenue)}
          hint="Actual vs plan"
          tone={actualRevenue - planRevenue < 0 ? "danger" : "ok"}
        />
        <Kpi label="Rolling 36M revenue" value={money(rollingRevenue)} hint="Actual + future forecast" />
      </div>

      <Panel title="Monthly actual reconciliation" kicker="Protected fields are read-only transaction truth">
        <div
          className="w-full min-w-0 space-y-2"
          data-full-view-table="monthly-actual-reconciliation"
          aria-label="Full-view monthly actual reconciliation"
        >
          <div
            className={`hidden ${actualGrid} gap-1 rounded-lg border border-border bg-surface/55 px-2 py-2 text-[8px] font-bold uppercase leading-tight tracking-[0.06em] text-subtle lg:grid xl:text-[9px]`}
          >
            <span>Month</span>
            {fields.map((field) => (
              <span key={field.key} className="min-w-0 break-words text-right">
                {field.label}
                <br />
                <span className="font-normal">{field.suffix}{field.controlled ? " · ledger" : ""}</span>
              </span>
            ))}
            <span className="min-w-0 break-words">Management evidence</span>
            <span className="min-w-0 break-words text-center">Control</span>
            <span className="min-w-0 break-words">Action</span>
          </div>

          <div className="hidden space-y-1 lg:block">
            {Array.from({ length: 36 }, (_, i) => i + 1).map((month) => {
              const actual = actuals[month] ?? {};
              return (
                <div
                  key={month}
                  className={`grid ${actualGrid} min-w-0 items-center gap-1 border-t border-border px-2 py-1.5 text-[10px] xl:text-xs`}
                >
                  <div className="min-w-0 font-medium">M{month}</div>
                  {fields.map((field) => (
                    <div key={field.key} className="min-w-0">{fieldControl(month, field)}</div>
                  ))}
                  <div className="min-w-0">
                    <input
                      value={extractManagementEvidence(actual.sourceReference)}
                      onChange={(e) => evidence(month, e.target.value)}
                      placeholder="Bank / ledger / evidence ref"
                      className="w-full min-w-0 rounded-md border border-border bg-bg px-1.5 py-1.5 text-[10px] text-fg xl:text-xs"
                    />
                  </div>
                  <div className="min-w-0 text-center">
                    <span
                      className={
                        actual.transactionDerived
                          ? "block break-words text-[9px] font-semibold leading-tight text-accent xl:text-[10px]"
                          : "block break-words text-[9px] leading-tight text-muted xl:text-[10px]"
                      }
                    >
                      {actual.transactionDerived ? "TRANSACTION" : "MANAGEMENT"}
                    </span>
                  </div>
                  <div className="flex min-w-0 flex-col items-start gap-1 2xl:flex-row 2xl:flex-wrap">
                    <button
                      disabled={busy === month}
                      onClick={() => void save(month)}
                      className="max-w-full break-words text-left text-[10px] font-semibold leading-tight text-accent disabled:opacity-50 xl:text-xs"
                    >
                      Reconcile
                    </button>
                    <button
                      disabled={busy === month}
                      onClick={() => void clear(month)}
                      className="max-w-full break-words text-left text-[10px] leading-tight text-muted hover:text-danger disabled:opacity-50 xl:text-xs"
                    >
                      Clear manual
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="space-y-3 lg:hidden">
            {Array.from({ length: 36 }, (_, i) => i + 1).map((month) => {
              const actual = actuals[month] ?? {};
              return (
                <section key={month} className="rounded-lg border border-border bg-surface/30 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-semibold">M{month}</span>
                    <span className={actual.transactionDerived ? "text-[10px] font-semibold text-accent" : "text-[10px] text-muted"}>
                      {actual.transactionDerived ? "TRANSACTION" : "MANAGEMENT"}
                    </span>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {fields.map((field) => (
                      <label key={field.key} className="min-w-0 text-[10px] font-medium text-muted">
                        <span className="mb-1 block leading-tight">{field.label} · {field.suffix}</span>
                        {fieldControl(month, field)}
                      </label>
                    ))}
                  </div>
                  <label className="mt-3 block min-w-0 text-[10px] font-medium text-muted">
                    <span className="mb-1 block">Management evidence</span>
                    <input
                      value={extractManagementEvidence(actual.sourceReference)}
                      onChange={(e) => evidence(month, e.target.value)}
                      placeholder="Bank / ledger / evidence ref"
                      className="w-full min-w-0 rounded-md border border-border bg-bg px-2 py-2 text-xs text-fg"
                    />
                  </label>
                  <div className="mt-3 flex flex-wrap gap-3">
                    <button disabled={busy === month} onClick={() => void save(month)} className="text-xs font-semibold text-accent disabled:opacity-50">
                      Reconcile
                    </button>
                    <button disabled={busy === month} onClick={() => void clear(month)} className="text-xs text-muted hover:text-danger disabled:opacity-50">
                      Clear manual
                    </button>
                  </div>
                </section>
              );
            })}
          </div>
        </div>
        <p className="mt-4 text-xs leading-5 text-muted">
          The UI cannot set transaction verification. Revenue, units and receivables are accepted only when they match the
          canonical shipment/invoice/collection ledger. Statutory CA verification remains a separate control.
        </p>
      </Panel>

      <Panel title="Rolling forecast basis" kicker="Approved Plan remains immutable as baseline">
        <div
          className="w-full min-w-0 space-y-2"
          data-full-view-table="rolling-forecast-basis"
          aria-label="Full-view rolling forecast basis"
        >
          <div
            className={`hidden ${forecastGrid} gap-2 rounded-lg border border-border bg-surface/55 px-3 py-2 text-[9px] font-bold uppercase tracking-[0.1em] text-subtle md:grid`}
          >
            <span>Month</span>
            <span className="text-right">Plan revenue</span>
            <span className="text-right">Actual revenue</span>
            <span>Basis</span>
            <span>Authority</span>
          </div>
          <div className="hidden space-y-1 md:block">
            {plan.map((row, i) => {
              const actual = actuals[i + 1];
              return (
                <div key={row.m} className={`grid ${forecastGrid} min-w-0 items-center gap-2 border-t border-border px-3 py-2 text-xs`}>
                  <div>M{row.m}</div>
                  <div className="text-right">{money(row.revenue)}</div>
                  <div className="text-right">{actual?.revenue == null ? "—" : money(actual.revenue)}</div>
                  <div>
                    {row.m <= latest && actual?.revenue != null ? <span className="text-accent">ACTUAL</span> : <span className="text-muted">FORECAST</span>}
                  </div>
                  <div className="min-w-0 break-words text-xs text-muted">
                    {actual?.transactionDerived ? "Shipment → invoice → receivable" : "—"}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="space-y-2 md:hidden">
            {plan.map((row, i) => {
              const actual = actuals[i + 1];
              return (
                <div key={row.m} className="grid grid-cols-2 gap-x-3 gap-y-1 rounded-lg border border-border bg-surface/30 p-3 text-xs">
                  <span className="font-semibold">M{row.m}</span>
                  <span className="text-right">{row.m <= latest && actual?.revenue != null ? <span className="text-accent">ACTUAL</span> : <span className="text-muted">FORECAST</span>}</span>
                  <span className="text-muted">Plan</span><span className="text-right">{money(row.revenue)}</span>
                  <span className="text-muted">Actual</span><span className="text-right">{actual?.revenue == null ? "—" : money(actual.revenue)}</span>
                  <span className="text-muted">Authority</span><span className="min-w-0 break-words text-right text-muted">{actual?.transactionDerived ? "Shipment → invoice → receivable" : "—"}</span>
                </div>
              );
            })}
          </div>
        </div>
      </Panel>
    </div>
  );
}
