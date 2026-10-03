import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, AlertTriangle, GitBranch, ShieldCheck } from "lucide-react";
import { Kpi, Panel } from "@/components/kpi";
import { getGovernedIntelligence } from "@/lib/intelligence-data";

export const Route = createFileRoute("/command/intelligence")({
  loader: async () => getGovernedIntelligence(),
  component: Intelligence,
});

const number = (value: number) => value.toLocaleString("en-IN", { maximumFractionDigits: 1 });
const money = (value: number) => `₹${number(value)} lakh`;
const severityTone = (severity: string) => severity === "critical" || severity === "high" ? "text-danger" : "text-warn";

function Intelligence() {
  const data = Route.useLoaderData();
  return <div className="space-y-6">
    <header className="flex flex-col gap-4 border-b border-border pb-6 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <p className="text-[11px] uppercase tracking-[0.2em] text-green">VYNDI intelligence · governed IBPE evidence</p>
        <h1 className="mt-1 font-display text-4xl text-accent">Product Intelligence</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">Planning, demand, funding and risk signals from the latest persisted IBPE run. This read-only view never approves or posts a business action.</p>
      </div>
      <Link to="/command/ibpe-operating-workspace" className="text-sm font-semibold text-accent hover:text-fg">IBPE Workspace <ArrowRight className="ml-1 inline size-4" /></Link>
    </header>

    {!data.available ? <Panel title="Governed snapshot required" kicker="No values inferred">
      <p className="text-sm text-muted">{data.reason}</p>
      <Link to="/command/ibpe-operating-workspace" className="mt-4 inline-block text-sm font-semibold text-accent">Open IBPE Workspace →</Link>
    </Panel> : <>
      <section className={`rounded-xl border p-4 text-sm ${data.lineage.sourceCurrent ? "border-green/30 bg-green/5" : "border-warn/40 bg-warn/5"}`}>
        <div className="flex flex-wrap items-center gap-2 font-semibold text-fg"><ShieldCheck className="size-4 text-accent" /> Persisted planning snapshot · {data.lineage.sourceCurrent ? "current deployed source" : "source revision differs from deployment"}</div>
        <p className="mt-2 break-words text-xs leading-5 text-muted">IBPE {data.lineage.ibpeRunId} · plan {data.lineage.approvedPlanId} revision {data.lineage.approvedPlanRevision} · captured {new Date(data.lineage.snapshotAt).toLocaleString("en-IN")} · {data.lineage.ageHours === null ? "age unavailable" : `${number(data.lineage.ageHours)} hours old`}</p>
        <p className="mt-1 text-xs text-muted">Read {new Date(data.readAt).toLocaleString("en-IN")} · snapshot source {data.lineage.sourceSha || "unrecorded"} · deployed source {data.lineage.deployedSourceSha || "unrecorded"}</p>
        {!data.lineage.sourceCurrent ? <p className="mt-2 text-xs font-semibold text-warn">Refresh the governed IBPE run before treating these results as current release evidence.</p> : null}
      </section>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Kpi label="Expected units" value={number(data.summary.expectedUnits)} hint={`${data.summary.horizonMonths}-month planning horizon`} />
        <Kpi label="Committed open" value={number(data.summary.committedOpenUnits)} hint="Confirmed demand in snapshot" />
        <Kpi label="Supply shortages" value={number(data.summary.fulfillmentShortageSkuMonths)} hint="SKU-months requiring attention" tone={data.summary.fulfillmentShortageSkuMonths ? "warn" : "ok"} />
        <Kpi label="Capacity shortfalls" value={number(data.summary.capacityShortfallMonths)} hint="Planning periods" tone={data.summary.capacityShortfallMonths ? "warn" : "ok"} />
        <Kpi label="Health score" value={`${number(data.summary.businessHealthScore)}/100`} hint="Governed IBPE calculation" tone={data.summary.businessHealthScore >= 80 ? "ok" : "warn"} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <Panel title="Demand outlook" kicker="Persisted plan, forecast, committed and actual · first six periods">
          {data.demandByPeriod.length ? <div className="overflow-x-auto"><table className="w-full min-w-[480px] text-left text-xs"><thead className="border-b border-border uppercase tracking-[0.12em] text-subtle"><tr><th className="px-3 py-2">Period</th><th className="px-3 py-2">Plan</th><th className="px-3 py-2">Forecast</th><th className="px-3 py-2">Committed</th><th className="px-3 py-2">Actual</th></tr></thead><tbody>{data.demandByPeriod.map((row) => <tr key={row.period} className="border-t border-border/70"><td className="px-3 py-3 font-semibold text-fg">P{row.period}</td><td className="px-3 py-3 text-muted">{number(row.plan)}</td><td className="px-3 py-3 font-semibold text-accent">{number(row.forecast)}</td><td className="px-3 py-3 text-muted">{number(row.committed)}</td><td className="px-3 py-3 text-muted">{number(row.actual)}</td></tr>)}</tbody></table></div> : <p className="text-sm text-muted">No demand rows in this governed snapshot.</p>}
          <p className="mt-4 text-xs text-subtle">Period numbers are planning buckets, not promised delivery dates. Forecasts retain the IBPE separation of actual, committed and forecast demand.</p>
        </Panel>
        <Panel title="Cash and funding" kicker="Governed IBPE calculations · advisory">
          <div className="space-y-3 text-sm text-muted">
            <p>Recommended procurement <strong className="text-fg">{money(data.summary.totalRecommendedProcurementLakh)}</strong></p>
            <p>Minimum free liquidity after recommendations <strong className="text-fg">{money(data.funding.minimumFreeLiquidityAfterRecommendationsLakh)}</strong></p>
            <p>Incremental funding need <strong className="text-fg">{money(data.funding.incrementalFundingNeedLakh)}</strong></p>
            <p>First liquidity breach <strong className="text-fg">{data.funding.firstLiquidityBreachAfterRecommendationsPeriod === null ? "none in horizon" : `P${data.funding.firstLiquidityBreachAfterRecommendationsPeriod}`}</strong></p>
          </div>
          <Link to="/command/cash" className="mt-4 inline-block text-xs font-semibold text-accent">Open cash authority →</Link>
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Planning risks" kicker={`${data.totalFindings} governed finding(s) · highest severity first`}>
          {data.findings.length ? <div className="space-y-3">{data.findings.map((risk) => <article key={risk.id} className="rounded-xl border border-border p-4"><div className="flex flex-wrap justify-between gap-2"><h3 className="text-sm font-semibold text-fg">{risk.title}</h3><span className={`text-xs font-bold uppercase ${severityTone(risk.severity)}`}>{risk.severity}</span></div><p className="mt-1 text-xs text-subtle">{risk.domain} · {risk.id}</p><p className="mt-2 text-xs leading-5 text-muted">{risk.impact}</p><p className="mt-2 text-xs text-fg">Recommended: {risk.action}</p><p className="mt-2 break-words text-[10px] text-subtle">Evidence: {risk.evidence.join(" · ") || "No source reference in finding"}</p></article>)}</div> : <p className="text-sm text-muted">No findings in the persisted run.</p>}
          {data.totalFindings > data.findings.length ? <p className="mt-3 text-xs text-subtle">Showing the six highest priority findings. Open Outputs & Evidence for the full record.</p> : null}
        </Panel>
        <div className="space-y-4">
          <Panel title="Optimizer and release" kicker="Exact IBPE → packet → solver lineage">
            <div className="space-y-2 text-sm text-muted">
              <p>Advanced packet <strong className="break-all text-fg">{data.lineage.packetId ?? "not linked to latest IBPE run"}</strong></p>
              <p>Optimizer run <strong className="break-all text-fg">{data.lineage.optimizerRunId ?? "no exact persisted run"}</strong></p>
              <p>Math / cash <strong className="text-fg">{data.optimizer ? `${data.optimizer.math} / ${data.optimizer.cash ?? "unverified"}` : "unverified"}</strong></p>
              <p>Release evidence <strong className={data.lineage.releaseCurrent ? "text-green" : "text-warn"}>{data.lineage.releaseCurrent ? "GREEN for exact lineage" : "review required"}</strong></p>
            </div>
            {data.blockedReleaseGates.length ? <p className="mt-3 text-xs text-warn">Blocked: {data.blockedReleaseGates.join(" · ")}</p> : null}
            <Link to="/command/ibpe-operating-workspace/release" className="mt-4 inline-block text-xs font-semibold text-accent">Open Release Readiness →</Link>
          </Panel>
          <Panel title="Scenario and decision control" kicker="No autonomous business writes">
            <p className="text-sm text-muted">{data.decisionsRequiringApproval} planning recommendation(s) require authorised action in their owning workspace. Scenario comparisons are calculated from the governed snapshot when requested; none are assumed on this page.</p>
            <div className="mt-4 flex flex-wrap gap-3 text-xs font-semibold text-accent"><Link to="/command/scenarios">Open Scenario Lab →</Link><Link to="/command/ibpe-operating-workspace/outputs">Outputs & Evidence →</Link></div>
          </Panel>
          <Panel title="Engineering release" kicker="Separate VEDM authority">
            <div className="flex gap-3 text-sm text-muted"><AlertTriangle className="mt-0.5 size-5 shrink-0 text-warn" /><p>No engineering readiness percentage or P50/P80/P95 release date is calculated from this IBPE snapshot. Material, geometry, FEA and validation gates need their own controlled evidence.</p></div>
            <Link to="/command/engineering" className="mt-4 inline-block text-xs font-semibold text-accent"><GitBranch className="mr-1 inline size-3" />Open Engineering →</Link>
          </Panel>
        </div>
      </div>
    </>}
  </div>;
}
