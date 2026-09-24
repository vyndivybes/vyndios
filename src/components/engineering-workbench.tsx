import { useMemo, useState } from "react";
import { VayuMark } from "@/components/brand-lockup";
import {
  CURRENT_SIZE_GEOMETRY,
  DATUM_NODES,
  DEPENDENCY_STAGES,
  INTERFACE_CONTROLS,
  MATERIAL_GATES,
  TUBE_DEFINITIONS,
  WORKBENCH_REVISIONS,
  type TubeKey,
  type WorkbenchSize,
} from "@/lib/engineering-workbench";

type StageState = "current" | "stale" | "blocked";
type WorkbenchTab = "Design" | "Geometry" | "Clearance & Fit" | "Structure" | "Laminate" | "Manufacturing" | "Validation";

const TABS: readonly WorkbenchTab[] = [
  "Design",
  "Geometry",
  "Clearance & Fit",
  "Structure",
  "Laminate",
  "Manufacturing",
  "Validation",
];

const stateClass: Record<StageState, string> = {
  current: "border-green/40 bg-green/10 text-green",
  stale: "border-amber-400/40 bg-amber-400/10 text-amber-300",
  blocked: "border-red-400/40 bg-red-400/10 text-red-300",
};

const interfaceClass = {
  controlled: "text-green",
  pending: "text-amber-300",
  blocked: "text-red-300",
} as const;

function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  unit = "",
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (next: number) => void;
}) {
  return (
    <label className="grid grid-cols-[minmax(0,1fr)_110px] items-center gap-3 text-xs">
      <span className="min-w-0">
        <span className="block text-[10px] font-semibold uppercase tracking-[0.12em] text-subtle">{label}</span>
        <input
          aria-label={label}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
          className="mt-2 w-full accent-current"
        />
      </span>
      <span className="rounded-md border border-border bg-bg/70 px-2 py-2 text-right font-mono text-[11px] text-accent">
        {Number.isInteger(value) ? value : value.toFixed(2)}{unit}
      </span>
    </label>
  );
}

function StatusPill({ state, label }: { state: StageState; label?: string }) {
  return (
    <span className={`inline-flex rounded-full border px-2 py-1 text-[9px] font-bold uppercase tracking-[0.12em] ${stateClass[state]}`}>
      {label ?? state}
    </span>
  );
}

function FrameSchematic({
  reach,
  stack,
  chainstay,
  headAngle,
  datum,
}: {
  reach: number;
  stack: number;
  chainstay: number;
  headAngle: number;
  datum: string;
}) {
  const sy = 214;
  const rearX = 34;
  const bbX = 184;
  const bbY = 214;
  const seatTopX = 154;
  const seatTopY = 76;
  const headBottomX = 378 + (reach - 388) * 0.55;
  const headBottomY = 153 - (stack - 555) * 0.12;
  const headTopX = headBottomX - 22 + (headAngle - 72) * 2;
  const headTopY = 64 - (stack - 555) * 0.16;
  const rearAxleX = rearX - (chainstay - 418) * 0.18;
  const datumPoints: Record<string, [number, number]> = {
    BB0: [bbX, bbY],
    "HT Upper": [headTopX, headTopY],
    "HT Lower": [headBottomX, headBottomY],
    "DT-HT": [headBottomX - 5, headBottomY + 8],
    "TT-HT": [headTopX - 4, headTopY + 8],
    "ST-TT": [seatTopX, seatTopY],
    "Rear Axle": [rearAxleX, sy],
    "Front Axle": [468, sy],
    "Fork Crown": [headBottomX + 14, headBottomY - 18],
  };
  const selected = datumPoints[datum] ?? [bbX, bbY];

  return (
    <svg viewBox="0 0 510 265" role="img" aria-label="Governed VYNDI frame working schematic" className="h-full min-h-[250px] w-full">
      <defs>
        <linearGradient id="vyndi-frame" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity=".45" />
          <stop offset="55%" stopColor="currentColor" stopOpacity=".95" />
          <stop offset="100%" stopColor="currentColor" stopOpacity=".45" />
        </linearGradient>
      </defs>
      <g fill="none" stroke="currentColor" className="text-border">
        <circle cx={rearAxleX} cy={sy} r="73" strokeWidth="1.5" />
        <circle cx="468" cy={sy} r="73" strokeWidth="1.5" />
      </g>
      <g fill="none" stroke="url(#vyndi-frame)" className="text-accent" strokeLinecap="round" strokeLinejoin="round">
        <path d={`M ${rearAxleX} ${sy} L ${bbX} ${bbY} L ${headBottomX} ${headBottomY} L ${headTopX} ${headTopY} L ${seatTopX} ${seatTopY} L ${bbX} ${bbY}`} strokeWidth="15" />
        <path d={`M ${rearAxleX} ${sy} L ${seatTopX} ${seatTopY}`} strokeWidth="9" />
        <path d={`M ${headTopX} ${headTopY} L ${468} ${sy}`} strokeWidth="10" />
      </g>
      <g fill="none" stroke="currentColor" className="text-green">
        <circle cx={selected[0]} cy={selected[1]} r="10" strokeWidth="2" />
        <circle cx={selected[0]} cy={selected[1]} r="4" strokeWidth="2" />
      </g>
      <text x="12" y="22" className="fill-subtle text-[10px]">SCHEMATIC · NOT CAD / NOT FEA</text>
      <text x="12" y="39" className="fill-muted text-[10px]">Selected datum: {datum}</text>
      <text x="12" y="56" className="fill-muted text-[10px]">Reach {reach} · Stack {stack} · HA {headAngle.toFixed(1)}°</text>
    </svg>
  );
}

function GateList({ items, blocked = false }: { items: readonly string[]; blocked?: boolean }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {items.map((item) => (
        <div key={item} className="flex items-start gap-2 rounded-lg border border-border bg-bg/45 p-3">
          <span className={`mt-0.5 size-2 shrink-0 rounded-full ${blocked ? "bg-red-400" : "bg-amber-300"}`} />
          <p className="text-xs leading-5 text-muted">{item}</p>
        </div>
      ))}
    </div>
  );
}

export function EngineeringWorkbench() {
  const [tab, setTab] = useState<WorkbenchTab>("Design");
  const [revision, setRevision] = useState("5.4 FK75");
  const [size, setSize] = useState<WorkbenchSize>("M");
  const [tyre, setTyre] = useState(40);
  const [tube, setTube] = useState<TubeKey>("DT");
  const [station, setStation] = useState(60);
  const [datum, setDatum] = useState("BB0");
  const [reachDelta, setReachDelta] = useState(0);
  const [stackDelta, setStackDelta] = useState(0);
  const [headAngleDelta, setHeadAngleDelta] = useState(0);
  const [bbDropDelta, setBbDropDelta] = useState(0);
  const [dtHtShift, setDtHtShift] = useState(0);
  const [tubeDelta, setTubeDelta] = useState({ width: 0, depth: 0, truncation: 0, rotation: 0 });
  const [geometryDirty, setGeometryDirty] = useState(false);

  const base = CURRENT_SIZE_GEOMETRY.find((item) => item.size === size) ?? CURRENT_SIZE_GEOMETRY[2];
  const tubeBase = TUBE_DEFINITIONS.find((item) => item.key === tube) ?? TUBE_DEFINITIONS[0];
  const revisionMeta = WORKBENCH_REVISIONS.find((item) => item.id === revision) ?? WORKBENCH_REVISIONS[2];

  const working = {
    reach: base.reachMm + reachDelta,
    stack: base.stackMm + stackDelta,
    headAngle: base.headAngleDeg + headAngleDelta,
    bbDrop: base.bbDropMm + bbDropDelta,
  };

  const stageStates = useMemo<Record<string, StageState>>(() => {
    const states: Record<string, StageState> = {
      Geometry: geometryDirty ? "stale" : "current",
      Clearance: geometryDirty ? "stale" : "blocked",
      Mesh: "blocked",
      FEA: "blocked",
      Laminate: "blocked",
      Manufacturing: "blocked",
      Validation: "blocked",
    };
    return states;
  }, [geometryDirty]);

  const markGeometryDirty = () => setGeometryDirty(true);
  const resetWorkingCopy = () => {
    setReachDelta(0);
    setStackDelta(0);
    setHeadAngleDelta(0);
    setBbDropDelta(0);
    setDtHtShift(0);
    setTubeDelta({ width: 0, depth: 0, truncation: 0, rotation: 0 });
    setGeometryDirty(false);
  };

  const tyreGate = tyre >= 40 ? "blocked" : "pending";

  return (
    <section className="overflow-hidden rounded-2xl border border-accent/25 bg-surface/55 shadow-sm" data-engineering-workbench="vyndi">
      <div className="border-b border-border bg-bg/70 px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <VayuMark decorative className="size-10" />
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-green">Vāyú Shastr Pvt Ltd · VYNDI OS</p>
              <h2 className="truncate font-display text-2xl text-accent">VAEA Engineering Workbench</h2>
              <p className="mt-1 text-[11px] text-muted">Governed working configuration · edits do not become released engineering automatically.</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[10px]">
            <StatusPill state="current" label="Authority loaded" />
            <StatusPill state="blocked" label="Production release blocked" />
          </div>
        </div>
      </div>

      <div className="border-b border-border bg-bg/45 px-2 py-2">
        <div className="flex gap-1 overflow-x-auto">
          {TABS.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setTab(item)}
              className={`shrink-0 rounded-md px-3 py-2 text-[10px] font-bold uppercase tracking-[0.08em] transition ${tab === item ? "bg-accent text-bg" : "border border-border bg-surface/55 text-muted hover:border-accent/45 hover:text-accent"}`}
            >
              {item}
            </button>
          ))}
        </div>
      </div>

      <div className="grid min-h-[620px] xl:grid-cols-[330px_minmax(0,1fr)_360px]">
        <aside className="border-b border-border p-4 xl:border-b-0 xl:border-r">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-subtle">Configuration / baseline</p>
            <div className="mt-2 grid gap-2">
              {WORKBENCH_REVISIONS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setRevision(item.id)}
                  className={`rounded-lg border p-3 text-left transition ${revision === item.id ? "border-accent/60 bg-accent/10" : "border-border bg-bg/45 hover:border-accent/35"}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-fg">{item.label}</span>
                    <span className={`text-[9px] font-bold uppercase ${item.status === "controlled" ? "text-green" : "text-accent"}`}>{item.status}</span>
                  </div>
                  <p className="mt-1 text-[10px] leading-4 text-muted">{item.role.replaceAll("-", " ")}</p>
                </button>
              ))}
            </div>
            <p className="mt-2 rounded-lg border border-border bg-bg/45 p-3 text-[10px] leading-4 text-muted">{revisionMeta.note}</p>
          </div>

          <div className="mt-5">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-subtle">Size</p>
            <div className="mt-2 grid grid-cols-5 gap-1">
              {CURRENT_SIZE_GEOMETRY.map((item) => (
                <button
                  key={item.size}
                  type="button"
                  onClick={() => {
                    setSize(item.size);
                    resetWorkingCopy();
                  }}
                  className={`rounded-md border px-2 py-2 text-xs font-semibold ${size === item.size ? "border-accent bg-accent text-bg" : "border-border bg-bg/45 text-muted"}`}
                >
                  {item.size}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-5 space-y-3">
            <Slider label="Reach" value={working.reach} min={base.reachMm - 20} max={base.reachMm + 20} unit=" mm" onChange={(value) => { setReachDelta(value - base.reachMm); markGeometryDirty(); }} />
            <Slider label="Stack" value={working.stack} min={base.stackMm - 20} max={base.stackMm + 20} unit=" mm" onChange={(value) => { setStackDelta(value - base.stackMm); markGeometryDirty(); }} />
            <Slider label="Head angle" value={working.headAngle} min={base.headAngleDeg - 2} max={base.headAngleDeg + 2} step={0.1} unit="°" onChange={(value) => { setHeadAngleDelta(value - base.headAngleDeg); markGeometryDirty(); }} />
            <Slider label="BB drop" value={working.bbDrop} min={base.bbDropMm - 8} max={base.bbDropMm + 8} unit=" mm" onChange={(value) => { setBbDropDelta(value - base.bbDropMm); markGeometryDirty(); }} />
            <Slider label="DT / HT junction shift" value={dtHtShift} min={-12} max={20} unit=" mm" onChange={(value) => { setDtHtShift(value); markGeometryDirty(); }} />
          </div>

          <div className="mt-5">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-subtle">Tyre envelope</p>
            <div className="mt-2 grid grid-cols-4 gap-1">
              {[28, 32, 35, 40].map((value) => (
                <button key={value} type="button" onClick={() => { setTyre(value); markGeometryDirty(); }} className={`rounded-md border px-2 py-2 text-[11px] ${tyre === value ? "border-accent bg-accent/10 text-accent" : "border-border text-muted"}`}>{value}</button>
              ))}
            </div>
            <p className={`mt-2 text-[10px] font-semibold uppercase ${tyreGate === "blocked" ? "text-red-300" : "text-amber-300"}`}>
              {tyre >= 40 ? "TC-04 release gate open — 700×40 proof required" : "Development tyre selection — recalc required"}
            </p>
          </div>

          <button type="button" onClick={resetWorkingCopy} className="mt-5 w-full rounded-lg border border-border px-3 py-2 text-xs font-semibold text-muted hover:border-accent/45 hover:text-accent">
            Reset working copy to authority
          </button>
        </aside>

        <div className="min-w-0 border-b border-border p-4 xl:border-b-0 xl:border-r">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              ["Reach", `${working.reach} mm`],
              ["Stack", `${working.stack} mm`],
              ["Trail", `${base.trailMm.toFixed(1)} mm`],
              ["A-C study", `${base.axleToCrownStudyMm} mm`],
              ["Chainstay", `${base.chainstayMm} mm`],
              ["BB drop", `${working.bbDrop} mm`],
              ["Fork offset", `${base.forkOffsetMm} mm`],
              ["Fork/tyre nominal", `${base.nominalForkTyreClearanceMm.toFixed(2)} mm`],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-border bg-bg/45 p-3">
                <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-subtle">{label}</p>
                <p className="mt-1 font-mono text-sm font-semibold text-accent">{value}</p>
              </div>
            ))}
          </div>

          {tab === "Design" || tab === "Geometry" ? (
            <>
              <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(300px,.8fr)]">
                <div className="rounded-xl border border-border bg-bg/55 p-3">
                  <FrameSchematic reach={working.reach} stack={working.stack} chainstay={base.chainstayMm} headAngle={working.headAngle} datum={datum} />
                </div>
                <div className="rounded-xl border border-border bg-bg/55 p-4">
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-subtle">Datum / node manager</p>
                  <select value={datum} onChange={(event) => setDatum(event.target.value)} className="mt-3 w-full rounded-lg border border-border bg-bg px-3 py-2 text-xs text-fg">
                    {DATUM_NODES.map((node) => <option key={node}>{node}</option>)}
                  </select>
                  <div className="mt-4 space-y-2 text-xs">
                    <p className="flex justify-between gap-3"><span className="text-muted">Selected node</span><span className="font-mono text-accent">{datum}</span></p>
                    <p className="flex justify-between gap-3"><span className="text-muted">Geometry state</span><span className={geometryDirty ? "text-amber-300" : "text-green"}>{geometryDirty ? "working copy changed" : "authority current"}</span></p>
                    <p className="flex justify-between gap-3"><span className="text-muted">DT/HT shift</span><span className="font-mono">{dtHtShift >= 0 ? "+" : ""}{dtHtShift} mm</span></p>
                  </div>
                  <p className="mt-4 text-[10px] leading-4 text-muted">Node coordinates, CAD patch IDs, laminate patches and FEA sets are intentionally not fabricated here; those fields remain evidence-linked once the controlled CAD/solver data is connected.</p>
                </div>
              </div>

              <div className="mt-4 rounded-xl border border-border bg-bg/55 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-subtle">VAEA tube shape studio</p>
                    <p className="mt-1 text-xs text-muted">Station-based working controls across every primary frame member.</p>
                  </div>
                  <span className="text-[10px] font-semibold uppercase text-amber-300">Working-copy geometry · CAD sync required</span>
                </div>
                <div className="mt-3 flex gap-1 overflow-x-auto">
                  {TUBE_DEFINITIONS.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => { setTube(item.key); setTubeDelta({ width: 0, depth: 0, truncation: 0, rotation: 0 }); }}
                      className={`shrink-0 rounded-md border px-3 py-2 text-[10px] font-semibold ${tube === item.key ? "border-accent bg-accent/10 text-accent" : "border-border text-muted"}`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
                <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_280px]">
                  <div className="space-y-3">
                    <Slider label="Max width" value={tubeBase.widthMm + tubeDelta.width} min={Math.max(12, tubeBase.widthMm - 15)} max={tubeBase.widthMm + 20} unit=" mm" onChange={(value) => { setTubeDelta((old) => ({ ...old, width: value - tubeBase.widthMm })); markGeometryDirty(); }} />
                    <Slider label="Max depth" value={tubeBase.depthMm + tubeDelta.depth} min={Math.max(20, tubeBase.depthMm - 30)} max={tubeBase.depthMm + 35} unit=" mm" onChange={(value) => { setTubeDelta((old) => ({ ...old, depth: value - tubeBase.depthMm })); markGeometryDirty(); }} />
                    <Slider label="Truncation" value={tubeBase.truncationPct + tubeDelta.truncation} min={0} max={50} unit="%" onChange={(value) => { setTubeDelta((old) => ({ ...old, truncation: value - tubeBase.truncationPct })); markGeometryDirty(); }} />
                    <Slider label="Rotation" value={tubeBase.rotationDeg + tubeDelta.rotation} min={-20} max={20} unit="°" onChange={(value) => { setTubeDelta((old) => ({ ...old, rotation: value - tubeBase.rotationDeg })); markGeometryDirty(); }} />
                  </div>
                  <div className="rounded-lg border border-border bg-surface/45 p-4">
                    <p className="text-xs font-semibold text-accent">{tubeBase.architecture}</p>
                    <p className="mt-4 text-[9px] font-bold uppercase tracking-[0.12em] text-subtle">Station</p>
                    <div className="mt-2 grid grid-cols-3 gap-1">
                      {tubeBase.stations.map((value) => (
                        <button key={value} type="button" onClick={() => setStation(value)} className={`rounded border px-2 py-2 text-[10px] ${station === value ? "border-green/50 bg-green/10 text-green" : "border-border text-muted"}`}>{value}%</button>
                      ))}
                    </div>
                    <p className="mt-4 text-[10px] leading-4 text-muted">Selected {tubeBase.label} station: <span className="font-semibold text-fg">{station}%</span>. Intersection trim/blend, OML/IML and manufacturable-radius data remain explicit downstream evidence requirements.</p>
                  </div>
                </div>
              </div>
            </>
          ) : null}

          {tab === "Clearance & Fit" ? (
            <div className="mt-4 space-y-4">
              <div className="rounded-xl border border-red-400/30 bg-red-400/5 p-4">
                <p className="text-xs font-semibold text-red-200">Assembly collision engine is evidence-gated.</p>
                <p className="mt-1 text-[11px] leading-5 text-muted">The workbench now carries the required interface register, but PASS/FAIL values will not be invented until controlled assembly geometry is attached.</p>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {INTERFACE_CONTROLS.map((item) => (
                  <article key={item.id} className="rounded-xl border border-border bg-bg/55 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div><p className="font-mono text-[9px] text-subtle">{item.id}</p><h3 className="mt-1 text-sm font-semibold text-fg">{item.label}</h3></div>
                      <span className={`text-[9px] font-bold uppercase ${interfaceClass[item.state]}`}>{item.state}</span>
                    </div>
                    <p className="mt-3 text-xs leading-5 text-muted">{item.requirement}</p>
                    <p className="mt-3 border-t border-border pt-3 text-[10px] leading-4 text-subtle">{item.evidence}</p>
                  </article>
                ))}
              </div>
            </div>
          ) : null}

          {tab === "Structure" ? (
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <div className="rounded-xl border border-border bg-bg/55 p-4">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-subtle">Solver provenance</p>
                <h3 className="mt-2 text-lg font-semibold text-fg">No native solver run attached</h3>
                <p className="mt-2 text-xs leading-5 text-muted">Stress, displacement, stiffness and Tsai–Wu surfaces remain BLOCKED until a mesh-converged solver result identifies model revision, mesh, boundary conditions, loads, material revision, laminate revision and run evidence.</p>
                <div className="mt-4"><StatusPill state="blocked" label="FEA blocked" /></div>
              </div>
              <div className="rounded-xl border border-border bg-bg/55 p-4">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-subtle">Required load-case provenance</p>
                <GateList items={["LC01 vertical", "LC02 cornering", "LC03 front braking", "LC04 torsion", "LC05 impact / applicable ISO cases", "Mesh-convergence evidence"]} blocked />
              </div>
            </div>
          ) : null}

          {tab === "Laminate" ? (
            <div className="mt-4 space-y-4">
              <div className="rounded-xl border border-amber-400/30 bg-amber-400/5 p-4">
                <p className="text-sm font-semibold text-amber-200">MATERIAL-01 qualification remains open.</p>
                <p className="mt-1 text-xs leading-5 text-muted">Published fibre data is not being treated as laminate structural allowables. The workbench will unlock failure-index and ply-sizing authority only after the qualified prepreg/process dataset is recorded.</p>
              </div>
              <GateList items={MATERIAL_GATES} />
            </div>
          ) : null}

          {tab === "Manufacturing" ? (
            <div className="mt-4">
              <GateList items={["Mould split / demould direction", "Bladder or core strategy", "Ply cut / nesting definition", "Layup + debulk sequence", "Cure cycle trace", "Trim / drilling / insert operations", "Dimensional QC + NDT plan", "DFM review linked to CAD patches"]} />
            </div>
          ) : null}

          {tab === "Validation" ? (
            <div className="mt-4">
              <GateList items={["Requirement → simulation mapping", "Prototype serial/configuration record", "Dimensional inspection", "NDT evidence", "Applicable ISO 4210 physical tests", "Measured result vs predicted result", "FEA/test correlation", "Formal engineering release approval"]} blocked />
            </div>
          ) : null}
        </div>

        <aside className="p-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-subtle">Design change → consequence</p>
          <div className="mt-3 space-y-2">
            {DEPENDENCY_STAGES.map((stage, index) => {
              const state = stageStates[stage] ?? "blocked";
              return (
                <div key={stage} className="flex items-center gap-2">
                  <div className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-bg text-[10px] font-bold text-muted">{index + 1}</div>
                  <div className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-lg border border-border bg-bg/45 px-3 py-2">
                    <span className="text-xs font-semibold text-fg">{stage}</span>
                    <StatusPill state={state} />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-5 rounded-xl border border-amber-400/30 bg-amber-400/5 p-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-amber-200">Stale-result interlock</p>
            <p className="mt-2 text-xs leading-5 text-muted">
              {geometryDirty
                ? "Geometry has changed. Clearance, mesh, FEA, laminate, manufacturing and validation evidence must be regenerated or re-verified before any release decision."
                : "Working geometry matches the loaded authority. Downstream evidence is still blocked where the controlled repository has open gates."}
            </p>
          </div>

          <div className="mt-5 rounded-xl border border-border bg-bg/55 p-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-subtle">VIBPE Co-Pilot governance</p>
            <div className="mt-3 space-y-3 text-xs leading-5 text-muted">
              <p><span className="font-semibold text-fg">Authority:</span> E-K75 frame geometry + FK75 preferred front-end development.</p>
              <p><span className="font-semibold text-fg">Working edit:</span> {geometryDirty ? "Local UI working copy diverges from authority." : "No divergence."}</p>
              <p><span className="font-semibold text-fg">Material:</span> T700/T800 working platform; qualified commercial prepreg/process allowables not yet released.</p>
              <p><span className="font-semibold text-fg">Release:</span> No UI action here can convert development data into production authority.</p>
            </div>
          </div>

          <div className="mt-5 rounded-xl border border-border bg-bg/55 p-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-subtle">Current interface focus</p>
            <dl className="mt-3 space-y-2 text-xs">
              <div className="flex justify-between gap-3"><dt className="text-muted">T47i shell</dt><dd className="font-mono text-fg">85.5 mm</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted">Seatpost</dt><dd className="font-mono text-fg">Ø27.2</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted">Headset</dt><dd className="font-mono text-fg">IS41 / IS52</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted">Rear axle</dt><dd className="font-mono text-fg">12×142</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted">Front axle</dt><dd className="font-mono text-fg">12×100</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted">Tyre UI</dt><dd className="font-mono text-fg">700×{tyre}</dd></div>
            </dl>
          </div>
        </aside>
      </div>
    </section>
  );
}
