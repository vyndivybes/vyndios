import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Fragment, useMemo, useState } from "react";
import { Kpi, Panel } from "@/components/kpi";
import {
  createRiskRegisterItem,
  listCanonicalRiskAuthority,
  listDerivedEngineeringRiskSignals,
  listRiskHistory,
  transitionRiskRegisterItem,
} from "@/lib/finance-governance-authority";
import { buildRiskHeatmap, evidenceConfidenceState } from "@/lib/vyndi-risk-model";

type Row = Record<string, unknown>;
type RiskStatus = "open" | "mitigating" | "accepted" | "closed";
type RiskForm = { status: RiskStatus; mitigation: string; sourceReference: string };
type NewRiskForm = {
  id: string;
  risk: string;
  domain: string;
  likelihood: "Low" | "Med" | "High";
  impact: "Low" | "Med" | "High";
  mitigation: string;
  owner: string;
  severity: string;
  occurrence: string;
  detection: string;
  evidenceConfidence: string;
  dependencyImpact: string;
  affectedObjects: string;
  provenanceClass: "measured" | "calculated" | "derived" | "assumed" | "predicted" | "ai_interpreted";
  sourceReference: string;
};
const text = (row: Row, ...keys: string[]) => { for (const key of keys) if (row[key] != null) return String(row[key]); return ""; };
const num = (row: Row, key: string) => row[key] == null ? null : Number(row[key]);
const pct = (value: number | null) => value == null || !Number.isFinite(value) ? "Unrated" : `${Math.round(value * 100)}%`;
const list = (value: unknown) => Array.isArray(value) ? value.map(String) : [];

const domains = [
  "technical","material","manufacturing","quality","validation","schedule","cost",
  "supply_chain","configuration","compliance","commercial","cybersecurity","ip",
  "operational","evidence",
] as const;

export const Route = createFileRoute("/command/risk")({
  loader: async () => {
    const [risks, derived, history] = await Promise.all([
      listCanonicalRiskAuthority(),
      listDerivedEngineeringRiskSignals(),
      listRiskHistory(),
    ]);
    return { risks, derived, history };
  },
  component: Risk,
});

const emptyRisk: NewRiskForm = {
  id: "",
  risk: "",
  domain: "technical",
  likelihood: "Med",
  impact: "Med",
  mitigation: "",
  owner: "",
  severity: "",
  occurrence: "",
  detection: "",
  evidenceConfidence: "",
  dependencyImpact: "",
  affectedObjects: "",
  provenanceClass: "assumed",
  sourceReference: "",
};

function optionalNumber(value: string, divisor = 1) {
  const clean = value.trim();
  if (!clean) return null;
  const parsed = Number(clean);
  return Number.isFinite(parsed) ? parsed / divisor : null;
}

function Risk() {
  const loaded = Route.useLoaderData() as { risks: Row[]; derived: Row[]; history: Row[] };
  const risks = loaded.risks;
  const router = useRouter();
  const [editingId, setEditingId] = useState("");
  const [form, setForm] = useState<RiskForm | null>(null);
  const [newRisk, setNewRisk] = useState<NewRiskForm>(emptyRisk);
  const [showCreate, setShowCreate] = useState(false);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");

  const open = risks.filter((row) => text(row,"status") !== "closed").length;
  const highHigh = risks.filter((row) => text(row,"likelihood") === "High" && text(row,"impact") === "High" && text(row,"status") !== "closed").length;
  const lowEvidence = risks.filter((row) => {
    const confidence = num(row, "evidence_confidence");
    return text(row,"status") !== "closed" && evidenceConfidenceState(confidence) === "low";
  }).length;
  const heatmap = useMemo(() => buildRiskHeatmap(risks.map((row) => ({
    likelihood: text(row,"likelihood"),
    impact: text(row,"impact"),
    status: text(row,"status"),
  }))), [risks]);

  function beginEdit(row: Row) {
    setEditingId(text(row, "id"));
    setForm({
      status: (text(row, "status") || "open") as RiskStatus,
      mitigation: text(row, "mitigation"),
      sourceReference: text(row, "source_reference", "sourceReference") || "UI:RISK_REGISTER",
    });
  }

  async function save(row: Row) {
    if (!form) return;
    const id = text(row, "id");
    setBusy(id);
    setMessage("");
    try {
      await transitionRiskRegisterItem({ data: { id, ...form } });
      setEditingId("");
      setForm(null);
      setMessage(`${id} updated through canonical Risk authority; audit evidence was appended.`);
      await router.invalidate();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Risk register update failed.");
    } finally {
      setBusy("");
    }
  }

  async function createRisk() {
    setBusy("create");
    setMessage("");
    try {
      await createRiskRegisterItem({
        data: {
          id: newRisk.id.trim(),
          risk: newRisk.risk.trim(),
          domain: newRisk.domain as typeof domains[number],
          likelihood: newRisk.likelihood,
          impact: newRisk.impact,
          mitigation: newRisk.mitigation.trim(),
          owner: newRisk.owner.trim(),
          severity: optionalNumber(newRisk.severity),
          occurrence: optionalNumber(newRisk.occurrence),
          detection: optionalNumber(newRisk.detection),
          evidenceConfidence: optionalNumber(newRisk.evidenceConfidence, 100),
          dependencyImpact: optionalNumber(newRisk.dependencyImpact),
          affectedObjects: newRisk.affectedObjects.split(",").map((x) => x.trim()).filter(Boolean),
          evidenceLinks: [],
          provenanceClass: newRisk.provenanceClass,
          sourceReference: newRisk.sourceReference.trim(),
        },
      });
      setNewRisk(emptyRisk);
      setShowCreate(false);
      setMessage("Governed risk created and appended to the audit trail.");
      await router.invalidate();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Risk creation failed.");
    } finally {
      setBusy("");
    }
  }

  const impacts = ["High","Med","Low"] as const;
  const likelihoods = ["Low","Med","High"] as const;

  return <div className="space-y-6">
    <header className="border-b border-border pb-6">
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-green">Governance · VYNDI Risk Engine</p>
      <h1 className="mt-1 font-display text-4xl text-accent">Risk Register</h1>
      <p className="mt-2 max-w-4xl text-sm leading-6 text-muted">One governed risk authority for business and engineering. Likelihood and impact remain explicit inputs; FMEA is calculated only from entered S/O/D values, while VEDM evidence/configuration issues are shown separately as derived signals with provenance and no invented probability.</p>
    </header>

    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      <Kpi label="Register items" value={String(risks.length)} hint="Canonical persisted risks"/>
      <Kpi label="Open / active" value={String(open)} hint="Not closed" tone={open ? "warn" : "ok"}/>
      <Kpi label="High × High" value={String(highHigh)} hint="Critical matrix exposure" tone={highHigh ? "danger" : "ok"}/>
      <Kpi label="Low evidence" value={String(lowEvidence)} hint="Confidence below 60%" tone={lowEvidence ? "warn" : "ok"}/>
      <Kpi label="VEDM signals" value={String(loaded.derived.length)} hint="Derived evidence/configuration issues" tone={loaded.derived.length ? "warn" : "ok"}/>
    </div>

    {message ? <div role="status" className="rounded-lg border border-border bg-surface px-4 py-3 text-sm text-muted">{message}</div> : null}

    <div className="grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
      <Panel title="Risk Heatmap" kicker="Active canonical risks · likelihood × impact">
        <div className="grid grid-cols-[80px_repeat(3,minmax(0,1fr))] gap-2 text-center text-xs">
          <div />
          {likelihoods.map((l) => <div key={l} className="font-semibold text-muted">{l} likelihood</div>)}
          {impacts.map((impact) => <Fragment key={impact}>
            <div className="flex items-center justify-end pr-2 font-semibold text-muted">{impact}</div>
            {likelihoods.map((likelihood) => {
              const count = heatmap[`${likelihood}|${impact}`] ?? 0;
              const critical = likelihood === "High" && impact === "High";
              const elevated = (likelihood === "High" && impact === "Med") || (likelihood === "Med" && impact === "High");
              return <div key={likelihood} className={`rounded-lg border p-4 ${critical ? "border-danger/40 bg-danger/10" : elevated ? "border-warn/40 bg-warn/10" : "border-border bg-surface/30"}`}>
                <p className="text-xl font-semibold text-fg">{count}</p>
                <p className="mt-1 text-[10px] uppercase tracking-wider text-subtle">{likelihood} × {impact}</p>
              </div>;
            })}
          </Fragment>)}
        </div>
      </Panel>

      <Panel title="VEDM Evidence & Configuration Risk" kicker="Derived · read-only · probability not inferred">
        {loaded.derived.length ? <div className="space-y-2">{loaded.derived.slice(0,8).map((row) =>
          <div key={text(row,"id")} className="rounded-lg border border-border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-fg">{text(row,"title")}</p>
              <span className="text-[10px] font-bold uppercase text-warn">{text(row,"domain")} · {text(row,"impact")} impact</span>
            </div>
            <p className="mt-1 text-xs leading-5 text-muted">{text(row,"message")}</p>
            <p className="mt-2 text-[10px] text-subtle">Provenance: {text(row,"sourceReference")} · probability: not inferred</p>
          </div>
        )}</div> : <p className="text-sm text-ok">No current VEDM authority/evidence issues were derived.</p>}
      </Panel>
    </div>

    <Panel title="Canonical Risk Register" kicker="Governed lifecycle · FMEA · evidence confidence · dependencies">
      <div className="mb-4 flex justify-end">
        <button type="button" onClick={() => setShowCreate((v) => !v)} className="rounded border border-border px-3 py-2 text-xs font-semibold hover:border-accent hover:text-accent">{showCreate ? "Close new risk" : "Add governed risk"}</button>
      </div>
      {showCreate ? <div className="mb-5 rounded-xl border border-border bg-surface/40 p-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label className="text-xs text-muted">Risk ID<input className="control mt-1.5 w-full" value={newRisk.id} onChange={(e)=>setNewRisk({...newRisk,id:e.target.value})} placeholder="RISK-..."/></label>
          <label className="text-xs text-muted">Domain<select className="control mt-1.5 w-full" value={newRisk.domain} onChange={(e)=>setNewRisk({...newRisk,domain:e.target.value})}>{domains.map((d)=><option key={d} value={d}>{d}</option>)}</select></label>
          <label className="text-xs text-muted">Likelihood<select className="control mt-1.5 w-full" value={newRisk.likelihood} onChange={(e)=>setNewRisk({...newRisk,likelihood:e.target.value as NewRiskForm["likelihood"]})}><option>Low</option><option>Med</option><option>High</option></select></label>
          <label className="text-xs text-muted">Impact<select className="control mt-1.5 w-full" value={newRisk.impact} onChange={(e)=>setNewRisk({...newRisk,impact:e.target.value as NewRiskForm["impact"]})}><option>Low</option><option>Med</option><option>High</option></select></label>
          <label className="text-xs text-muted md:col-span-2">Risk / failure description<input className="control mt-1.5 w-full" value={newRisk.risk} onChange={(e)=>setNewRisk({...newRisk,risk:e.target.value})}/></label>
          <label className="text-xs text-muted md:col-span-2">Mitigation<input className="control mt-1.5 w-full" value={newRisk.mitigation} onChange={(e)=>setNewRisk({...newRisk,mitigation:e.target.value})}/></label>
          <label className="text-xs text-muted">Owner<input className="control mt-1.5 w-full" value={newRisk.owner} onChange={(e)=>setNewRisk({...newRisk,owner:e.target.value})}/></label>
          <label className="text-xs text-muted">S (1–10)<input inputMode="numeric" className="control mt-1.5 w-full" value={newRisk.severity} onChange={(e)=>setNewRisk({...newRisk,severity:e.target.value})}/></label>
          <label className="text-xs text-muted">O (1–10)<input inputMode="numeric" className="control mt-1.5 w-full" value={newRisk.occurrence} onChange={(e)=>setNewRisk({...newRisk,occurrence:e.target.value})}/></label>
          <label className="text-xs text-muted">D (1–10)<input inputMode="numeric" className="control mt-1.5 w-full" value={newRisk.detection} onChange={(e)=>setNewRisk({...newRisk,detection:e.target.value})}/></label>
          <label className="text-xs text-muted">Evidence confidence %<input inputMode="decimal" className="control mt-1.5 w-full" value={newRisk.evidenceConfidence} onChange={(e)=>setNewRisk({...newRisk,evidenceConfidence:e.target.value})}/></label>
          <label className="text-xs text-muted">Dependency impact 0–100<input inputMode="numeric" className="control mt-1.5 w-full" value={newRisk.dependencyImpact} onChange={(e)=>setNewRisk({...newRisk,dependencyImpact:e.target.value})}/></label>
          <label className="text-xs text-muted md:col-span-2">Affected governed objects<input className="control mt-1.5 w-full" value={newRisk.affectedObjects} onChange={(e)=>setNewRisk({...newRisk,affectedObjects:e.target.value})} placeholder="MAT-01, FEA-14, REL-03"/></label>
          <label className="text-xs text-muted">Provenance<select className="control mt-1.5 w-full" value={newRisk.provenanceClass} onChange={(e)=>setNewRisk({...newRisk,provenanceClass:e.target.value as NewRiskForm["provenanceClass"]})}><option value="measured">Measured</option><option value="calculated">Calculated</option><option value="derived">Derived</option><option value="assumed">Assumed</option><option value="predicted">Predicted</option><option value="ai_interpreted">AI-interpreted</option></select></label>
          <label className="text-xs text-muted md:col-span-2">Source / evidence reference<input className="control mt-1.5 w-full" value={newRisk.sourceReference} onChange={(e)=>setNewRisk({...newRisk,sourceReference:e.target.value})}/></label>
        </div>
        <button type="button" disabled={busy==="create" || !newRisk.id.trim() || !newRisk.risk.trim() || !newRisk.mitigation.trim() || !newRisk.sourceReference.trim()} onClick={()=>void createRisk()} className="mt-4 rounded bg-accent px-3 py-2 text-xs font-semibold text-bg disabled:opacity-40">Create governed risk</button>
      </div> : null}

      <div className="overflow-x-auto"><table className="w-full min-w-[1280px] text-sm"><thead className="border-b border-border text-[10px] uppercase tracking-wider text-subtle"><tr><th className="px-3 py-3 text-left">Risk</th><th className="px-3 py-3 text-left">Exposure</th><th className="px-3 py-3 text-left">FMEA</th><th className="px-3 py-3 text-left">Evidence</th><th className="px-3 py-3 text-left">Dependencies</th><th className="px-3 py-3 text-left">Mitigation / status</th><th className="px-3 py-3 text-left">Controls</th></tr></thead><tbody>{risks.map((row) => {
        const id = text(row,"id");
        const editing = editingId === id && form;
        const confidence = num(row,"evidence_confidence");
        const rpn = num(row,"fmea_rpn");
        const affected = list(row.affected_objects);
        return <Fragment key={id}>
          <tr className="border-t border-border/70 align-top">
            <td className="px-3 py-3"><p className="font-semibold">{text(row,"risk")}</p><p className="font-mono text-[10px] text-muted">{id} · {text(row,"domain") || "operational"}</p></td>
            <td className="px-3 py-3"><p className="font-semibold">{text(row,"likelihood")} × {text(row,"impact")}</p><p className="text-xs text-muted">score {text(row,"exposure_score") || "—"}</p></td>
            <td className="px-3 py-3"><p className="font-semibold">{rpn == null ? "Not rated" : `RPN ${rpn}`}</p><p className="text-xs text-muted">S {text(row,"severity")||"—"} · O {text(row,"occurrence")||"—"} · D {text(row,"detection")||"—"}</p></td>
            <td className="px-3 py-3"><p className="font-semibold">{pct(confidence)}</p><p className="text-xs text-muted">{evidenceConfidenceState(confidence)} · {text(row,"provenance_class") || "assumed"}</p><p className="mt-1 max-w-xs text-[10px] text-subtle">{text(row,"source_reference","sourceReference")}</p></td>
            <td className="px-3 py-3"><p className="font-semibold">{text(row,"dependency_impact") || "—"}</p><p className="max-w-xs text-xs text-muted">{affected.length ? affected.join(" · ") : "No governed objects linked"}</p></td>
            <td className="max-w-md px-3 py-3"><p className="text-muted">{text(row,"mitigation")}</p><p className="mt-1 text-xs font-semibold uppercase">{text(row,"status")}</p></td>
            <td className="px-3 py-3"><button type="button" disabled={busy === id} onClick={() => beginEdit(row)} className="rounded border border-border px-2.5 py-1.5 text-xs font-semibold hover:border-accent hover:text-accent disabled:opacity-40">Lifecycle</button></td>
          </tr>
          {editing ? <tr className="border-t border-border/70 bg-surface/60"><td colSpan={7} className="p-4"><div className="grid gap-3 md:grid-cols-[180px_1fr_1fr]"><label className="text-xs font-medium text-muted">Status<select className="control mt-1.5 w-full" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as RiskStatus })}><option value="open">Open</option><option value="mitigating">Mitigating</option><option value="accepted">Accepted</option><option value="closed">Closed</option></select></label><label className="text-xs font-medium text-muted">Mitigation<textarea className="control mt-1.5 w-full" rows={3} value={form.mitigation} onChange={(e) => setForm({ ...form, mitigation: e.target.value })}/></label><label className="text-xs font-medium text-muted">Source / evidence<textarea className="control mt-1.5 w-full" rows={3} value={form.sourceReference} onChange={(e) => setForm({ ...form, sourceReference: e.target.value })}/></label></div><div className="mt-3 flex gap-2"><button type="button" disabled={busy === id || !form.mitigation.trim() || !form.sourceReference.trim()} onClick={() => void save(row)} className="rounded bg-accent px-3 py-2 text-xs font-semibold text-bg disabled:opacity-40">Save audited change</button><button type="button" onClick={() => { setEditingId(""); setForm(null); }} className="rounded border border-border px-3 py-2 text-xs font-semibold">Cancel</button></div></td></tr> : null}
        </Fragment>;
      })}</tbody></table></div>
    </Panel>

    <Panel title="Risk History" kicker="Append-only audit evidence · latest 50 events">
      {loaded.history.length ? <div className="space-y-2">{loaded.history.slice(0,12).map((row) => <div key={text(row,"id")} className="grid gap-1 rounded-lg border border-border p-3 text-xs md:grid-cols-[180px_180px_1fr]"><span className="font-mono text-subtle">{text(row,"entity_id")} · R{text(row,"entity_revision")}</span><span className="font-semibold text-fg">{text(row,"action")}</span><span className="text-muted">{text(row,"previous_state")} {text(row,"previous_state") ? "→" : ""} {text(row,"new_state")} · {text(row,"actor_role")} · {text(row,"source_reference")}</span></div>)}</div> : <p className="text-sm text-muted">No risk audit events recorded yet.</p>}
    </Panel>

    <p className="text-xs text-muted">Canonical persistence: <code>vyndi_risk_register</code> / <code>vyndi_risk_intelligence</code>. VEDM authority issues are derived read-only signals. Risk, confidence and provenance remain separate; VYNDI does not infer unsupported probabilities.</p>
  </div>;
}
