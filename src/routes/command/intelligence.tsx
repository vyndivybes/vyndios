import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, AlertTriangle, GitBranch, ShieldCheck, Sparkles } from "lucide-react";
import { Kpi, Panel } from "@/components/kpi";
import { intelligenceSnapshot, readinessTone } from "@/lib/intelligence-model";

export const Route = createFileRoute("/command/intelligence")({ component: Intelligence }); 

const toneClass = (tone: string) => tone === "green" ? "text-green" : tone === "red" ? "text-danger" : "text-warn";
const barClass = (tone: string) => tone === "green" ? "bg-green" : tone === "red" ? "bg-danger" : "bg-warn";

function Intelligence() {
  const s = intelligenceSnapshot;
  return <div className="space-y-6">
    <header className="flex flex-col gap-4 border-b border-border pb-6 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <p className="text-[11px] uppercase tracking-[0.2em] text-green">VYNDI intelligence layer · illustrative preview · not live data</p>
        <h1 className="mt-1 font-display text-4xl text-accent">Product Intelligence</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">Development preview only. All scores, dates, gate states and scenario impacts below are sample values, not calculated forecasts or verified VEDM evidence. Live-data integration is not yet implemented.</p>
      </div>
      <Link to="/command" className="text-sm font-semibold text-accent hover:text-fg">Command Centre <ArrowRight className="ml-1 inline size-4" /></Link>
    </header>

    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      <Kpi label="Product readiness" value={s.readiness + "%"} hint="Required work complete" tone={readinessTone(s.readiness) === "green" ? "ok" : readinessTone(s.readiness) === "red" ? "danger" : "warn"} />
      <Kpi label="Confidence" value={s.confidence + "%"} hint="Evidence strength" tone={readinessTone(s.confidence) === "green" ? "ok" : readinessTone(s.confidence) === "red" ? "danger" : "warn"} />
      <Kpi label="Risk exposure" value={s.riskExposure + "%"} hint="Unresolved exposure" tone="warn" />
      <Kpi label="Evidence coverage" value={s.evidenceCoverage + "%"} hint="VEDM-linked evidence" tone="warn" />
      <Kpi label="Config integrity" value={s.configurationIntegrity + "%"} hint="Revision consistency" tone="ok" />
    </div>

    <div className="grid gap-4 lg:grid-cols-[1.25fr_0.75fr]">
      <Panel title="Forecast release" kicker={s.product}>
        <div className="grid gap-3 sm:grid-cols-3">
          {[["P50", s.forecast.p50, "Most likely"], ["P80", s.forecast.p80, "Planning confidence"], ["P95", s.forecast.p95, "High protection"]].map(([label, value, note]) =>
            <div key={label} className="rounded-xl border border-border bg-surface/30 p-4"><p className="text-[10px] uppercase tracking-[0.16em] text-subtle">{label}</p><p className="mt-2 text-2xl font-semibold text-accent">{value}</p><p className="mt-1 text-xs text-muted">{note}</p></div>
          )}
        </div>
        <div className="mt-5 rounded-xl border border-border p-4"><div className="flex items-center gap-2 text-xs font-semibold text-fg"><GitBranch className="size-4 text-accent" /> Critical path</div><div className="mt-3 flex flex-wrap gap-2">{s.criticalPath.map((item, i) => <span key={item} className="rounded-full border border-border px-3 py-1.5 text-xs text-muted">{i + 1}. {item}</span>)}</div></div>
      </Panel>
      <Panel title="Control posture" kicker="Readiness ≠ confidence ≠ risk">
        <div className="space-y-4 text-sm"><div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 size-5 text-green" /><p className="text-muted">Configuration integrity is high, but material authority remains the release constraint.</p></div><div className="flex items-start gap-3"><Sparkles className="mt-0.5 size-5 text-accent" /><p className="text-muted">Forecast dates shown here are illustrative only. No probabilistic schedule engine is connected yet.</p></div><div className="flex items-start gap-3"><AlertTriangle className="mt-0.5 size-5 text-warn" /><p className="text-muted">No risk is accepted solely because its score is low; evidence confidence is evaluated separately.</p></div></div>
      </Panel>
    </div>

    <Panel title="Engineering readiness matrix" kicker="Click-through data contract ready for VEDM object links">
      <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-left text-xs"><thead className="border-b border-border text-[10px] uppercase tracking-[0.14em] text-subtle"><tr><th className="px-3 py-2">Domain</th><th className="px-3 py-2">Readiness</th><th className="px-3 py-2">Confidence</th><th className="px-3 py-2">Risk</th><th className="px-3 py-2">Trend</th></tr></thead><tbody>{s.metrics.map((m) => <tr key={m.domain} className="border-t border-border/70"><td className="px-3 py-3 font-semibold text-fg">{m.domain}</td><td className="px-3 py-3"><span className={toneClass(m.status)}>{m.readiness}%</span><div className="mt-1 h-1.5 w-32 rounded-full bg-border"><div className={`h-full rounded-full ${barClass(m.status)}`} style={{ width: `${m.readiness}%` }} /></div></td><td className="px-3 py-3 text-muted">{m.confidence}%</td><td className={`px-3 py-3 font-semibold ${toneClass(m.risk >= 60 ? "red" : m.risk >= 35 ? "amber" : "green")}`}>{m.risk}%</td><td className="px-3 py-3 text-muted">{m.trend === "up" ? "↑ rising" : m.trend === "down" ? "↓ improving" : "→ stable"}</td></tr>)}</tbody></table></div>
    </Panel>

    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title="Top emerging risks" kicker="Risk register · evidence linked">
        <div className="space-y-3">{s.risks.map((r) => <div key={r.id} className="rounded-xl border border-border p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><span className="text-[10px] font-semibold text-accent">{r.id}</span><h3 className="mt-1 text-sm font-semibold text-fg">{r.title}</h3></div><span className={`rounded-full border border-border px-2 py-1 text-[10px] font-bold ${toneClass(r.level === "RED" ? "red" : "amber")}`}>{r.level}</span></div><p className="mt-2 text-xs leading-5 text-muted">{r.impact}</p><p className="mt-2 text-[10px] uppercase tracking-[0.12em] text-subtle">{r.source}</p></div>)}</div>
      </Panel>
      <Panel title="VEDM gate outlook" kicker="Planning and release dependency view">
        <div className="space-y-3">{s.gates.map((g) => <div key={g.gate} className="flex items-center gap-3 rounded-xl border border-border p-3"><div className={`flex size-10 shrink-0 items-center justify-center rounded-full border border-border text-xs font-bold ${toneClass(g.status)}`}>{g.gate}</div><div className="min-w-0 flex-1"><p className="text-sm font-semibold text-fg">{g.title}</p><p className="mt-1 text-xs text-muted">{g.forecast}</p><div className="mt-2 h-1.5 rounded-full bg-border"><div className={`h-full rounded-full ${barClass(g.status)}`} style={{ width: `${g.readiness}%` }} /></div></div><span className="text-xs tabular-nums text-muted">{g.readiness}%</span></div>)}</div>
      </Panel>
    </div>

    <Panel title="Scenario Lab" kicker="Impact propagation before commitment">
      <div className="grid gap-3 md:grid-cols-3">{s.scenarios.map((scenario) => <div key={scenario.label} className="rounded-xl border border-border p-4"><div className="flex items-center justify-between"><span className="text-xs font-semibold text-accent">{scenario.label}</span><span className={toneClass(scenario.release === "Open" ? "green" : scenario.release === "Blocked" ? "red" : "amber")}>{scenario.release}</span></div><h3 className="mt-3 text-sm font-semibold text-fg">{scenario.change}</h3><p className="mt-2 text-xs leading-5 text-muted">{scenario.effect}</p><p className="mt-3 text-xs font-semibold text-fg">{scenario.schedule}</p></div>)}</div>
      <p className="mt-4 text-[10px] uppercase tracking-[0.14em] text-subtle">Provenance: current VEDM authority/traceability concepts · values marked derived/provisional until connected to live records.</p>
    </Panel>
  </div>;
}
