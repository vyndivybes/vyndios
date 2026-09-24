import { createFileRoute, Link } from "@tanstack/react-router";
import { Kpi, Panel } from "@/components/kpi";
import { listEngineeringAuthority } from "@/lib/engineering-authority";

type Row = Record<string, unknown>;

const text = (row: Row, ...keys: string[]) => {
  for (const key of keys) if (row[key] != null) return String(row[key]);
  return "";
};

function baselineView(row: Row): Row {
  return {
    id: text(row, "id"),
    family_code: text(row, "family_code"),
    family_name: text(row, "family_name", "familyName"),
    variant_id: text(row, "variant_id"),
    variant_name: text(row, "variant_name", "variantName"),
    revision_code: text(row, "revision_code", "revisionCode"),
    geometry_ref: text(row, "geometry_ref", "geometryRef"),
    material_spec: text(row, "material_spec", "materialSpec"),
    tooling_ref: text(row, "tooling_ref", "toolingRef"),
    drawing_ref: text(row, "drawing_ref", "drawingRef"),
    bom_revision: text(row, "bom_revision", "bomRevision"),
    status: text(row, "status"),
  };
}

function changeView(row: Row): Row {
  return {
    id: text(row, "id"),
    family_code: text(row, "family_code"),
    family_name: text(row, "family_name", "familyName"),
    variant_id: text(row, "variant_id"),
    variant_name: text(row, "variant_name", "variantName"),
    target_revision_code: text(row, "target_revision_code", "targetRevisionCode"),
    reason: text(row, "reason"),
    status: text(row, "status"),
  };
}

export const Route = createFileRoute("/command/engineering")({
  ssr: "data-only",
  loader: async () => {
    const data = await listEngineeringAuthority();
    return {
      vedmAuthority: data.vedmAuthority,
      baselines: (Array.isArray(data.baselines) ? data.baselines : []).map((row) => baselineView(row as Row)),
      changes: (Array.isArray(data.changes) ? data.changes : []).map((row) => changeView(row as Row)),
    };
  },
  component: Engineering,
});

function BaselineRecord({ row }: { row: Row }) {
  const family = text(row, "family_name", "familyName", "family_code");
  const variant = text(row, "variant_name", "variantName", "variant_id") || "Family baseline";
  const revision = text(row, "revision_code", "revisionCode");
  const geometry = text(row, "geometry_ref", "geometryRef");
  const material = text(row, "material_spec", "materialSpec");
  const tooling = text(row, "tooling_ref", "toolingRef") || "—";
  const drawing = text(row, "drawing_ref", "drawingRef");
  const bom = text(row, "bom_revision", "bomRevision") || "—";
  const status = text(row, "status");

  return (
    <article className="rounded-lg border border-border/80 bg-bg/45 p-3 transition-colors hover:bg-surface/45">
      <div className="hidden grid-cols-[minmax(0,1.25fr)_minmax(0,.65fr)_minmax(0,1.45fr)_minmax(0,1fr)_minmax(0,1.25fr)_minmax(0,.75fr)] items-start gap-3 lg:grid">
        <div className="min-w-0">
          <p className="break-words text-xs font-semibold text-fg">{family}</p>
          <p className="mt-1 break-words text-[10px] leading-4 text-muted">{variant}</p>
        </div>
        <p className="min-w-0 break-all text-xs font-semibold text-accent">{revision}</p>
        <div className="min-w-0 text-[11px] leading-4 text-muted">
          <p className="break-all">{geometry || "—"}</p>
          <p className="mt-1 break-words">{material || "—"}</p>
        </div>
        <p className="min-w-0 break-all text-[11px] leading-4 text-muted">{tooling}</p>
        <div className="min-w-0 text-[11px] leading-4 text-muted">
          <p className="break-all">{drawing || "—"}</p>
          <p className="mt-1 break-all">BOM {bom}</p>
        </div>
        <p className="min-w-0 break-words text-[10px] font-semibold uppercase text-green">{status}</p>
      </div>

      <div className="space-y-3 lg:hidden">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="break-words text-sm font-semibold text-fg">{family}</p>
            <p className="mt-1 break-words text-[10px] text-muted">{variant}</p>
          </div>
          <span className="shrink-0 text-[10px] font-semibold uppercase text-green">{status}</span>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs sm:grid-cols-3">
          <div className="min-w-0">
            <p className="text-[9px] font-semibold uppercase tracking-wider text-subtle">Revision</p>
            <p className="mt-1 break-all font-semibold text-accent">{revision}</p>
          </div>
          <div className="min-w-0">
            <p className="text-[9px] font-semibold uppercase tracking-wider text-subtle">Geometry</p>
            <p className="mt-1 break-all text-muted">{geometry || "—"}</p>
          </div>
          <div className="min-w-0">
            <p className="text-[9px] font-semibold uppercase tracking-wider text-subtle">Material</p>
            <p className="mt-1 break-words text-muted">{material || "—"}</p>
          </div>
          <div className="min-w-0">
            <p className="text-[9px] font-semibold uppercase tracking-wider text-subtle">Tooling</p>
            <p className="mt-1 break-all text-muted">{tooling}</p>
          </div>
          <div className="min-w-0 sm:col-span-2">
            <p className="text-[9px] font-semibold uppercase tracking-wider text-subtle">Drawing / BOM</p>
            <p className="mt-1 break-all text-muted">{drawing || "—"} · BOM {bom}</p>
          </div>
        </div>
      </div>
    </article>
  );
}

function ChangeRecord({ row }: { row: Row }) {
  const id = text(row, "id");
  const family = text(row, "family_name", "familyName", "family_code");
  const target = text(row, "target_revision_code", "targetRevisionCode");
  const reason = text(row, "reason");
  const status = text(row, "status");

  return (
    <article className="rounded-lg border border-border/80 bg-bg/45 p-3 transition-colors hover:bg-surface/45">
      <div className="hidden grid-cols-[minmax(0,.9fr)_minmax(0,1fr)_minmax(0,.8fr)_minmax(0,2fr)_minmax(0,.75fr)] items-start gap-3 lg:grid">
        <p className="min-w-0 break-all font-mono text-[11px] text-accent">{id}</p>
        <p className="min-w-0 break-words text-xs text-fg">{family}</p>
        <p className="min-w-0 break-all text-xs text-fg">{target || "—"}</p>
        <p className="min-w-0 break-words text-[11px] leading-4 text-muted">{reason || "—"}</p>
        <p className="min-w-0 break-words text-[10px] font-semibold uppercase text-fg">{status}</p>
      </div>

      <div className="space-y-3 lg:hidden">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <p className="min-w-0 break-all font-mono text-xs text-accent">{id}</p>
          <span className="shrink-0 text-[10px] font-semibold uppercase text-fg">{status}</span>
        </div>
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div className="min-w-0">
            <p className="text-[9px] font-semibold uppercase tracking-wider text-subtle">Family</p>
            <p className="mt-1 break-words">{family}</p>
          </div>
          <div className="min-w-0">
            <p className="text-[9px] font-semibold uppercase tracking-wider text-subtle">Target</p>
            <p className="mt-1 break-all">{target || "—"}</p>
          </div>
        </div>
        <div className="border-t border-border/70 pt-3">
          <p className="text-[9px] font-semibold uppercase tracking-wider text-subtle">Reason</p>
          <p className="mt-1 break-words text-xs leading-5 text-muted">{reason || "—"}</p>
        </div>
      </div>
    </article>
  );
}

function Engineering() {
  const data = Route.useLoaderData();
  const authority = data.vedmAuthority;
  const baselines = data.baselines as Row[];
  const changes = data.changes as Row[];
  const released = baselines.filter((row) => text(row, "status") === "released").length;
  const openChanges = changes.filter(
    (row) => !["implemented", "rejected"].includes(text(row, "status")),
  ).length;

  return (
    <div className="space-y-6">
      <header className="border-b border-border pb-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-green">
          Engineering · canonical baseline & ECR authority
        </p>
        <h1 className="mt-1 font-display text-4xl text-accent">Engineering</h1>
        <p className="mt-2 max-w-4xl text-sm leading-6 text-muted">
          Released baselines and engineering changes are loaded from the governed Engineering authority.
          Legacy in-page revision arrays are no longer a competing source of truth.
        </p>
        <div className="mt-3 flex flex-wrap gap-3 text-sm font-semibold">
          <Link to="/command/product" className="text-accent">Product register →</Link>
          <Link to="/command/bom-control" className="text-accent">BOM control →</Link>
        </div>
      </header>

      <Panel title="Engineering Workbench Authority" kicker="Design/CAD execution lives in the dedicated engineering repository">
        <div className="grid gap-3 lg:grid-cols-[1.15fr_.85fr]">
          <div className="rounded-lg border border-border/80 bg-bg/45 p-4">
            <p className="text-[9px] font-semibold uppercase tracking-wider text-subtle">Authoritative workbench</p>
            <p className="mt-1 text-lg font-semibold text-accent">vayu-shastr/design</p>
            <p className="mt-2 text-xs leading-5 text-muted">
              STEP viewing, VAEA tube development, datum editing, Kamm-tail/loft geometry, clearance,
              CLT, failure criteria, laminate development and the local CAD bridge are maintained in the dedicated design repository.
            </p>
            <a
              href="https://github.com/vayu-shastr/design"
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-xs font-semibold text-accent hover:bg-accent/15"
            >
              Open engineering design repository ↗
            </a>
          </div>
          <div className="rounded-lg border border-border/80 bg-bg/45 p-4">
            <p className="text-[9px] font-semibold uppercase tracking-wider text-subtle">VYNDI OS role</p>
            <div className="mt-2 space-y-2 text-xs leading-5 text-muted">
              <p><span className="font-semibold text-fg">Govern:</span> baselines, ECRs, gates and release evidence.</p>
              <p><span className="font-semibold text-fg">Trace:</span> engineering authority into BOM, manufacturing, quality and validation records.</p>
              <p><span className="font-semibold text-fg">Do not duplicate:</span> parametric CAD/FEA/laminate design logic.</p>
            </div>
            <p className="mt-3 border-t border-border pt-3 text-[10px] leading-4 text-subtle">
              Frame geometry authority: Rev 5.3.9 E-K75. Preferred front-end development: Rev 5.4 FK75.
            </p>
          </div>
        </div>
      </Panel>

      <Panel title="VEDM Design Authority" kicker="Controlled geometry authority · preferred front-end development">
        <div className="grid gap-3 lg:grid-cols-[1fr_1fr_1.6fr]">
          <div className="rounded-lg border border-border/80 bg-bg/45 p-3">
            <p className="text-[9px] font-semibold uppercase tracking-wider text-subtle">Frame geometry</p>
            <p className="mt-1 text-sm font-semibold text-accent">{authority.frameGeometry}</p>
          </div>
          <div className="rounded-lg border border-border/80 bg-bg/45 p-3">
            <p className="text-[9px] font-semibold uppercase tracking-wider text-subtle">Preferred development</p>
            <p className="mt-1 text-sm font-semibold text-accent">{authority.preferredFrontEnd}</p>
            <p className="mt-1 text-[10px] font-semibold uppercase text-accent">{authority.status}</p>
          </div>
          <div className="rounded-lg border border-border/80 bg-bg/45 p-3">
            <p className="text-[9px] font-semibold uppercase tracking-wider text-subtle">Release boundary</p>
            <p className="mt-1 text-xs leading-5 text-muted">{authority.summary}</p>
            <p className="mt-2 text-[10px] text-subtle">{authority.sourceReference}</p>
          </div>
        </div>
        <div className="mt-3 rounded-lg border border-border/80 bg-bg/45 p-3">
          <p className="text-[9px] font-semibold uppercase tracking-wider text-subtle">Open decisive gates</p>
          <p className="mt-1 text-xs leading-5 text-muted">{authority.releaseBlockers.join(" · ")}</p>
        </div>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Baselines" value={String(baselines.length)} hint="Canonical records" />
        <Kpi label="Released" value={String(released)} hint="G04 release evidence" tone={released ? "ok" : "warn"} />
        <Kpi label="ECRs" value={String(changes.length)} hint="Controlled change requests" />
        <Kpi label="Open change" value={String(openChanges)} hint="Requires lifecycle action" tone={openChanges ? "warn" : "ok"} />
      </div>

      <Panel title="Engineering Baseline Register" kicker="Geometry · material · tooling · drawing · BOM">
        <div className="space-y-2" data-full-view-table="engineering-baseline-register">
          <div className="hidden grid-cols-[minmax(0,1.25fr)_minmax(0,.65fr)_minmax(0,1.45fr)_minmax(0,1fr)_minmax(0,1.25fr)_minmax(0,.75fr)] gap-3 rounded-lg border border-border bg-surface/55 px-3 py-2 text-[9px] font-bold uppercase tracking-[0.12em] text-subtle lg:grid">
            <span>Family / variant</span>
            <span>Revision</span>
            <span>Geometry / material</span>
            <span>Tooling</span>
            <span>Drawing / BOM</span>
            <span>Status</span>
          </div>
          {baselines.map((row) => <BaselineRecord key={text(row, "id")} row={row} />)}
        </div>
      </Panel>

      <Panel title="Engineering Change Requests" kicker="Attributable controlled lifecycle">
        {changes.length ? (
          <div className="space-y-2" data-full-view-table="engineering-change-register">
            <div className="hidden grid-cols-[minmax(0,.9fr)_minmax(0,1fr)_minmax(0,.8fr)_minmax(0,2fr)_minmax(0,.75fr)] gap-3 rounded-lg border border-border bg-surface/55 px-3 py-2 text-[9px] font-bold uppercase tracking-[0.12em] text-subtle lg:grid">
              <span>ECR</span>
              <span>Family</span>
              <span>Target</span>
              <span>Reason</span>
              <span>Status</span>
            </div>
            {changes.map((row) => <ChangeRecord key={text(row, "id")} row={row} />)}
          </div>
        ) : (
          <p className="text-sm text-muted">No Engineering change request is currently recorded.</p>
        )}
      </Panel>

      <p className="text-xs text-muted">Canonical authority: <code>vyndi_engineering_baselines</code> + <code>vyndi_engineering_change_requests</code>.</p>
    </div>
  );
}
