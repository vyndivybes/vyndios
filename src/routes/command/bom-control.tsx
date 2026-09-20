import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Panel } from "@/components/kpi";
import { InventoryWorkspaceNav } from "@/components/inventory-workspace-nav";
import { createMasterData, listMasterData, transitionMasterData } from "@/lib/master-data-actions";
import { createEprMapping, listEprMappings } from "@/lib/epr/final-control";
import { getBomRevisionPropagationState, releaseControlledBomRevision } from "@/lib/bom-mapping-authority";
export const Route = createFileRoute("/command/bom-control")({ component: BomControl });
type R = {
  id: string;
  code: string;
  name: string;
  revision: number;
  status: string;
  attributes: any;
};
type M = {
  id: string;
  venture: string;
  model_id: string;
  bom_revision: string;
  bom_line_key: string;
  sku: string;
  quantity: number | string;
  unit: string;
  status: string;
};
type MappingDraft = {
  venture: "carbon" | "aluminium";
  modelId: "core" | "pro" | "apex";
  bomRevision: string;
  bomLineKey: string;
  sku: string;
  quantity: string;
  unit: string;
  notes: string;
};
function BomControl() {
  const [masters, setMasters] = useState<R[]>([]);
  const [maps, setMaps] = useState<M[]>([]);
  const [revisionState, setRevisionState] = useState<Record<string, unknown>[]>([]);
  const [jobImpact, setJobImpact] = useState<Record<string, unknown>[]>([]);
  const [releaseReason, setReleaseReason] = useState("");
  const [b, setB] = useState({
    code: "",
    name: "",
    venture: "carbon",
    model: "core",
    revision: "1",
  });
  const [m, setM] = useState<MappingDraft>({
    venture: "carbon",
    modelId: "core",
    bomRevision: "",
    bomLineKey: "",
    sku: "",
    quantity: "1",
    unit: "ea",
    notes: "",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function refresh() {
    try {
      const [a, c, propagation] = await Promise.all([listMasterData(), listEprMappings(), getBomRevisionPropagationState()]);
      setMasters((a as R[]).filter((x) => (x as any).domain === "bom"));
      setMaps(c as M[]);
      setRevisionState(propagation.current as Record<string, unknown>[]);
      setJobImpact(propagation.impact as Record<string, unknown>[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load BOM control.");
    }
  }
  useEffect(() => {
    void refresh();
  }, []);
  async function createBom() {
    setBusy(true);
    setError("");
    try {
      await createMasterData({
        data: {
          domain: "bom",
          code: b.code.trim(),
          name: b.name.trim(),
          revision: Number(b.revision),
          status: "draft",
          ownerRole: "engineering",
          approverRole: "engineering",
          effectiveFrom: null,
          sourceRef: "BOM_CONTROL",
          attributes: { venture: b.venture, modelId: b.model, bomRevision: String(Number(b.revision)), controlState: "controlled" },
        },
      });
      setB({ ...b, code: "", name: "" });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "BOM creation failed.");
    } finally {
      setBusy(false);
    }
  }
  async function move(id: string, toStatus: any) {
    setBusy(true);
    setError("");
    try {
      await transitionMasterData({ data: { id, toStatus, note: "BOM controlled workflow" } });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "BOM transition failed.");
    } finally {
      setBusy(false);
    }
  }
  async function addLine() {
    setBusy(true);
    setError("");
    try {
      await createEprMapping({ data: { ...m, quantity: Number(m.quantity) } });
      setM({ ...m, bomLineKey: "", sku: "", quantity: "1" });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Mapping failed.");
    } finally {
      setBusy(false);
    }
  }
  async function releaseRevision(row: R) {
    setBusy(true);
    setError("");
    try {
      const reason = releaseReason.trim();
      if (!reason) throw new Error("Enter the BOM revision release reason / engineering change reference.");
      const result = await releaseControlledBomRevision({
        data: {
          venture: row.attributes?.venture === "aluminium" ? "aluminium" : "carbon",
          modelId: String(row.attributes?.modelId ?? ""),
          bomRevision: String(row.revision),
          reason,
        },
      });
      setReleaseReason("");
      setError(
        `Released BOM ${result.bomRevision}. ${result.mappingCount} mapping(s) active; ${result.protectedJobCards} existing Job Card(s) remain frozen for controlled review.`,
      );
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "BOM revision release failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6 space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <p className="text-[10px] uppercase tracking-[0.22em] text-green">Engineering · controlled BOM</p>
          <h1 className="mt-2 text-4xl font-bold text-accent">BOM Control</h1>
          <p className="mt-2 max-w-3xl text-sm text-muted">BOM identity and requirements are controlled here. Costing remains a planning companion; approved Inventory Master mappings are the only execution relationship.</p>
        </div>
        <Link to="/command/inventory" className="rounded-lg border border-border px-4 py-2.5 text-sm">
          ← Inventory
        </Link>
      </header>
      <InventoryWorkspaceNav active="bom" />
      {error && <div className="rounded-lg border border-warn/40 p-3 text-sm text-warn">{error}</div>}
      <Panel title="Create BOM revision" kicker="Controlled master">
        <div className="grid gap-3 md:grid-cols-5">
          <input className="control" placeholder="BOM code" value={b.code} onChange={(e) => setB({ ...b, code: e.target.value })} />
          <input className="control" placeholder="Name" value={b.name} onChange={(e) => setB({ ...b, name: e.target.value })} />
          <select className="control" value={b.venture} onChange={(e) => setB({ ...b, venture: e.target.value })}>
            <option>carbon</option>
            <option>aluminium</option>
          </select>
          <select className="control" value={b.model} onChange={(e) => setB({ ...b, model: e.target.value })}>
            <option>core</option>
            <option>pro</option>
            <option>apex</option>
          </select>
          <input className="control" type="number" value={b.revision} onChange={(e) => setB({ ...b, revision: e.target.value })} />
        </div>
        <button disabled={busy || !b.code || !b.name} onClick={() => void createBom()} className="mt-3 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-bg">
          Add BOM draft
        </button>
      </Panel>
      <Panel title="BOM register" kicker={`${masters.length} revisions`}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[850px] text-sm">
            <thead>
              <tr className="border-b border-border text-[10px] uppercase text-subtle">
                <th className="px-3 py-3">Code</th>
                <th className="px-3 py-3">Name</th>
                <th className="px-3 py-3">Revision</th>
                <th className="px-3 py-3">Venture</th>
                <th className="px-3 py-3">Model</th>
                <th className="px-3 py-3">Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {masters.map((x) => (
                <tr key={x.id} className="border-t border-border/70">
                  <td className="px-3 py-3 font-mono">{x.code}</td>
                  <td className="px-3 py-3">{x.name}</td>
                  <td className="px-3 py-3">R{x.revision}</td>
                  <td className="px-3 py-3">{x.attributes?.venture}</td>
                  <td className="px-3 py-3">{x.attributes?.modelId}</td>
                  <td className="px-3 py-3 uppercase text-xs">{x.status}</td>
                  <td className="px-3 py-3">
                    {x.status === "draft" && (
                      <button onClick={() => void move(x.id, "pending_approval")} className="text-accent text-xs">
                        Submit
                      </button>
                    )}
                    {x.status === "pending_approval" && (
                      <button onClick={() => void move(x.id, "approved")} className="text-accent text-xs">
                        Approve master
                      </button>
                    )}
                    {x.status === "approved" && (
                      <button disabled={busy || !releaseReason.trim()} onClick={() => void releaseRevision(x)} className="text-green text-xs disabled:opacity-40">
                        Release revision
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel title="Revision release & downstream impact" kicker="One release authority · no silent Job Card rewrite">
        <div className="rounded-xl border border-border bg-surface/60 p-4 text-sm leading-6 text-muted">
          Releasing an approved BOM revision atomically supersedes the previous active revision for the same model scope. Procurement planning, bottom-up planned COGS and the next governed VIBPE run read the new active BOM immediately. Existing released/in-progress Job Cards retain their frozen BOM revision and mapping snapshot.
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto]">
          <input className="control" placeholder="Release reason / ECR / engineering change reference" value={releaseReason} onChange={(e) => setReleaseReason(e.target.value)} />
          <Link to="/command/procurement-planning" className="rounded-lg border border-border px-4 py-2.5 text-sm font-semibold text-accent">Open Procurement impact →</Link>
        </div>
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-xs">
            <thead className="border-b border-border text-[10px] uppercase tracking-wider text-subtle"><tr><th className="px-2 py-2">Scope</th><th className="px-2 py-2">Current BOM</th><th className="px-2 py-2 text-right">Lines</th><th className="px-2 py-2 text-right">Missing costs</th><th className="px-2 py-2 text-right">Bottom-up BOM cost</th><th className="px-2 py-2">Previous</th><th className="px-2 py-2">Release reason</th></tr></thead>
            <tbody>{revisionState.map((row)=>(
              <tr key={String(row.venture)+"|"+String(row.model_id)} className="border-t border-border/70">
                <td className="px-2 py-3">{String(row.venture)} · {String(row.model_id)}</td>
                <td className="px-2 py-3 font-mono">{String(row.bom_revision)}</td>
                <td className="px-2 py-3 text-right">{String(row.active_mapping_count ?? 0)}</td>
                <td className="px-2 py-3 text-right">{String(row.missing_cost_skus ?? 0)}</td>
                <td className="px-2 py-3 text-right">{row.governed_bom_cost_inr == null ? "Unresolved" : new Intl.NumberFormat("en-IN",{style:"currency",currency:"INR",maximumFractionDigits:0}).format(Number(row.governed_bom_cost_inr))}</td>
                <td className="px-2 py-3 font-mono">{String(row.previous_bom_revision ?? "—")}</td>
                <td className="px-2 py-3">{String(row.release_reason ?? "Legacy / line-level release")}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <div className="mt-5">
          <h3 className="text-sm font-semibold text-fg">Existing Job Card impact</h3>
          <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {jobImpact.filter((row)=>String(row.bom_revision_state)!=="CURRENT").map((row)=>(
              <article key={String(row.job_card_id)} className="rounded-xl border border-border p-4">
                <div className="flex items-start justify-between gap-3"><div><p className="font-mono text-xs text-accent">{String(row.job_card_id)}</p><p className="mt-1 text-sm font-semibold">{String(row.variant_id ?? row.model_tier ?? "model")}</p></div><span className={`text-[10px] font-semibold uppercase ${String(row.bom_revision_state)==="PROTECTED_FROZEN"?"text-green":"text-warn"}`}>{String(row.bom_revision_state).replaceAll("_"," ")}</span></div>
                <p className="mt-3 text-xs text-muted">Frozen BOM <span className="font-mono">{String(row.frozen_bom_revision ?? "—")}</span> → current <span className="font-mono">{String(row.current_bom_revision ?? "—")}</span></p>
                <p className="mt-1 text-xs text-muted">Frozen mapping snapshot: {String(row.frozen_mapping_count ?? 0)} line(s)</p>
              </article>
            ))}
            {!jobImpact.some((row)=>String(row.bom_revision_state)!=="CURRENT") ? <p className="text-sm text-muted">No existing Job Card is behind the current released BOM.</p> : null}
          </div>
        </div>
      </Panel>

      <Panel title="Add component requirement" kicker="BOM → approved Inventory SKU">
        <div className="grid gap-3 md:grid-cols-6">
          <select className="control" value={m.venture} onChange={(e) => setM({ ...m, venture: e.target.value as MappingDraft["venture"] })}>
            <option>carbon</option>
            <option>aluminium</option>
          </select>
          <select className="control" value={m.modelId} onChange={(e) => setM({ ...m, modelId: e.target.value as MappingDraft["modelId"] })}>
            <option>core</option>
            <option>pro</option>
            <option>apex</option>
          </select>
          <input className="control" placeholder="BOM revision" value={m.bomRevision} onChange={(e) => setM({ ...m, bomRevision: e.target.value })} />
          <input className="control" placeholder="Component key" value={m.bomLineKey} onChange={(e) => setM({ ...m, bomLineKey: e.target.value })} />
          <input className="control" placeholder="Approved SKU" value={m.sku} onChange={(e) => setM({ ...m, sku: e.target.value })} />
          <input className="control" type="number" min="0.01" step="0.01" value={m.quantity} onChange={(e) => setM({ ...m, quantity: e.target.value })} />
        </div>
        <div className="mt-3 flex gap-3">
          <select className="control max-w-[120px]" value={m.unit} onChange={(e) => setM({ ...m, unit: e.target.value })}>
            <option>ea</option>
            <option>pair</option>
            <option>set</option>
            <option>m</option>
            <option>kg</option>
          </select>
          <button disabled={busy || !m.bomRevision || !m.bomLineKey || !m.sku} onClick={() => void addLine()} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-bg">
            Add component
          </button>
        </div>
      </Panel>
      <Panel title="Component register" kicker={`${maps.length} mappings · draft lines activate only through Revision Release`}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px] text-sm">
            <thead>
              <tr className="border-b border-border text-[10px] uppercase text-subtle">
                <th className="px-3 py-3">Venture</th>
                <th>Model</th>
                <th>BOM</th>
                <th>Component</th>
                <th>SKU</th>
                <th>Qty</th>
                <th>Unit</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {maps.map((x) => (
                <tr key={x.id} className="border-t border-border/70">
                  <td className="px-3 py-3">{x.venture}</td>
                  <td>{x.model_id}</td>
                  <td>{x.bom_revision}</td>
                  <td className="font-mono text-xs">{x.bom_line_key}</td>
                  <td className="font-mono text-xs">{x.sku}</td>
                  <td>{Number(x.quantity)}</td>
                  <td>{x.unit}</td>
                  <td className="uppercase text-xs">{x.status}</td>
                  <td className="text-xs text-muted">
                    {x.status === "draft" ? "Awaiting revision release" : x.status === "active" ? "Released" : "Historical"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <div className="text-xs text-muted">Controlled flow: approved BOM master → coherent revision release → active planning/procurement/VIBPE BOM. Production Job Cards preserve their released BOM snapshot until an explicit controlled production change is authorized.</div>
    </main>
  );
}
