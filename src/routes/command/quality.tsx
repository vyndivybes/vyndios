import { createFileRoute } from "@tanstack/react-router";
import { Kpi, Panel } from "@/components/kpi";
import { QualityAssuranceDeck } from "@/components/quality-assurance-deck";
import { listQualityAuthority } from "@/lib/quality-authority";

type Row = Record<string, unknown>;
const text = (row: Row, ...keys: string[]) => {
  for (const key of keys) if (row[key] != null) return String(row[key]);
  return "";
};
const num = (row: Row, ...keys: string[]) => {
  for (const key of keys) if (row[key] != null) return Number(row[key]) || 0;
  return 0;
};

export const Route = createFileRoute("/command/quality")({
  loader: async () => {
    const quality = await listQualityAuthority();
    return { quality };
  },
  component: Quality,
});

function StatusPill({ value }: { value: string }) {
  const positive = ["current", "pass", "approved", "ready_for_dual_approval", "released", "active"].includes(value);
  const warning = value.includes("watch") || value.includes("conditional") || value.includes("pending");
  return (
    <span className={`rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${positive ? "border-green/30 text-green" : warning ? "border-accent/30 text-accent" : "border-border text-muted"}`}>
      {value.replaceAll("_", " ") || "—"}
    </span>
  );
}

function Quality() {
  const { quality } = Route.useLoaderData();
  const inspections = quality.inspections as Row[];
  const ncrs = quality.ncrs as Row[];
  const capas = quality.capas as Row[];
  const releases = quality.releases as Row[];

  const openNcr = ncrs.filter((row) => !["closed", "rejected"].includes(text(row, "status"))).length;
  const openCapa = capas.filter((row) => !["closed", "rejected"].includes(text(row, "status"))).length;
  const released = releases.filter((row) => text(row, "decision", "status") === "released").length;

  return (
    <div className="min-w-0 max-w-full space-y-6 break-words">
      <header className="border-b border-border pb-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-green">Quality · ISO compliance · governed release authority</p>
        <h1 className="mt-1 font-display text-4xl text-accent">Quality & Product Compliance</h1>
        <p className="mt-2 max-w-5xl text-sm leading-6 text-muted">
          Canonical inspection, NCR/CAPA and serialized release evidence is now joined to an ISO standards register, ISO 4210 verification plans, calibration control and engineering-revision product conformity.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Inspections" value={String(inspections.length)} hint="Canonical Quality records" />
        <Kpi label="Open NCR" value={String(openNcr)} hint="Containment / CAPA" tone={openNcr ? "warn" : "ok"} />
        <Kpi label="Open CAPA" value={String(openCapa)} hint="Effectiveness pending" tone={openCapa ? "warn" : "ok"} />
        <Kpi label="Released serials" value={String(released)} hint="Current Quality decisions" tone={released ? "ok" : "default"} />
      </div>

      <QualityAssuranceDeck />

      <Panel title="Inspection Register" kicker="Incoming · in-process · final">
        {inspections.length ? (
          <div className="grid gap-2 lg:grid-cols-2">
            {inspections.map((row) => (
              <div key={text(row, "id")} className="min-w-0 rounded-lg border border-border p-3 break-all">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="font-mono text-xs text-accent">{text(row, "id")}</span>
                  <StatusPill value={text(row, "result")} />
                </div>
                <p className="mt-2 text-sm">{text(row, "inspection_stage", "inspectionStage")} · {text(row, "inspection_type", "inspectionType")}</p>
                <p className="mt-1 text-xs text-muted">JC {text(row, "job_card_id", "jobCardId") || "—"} · TRV {text(row, "traveller_id", "travellerId") || "—"} · SKU {text(row, "sku") || "—"}</p>
                <p className="mt-1 text-xs text-muted">Disposition {text(row, "disposition")} · defects {num(row, "defect_quantity", "defectQuantity")}/{num(row, "sample_size", "sampleSize")}</p>
              </div>
            ))}
          </div>
        ) : <p className="text-sm text-muted">No canonical inspection record has been posted yet.</p>}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="NCR / CAPA Register" kicker="Non-conformance control">
          {ncrs.length ? <div className="space-y-2">{ncrs.map((row) => <div key={text(row,"id")} className="min-w-0 rounded-lg border border-border p-3 break-all"><div className="flex flex-wrap justify-between gap-3"><span className="font-semibold text-accent">{text(row,"id")}</span><span className="text-xs uppercase text-muted">{text(row,"severity")} · {text(row,"status")}</span></div><p className="mt-2 text-sm">{text(row,"description")}</p></div>)}</div> : <p className="text-sm text-muted">No NCR recorded.</p>}
          {capas.length ? <p className="mt-3 text-xs text-muted">CAPA records: {capas.length} · open {openCapa}</p> : null}
        </Panel>
        <Panel title="Serialized Release Register" kicker="Current production release evidence">
          {releases.length ? <div className="space-y-2">{releases.map((row) => <div key={text(row,"id")} className="min-w-0 rounded-lg border border-border p-3 break-all"><div className="flex flex-wrap justify-between gap-3"><span className="font-mono text-xs text-accent">{text(row,"id")}</span><StatusPill value={text(row,"decision","status")} /></div><p className="mt-2 text-xs text-muted">Traveller {text(row,"traveller_id","travellerId") || "—"} · serial {text(row,"serial_number","serialNumber") || "—"}</p></div>)}</div> : <p className="text-sm text-muted">No serialized Quality release recorded.</p>}
        </Panel>
      </div>

      <p className="text-xs text-muted">
        Canonical authority: <code>vyndi_quality_*</code>, <code>vyndi_iso_*</code> and governed projection <code>vyndi_vibpe_iso_release_status</code>. Product release remains an explicit approval action; VIBPE may report readiness but cannot authorize release automatically.
      </p>
    </div>
  );
}
