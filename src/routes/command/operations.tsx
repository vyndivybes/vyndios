import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Kpi, Panel } from "@/components/kpi";
import { getInventoryMslWarnings } from "@/lib/inventory-authority";
import { getOperatingLineage } from "@/lib/operating-lineage";
import { allocateDispatchSerial, deallocateDispatchSerial, listDispatchRegister, listDispatchSerialCandidates, type DispatchSerialCandidate } from "@/lib/dispatch-authority";
import { listQualityAuthority } from "@/lib/quality-authority";

type Row = Record<string, unknown>;

const text = (row: Row, ...keys: string[]) => {
  for (const key of keys) if (row[key] != null) return String(row[key]);
  return "";
};

export const Route = createFileRoute("/command/operations")({
  loader: async () => {
    return {};
  },
  component: Operations,
});

function DispatchRecord({
  row,
  candidates,
}: {
  row: Awaited<ReturnType<typeof listDispatchRegister>>[number];
  candidates: DispatchSerialCandidate[];
}) {
  const router = useRouter();
  const [qualityReleaseId,setQualityReleaseId]=useState("");
  const [message,setMessage]=useState("");
  const [busy,setBusy]=useState(false);
  const downstream = row.invoiceId
    ? `${row.invoiceId} · ${row.invoiceStatus}`
    : "Invoice not yet posted";
  const serializationLabel = row.serialAllocationRequired
    ? `Serialized ${row.allocatedSerialCount}/${row.units}`
    : "Legacy shipment · serial identity not asserted";
  const releaseCoverageLabel = row.serialAllocationRequired
    ? `Current released ${row.currentReleasedSerialCount}/${row.units}`
    : "Current release coverage not required for legacy dispatch";
  const serialSummary = row.serialNumbers.length ? row.serialNumbers.join(", ") : "No exact serial allocation yet";

  async function allocateSerial() {
    if (!qualityReleaseId) return;
    setBusy(true); setMessage("");
    try {
      await allocateDispatchSerial({ data: {
        shipmentId: row.shipmentId,
        qualityReleaseId,
        sourceReference: "UI:OPERATIONS:SERIAL-DISPATCH",
      }});
      setQualityReleaseId("");
      setMessage("Released serial allocated.");
      await router.invalidate();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Serial allocation failed.");
    } finally { setBusy(false); }
  }

  async function removeSerial(releaseId:string) {
    setBusy(true); setMessage("");
    try {
      await deallocateDispatchSerial({ data: {
        shipmentId: row.shipmentId,
        qualityReleaseId: releaseId,
        reason: "Operations correction before financial finalization",
      }});
      setMessage("Serial allocation reversed.");
      await router.invalidate();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Serial deallocation failed.");
    } finally { setBusy(false); }
  }

  return (
    <article className="rounded-lg border border-border/80 bg-bg/45 p-3 transition-colors hover:bg-surface/45">
      <div className="hidden grid-cols-[minmax(0,.95fr)_minmax(0,1.35fr)_minmax(0,.55fr)_minmax(0,.8fr)_minmax(0,.7fr)_minmax(0,1.45fr)] items-start gap-3 lg:grid">
        <p className="min-w-0 break-all font-mono text-[11px] text-accent">{row.shipmentId}</p>
        <div className="min-w-0">
          <p className="break-all text-xs text-fg">{row.salesOrderId} · R{row.salesOrderRevision}</p>
          <p className="mt-1 break-all text-[10px] text-muted">{row.jobCardId || "No job card"}</p>
        </div>
        <p className="text-right text-xs tabular-nums">{row.units}</p>
        <div className="min-w-0 text-[11px] text-fg"><p>{row.qualityReleaseCount} release(s)</p><p className={row.serializationComplete ? "mt-1 text-ok" : row.serialAllocationRequired ? "mt-1 text-warn" : "mt-1 text-muted"}>{serializationLabel}</p><p className={row.releaseCoverageComplete ? "mt-1 text-ok" : row.serialAllocationRequired ? "mt-1 text-warn" : "mt-1 text-muted"}>{releaseCoverageLabel}</p><p className="mt-1 break-words text-[10px] text-muted">{serialSummary}</p></div>
        <p className="min-w-0 break-words text-[10px] font-semibold uppercase text-fg">{row.status}</p>
        <p className="min-w-0 break-all text-[11px] leading-4 text-muted">{downstream}</p>
      </div>

      <div className="space-y-3 lg:hidden">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="break-all font-mono text-xs text-accent">{row.shipmentId}</p>
            <p className="mt-1 break-all text-[10px] text-muted">{row.salesOrderId} · R{row.salesOrderRevision}</p>
          </div>
          <span className="shrink-0 text-[10px] font-semibold uppercase text-fg">{row.status}</span>
        </div>
        <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
          <div className="min-w-0 sm:col-span-2">
            <p className="text-[9px] font-semibold uppercase tracking-wider text-subtle">Job Card</p>
            <p className="mt-1 break-all">{row.jobCardId || "No job card"}</p>
          </div>
          <div>
            <p className="text-[9px] font-semibold uppercase tracking-wider text-subtle">Units</p>
            <p className="mt-1 tabular-nums">{row.units}</p>
          </div>
          <div>
            <p className="text-[9px] font-semibold uppercase tracking-wider text-subtle">Quality</p>
            <p className="mt-1">{row.qualityReleaseCount} release(s)</p><p className={row.serializationComplete ? "mt-1 text-ok" : row.serialAllocationRequired ? "mt-1 text-warn" : "mt-1 text-muted"}>{serializationLabel}</p><p className="mt-1 break-words text-[10px] text-muted">{serialSummary}</p>
          </div>
        </div>
        <div className="border-t border-border/70 pt-3">
          <p className="text-[9px] font-semibold uppercase tracking-wider text-subtle">Finance downstream</p>
          <p className="mt-1 break-all text-xs leading-5 text-muted">{downstream}</p>
        </div>
      </div>

      {row.serialAllocationRequired ? (
        <div className="mt-3 border-t border-border/70 pt-3">
          <div className="flex flex-wrap items-end gap-2">
            <label className="min-w-[240px] flex-1 text-[10px] font-semibold uppercase tracking-wider text-subtle">
              Allocate serial
              <select className="control mt-1.5 w-full normal-case" value={qualityReleaseId} onChange={(e)=>setQualityReleaseId(e.target.value)}>
                <option value="">Select current released serial</option>
                {candidates.map((candidate)=><option key={candidate.qualityReleaseId} value={candidate.qualityReleaseId}>{candidate.serialNumber} · {candidate.qualityReleaseId}</option>)}
              </select>
            </label>
            <button type="button" disabled={busy||!qualityReleaseId||row.serializationComplete} onClick={()=>void allocateSerial()} className="rounded border border-accent px-3 py-2 text-xs font-semibold text-accent disabled:opacity-40">Allocate serial</button>
          </div>
          {row.serialAllocations.length ? <div className="mt-3 flex flex-wrap gap-2">
            {row.serialAllocations.map((allocation)=><span key={allocation.allocationId} className="inline-flex items-center gap-2 rounded-full border border-border px-2.5 py-1 text-[10px]">
              {allocation.serialNumber}{allocation.currentRelease ? "" : " · superseded release"}
              {!row.invoiceId ? <button type="button" disabled={busy} onClick={()=>void removeSerial(allocation.qualityReleaseId)} className="font-semibold text-warn">Remove</button> : null}
            </span>)}
          </div> : null}
          {message ? <p role="status" className="mt-2 text-xs text-muted">{message}</p> : null}
        </div>
      ) : null}
    </article>
  );
}

function LineageRecord({ row }: { row: Awaited<ReturnType<typeof getOperatingLineage>>[number] }) {
  return (
    <article className="rounded-lg border border-border/80 bg-bg/45 p-3 transition-colors hover:bg-surface/45">
      <div className="hidden grid-cols-[minmax(0,1fr)_minmax(0,.95fr)_minmax(0,.85fr)_minmax(0,1fr)_minmax(0,.65fr)_minmax(0,1.55fr)] items-start gap-3 lg:grid">
        <div className="min-w-0">
          <p className="break-all font-mono text-[11px] text-accent">{row.salesOrderId}</p>
          <p className="mt-1 text-[10px] text-muted">R{row.salesOrderRevision} · {row.units} unit(s)</p>
        </div>
        <p className="min-w-0 break-all text-[11px] text-fg">{row.jobCardId || "Not raised"}</p>
        <p className={row.shortageLines ? "min-w-0 break-words text-[11px] text-warn" : "min-w-0 break-words text-[11px] text-ok"}>
          {row.shortageLines ? `${row.shortageLines} shortage line(s)` : "Ready"}
        </p>
        <p className="min-w-0 break-words text-[11px] text-fg">{row.purchaseOrderCount} PO · {row.goodsReceiptCount} GRN</p>
        <p className="text-xs tabular-nums">{row.travellerCount}/{row.units}</p>
        <p className="min-w-0 break-words text-[11px] leading-4 text-fg">
          {row.shipmentCount} dispatch · {row.invoiceCount} invoice · {row.collectionCount} collection
        </p>
      </div>

      <div className="space-y-3 lg:hidden">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="break-all font-mono text-xs text-accent">{row.salesOrderId}</p>
            <p className="mt-1 text-[10px] text-muted">R{row.salesOrderRevision} · {row.units} unit(s)</p>
          </div>
          <span className={row.shortageLines ? "shrink-0 text-[10px] font-semibold text-warn" : "shrink-0 text-[10px] font-semibold text-ok"}>
            {row.shortageLines ? `${row.shortageLines} shortage` : "Material ready"}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
          <div className="min-w-0 sm:col-span-2">
            <p className="text-[9px] font-semibold uppercase tracking-wider text-subtle">Job Card</p>
            <p className="mt-1 break-all">{row.jobCardId || "Not raised"}</p>
          </div>
          <div>
            <p className="text-[9px] font-semibold uppercase tracking-wider text-subtle">Procurement</p>
            <p className="mt-1">{row.purchaseOrderCount} PO · {row.goodsReceiptCount} GRN</p>
          </div>
          <div>
            <p className="text-[9px] font-semibold uppercase tracking-wider text-subtle">Traveller</p>
            <p className="mt-1 tabular-nums">{row.travellerCount}/{row.units}</p>
          </div>
        </div>
        <div className="border-t border-border/70 pt-3">
          <p className="text-[9px] font-semibold uppercase tracking-wider text-subtle">Dispatch / invoice / collection</p>
          <p className="mt-1 break-words text-xs leading-5 text-muted">
            {row.shipmentCount} dispatch · {row.invoiceCount} invoice · {row.collectionCount} collection
          </p>
        </div>
      </div>
    </article>
  );
}

function Operations() {
  Route.useLoaderData();
  const [warnings, setWarnings] = useState<Awaited<ReturnType<typeof getInventoryMslWarnings>>>([]);
  const [warningsLoaded, setWarningsLoaded] = useState(false);
  const [warningsError, setWarningsError] = useState("");
  const [dispatch, setDispatch] = useState<Awaited<ReturnType<typeof listDispatchRegister>>>([]);
  const [dispatchSerialCandidates, setDispatchSerialCandidates] = useState<DispatchSerialCandidate[]>([]);
  const [dispatchLoaded, setDispatchLoaded] = useState(false);
  const [dispatchBusy, setDispatchBusy] = useState(false);
  const [dispatchError, setDispatchError] = useState("");
  const [quality, setQuality] = useState<Awaited<ReturnType<typeof listQualityAuthority>> | null>(null);
  const [qualityLoaded, setQualityLoaded] = useState(false);
  const [qualityBusy, setQualityBusy] = useState(false);
  const [qualityError, setQualityError] = useState("");
  const [lineage, setLineage] = useState<Awaited<ReturnType<typeof getOperatingLineage>>>([]);
  const [lineageLoaded, setLineageLoaded] = useState(false);
  const [lineageBusy, setLineageBusy] = useState(false);
  const [lineageError, setLineageError] = useState("");

  useEffect(() => {
    let active = true;
    void getInventoryMslWarnings()
      .then((rows) => {
        if (!active) return;
        setWarnings(rows);
        setWarningsLoaded(true);
      })
      .catch((error) => {
        if (!active) return;
        setWarningsError(error instanceof Error ? error.message : "Inventory warnings could not be loaded.");
        setWarningsLoaded(true);
      });
    return () => {
      active = false;
    };
  }, []);

  async function loadDispatchRegister() {
    if (dispatchLoaded || dispatchBusy) return;
    setDispatchBusy(true); setDispatchError("");
    try {
      const [register, candidates] = await Promise.all([listDispatchRegister(), listDispatchSerialCandidates()]);
      setDispatch(register); setDispatchSerialCandidates(candidates); setDispatchLoaded(true);
    } catch (error) { setDispatchError(error instanceof Error ? error.message : "Dispatch register could not be loaded."); }
    finally { setDispatchBusy(false); }
  }

  async function loadQualityAuthority() {
    if (qualityLoaded || qualityBusy) return;
    setQualityBusy(true); setQualityError("");
    try { setQuality(await listQualityAuthority()); setQualityLoaded(true); }
    catch (error) { setQualityError(error instanceof Error ? error.message : "Quality authority could not be loaded."); }
    finally { setQualityBusy(false); }
  }

  async function loadOperatingLineage() {
    if (lineageLoaded || lineageBusy) return;
    setLineageBusy(true);
    setLineageError("");
    try {
      setLineage(await getOperatingLineage());
      setLineageLoaded(true);
    } catch (error) {
      setLineageError(error instanceof Error ? error.message : "Lineage could not be loaded.");
    } finally {
      setLineageBusy(false);
    }
  }
  const currentDispatch = dispatch.filter((row) => row.status === "posted");
  const openNcr = ((quality?.ncrs ?? []) as Row[]).filter(
    (row) => !["closed", "rejected"].includes(text(row, "status")),
  ).length;
  const releases = ((quality?.releases ?? []) as Row[]).filter(
    (row) => text(row, "status") === "released",
  ).length;
  const shortages = lineage.reduce((sum, row) => sum + row.shortageLines, 0);

  return (
    <div className="space-y-6">
      <header className="border-b border-border pb-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-green">
          Operations · demand to quality execution · canonical authority
        </p>
        <h1 className="mt-1 font-display text-4xl text-accent">Operations</h1>
        <p className="mt-2 max-w-4xl text-sm leading-6 text-muted">
          Order lineage, material readiness, Quality release evidence and Dispatch visibility are rendered from canonical operating authorities. Finance remains downstream of posted Operations dispatch.
        </p>
        <div className="mt-3 flex flex-wrap gap-3 text-sm font-semibold">
          <Link to="/command/procurement-planning" className="text-accent">Procurement →</Link>
          <Link to="/command/production" className="text-accent">Production →</Link>
          <Link to="/command/quality" className="text-accent">Quality →</Link>
          <Link to="/command/receivables" className="text-accent">Downstream Finance →</Link>
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Kpi label="Committed lineage" value={lineageLoaded ? String(lineage.length) : "On demand"} hint="Open lineage register to load" />
        <Kpi label="Live shortages" value={lineageLoaded ? String(shortages) : "On demand"} hint="Loaded with governed lineage" tone={lineageLoaded && shortages ? "warn" : undefined} />
        <Kpi
          label="Inventory alerts"
          value={warningsLoaded ? String(warnings.length) : "Loading"}
          hint={warningsError ? "Inventory warning check unavailable" : "MSL / stockout"}
          tone={warningsLoaded && warnings.length ? "warn" : warningsLoaded && !warningsError ? "ok" : undefined}
        />
        <Kpi label="Quality releases" value={qualityLoaded ? String(releases) : "On demand"} hint={qualityLoaded ? `${openNcr} open NCR` : "Load quality authority"} tone={qualityLoaded && openNcr ? "warn" : undefined} />
        <Kpi label="Posted dispatch" value={dispatchLoaded ? String(currentDispatch.length) : "On demand"} hint="Load canonical dispatch register" tone={dispatchLoaded && currentDispatch.length ? "ok" : undefined} />
      </div>

      <Panel title="Today's operating exceptions" kicker="Material · quality · dispatch">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-border p-3">
            <p className="text-xs uppercase tracking-wider text-muted">Material</p>
            <p className={lineageLoaded && shortages ? "mt-1 font-semibold text-warn" : lineageLoaded ? "mt-1 font-semibold text-ok" : "mt-1 font-semibold text-muted"}>{lineageLoaded ? (shortages ? `${shortages} shortage line(s)` : "No live shortage") : "Open lineage to assess"}</p>
          </div>
          <div className="rounded-lg border border-border p-3">
            <p className="text-xs uppercase tracking-wider text-muted">Quality</p>
            <p className={qualityLoaded && openNcr ? "mt-1 font-semibold text-warn" : qualityLoaded ? "mt-1 font-semibold text-ok" : "mt-1 font-semibold text-muted"}>{qualityLoaded ? (openNcr ? `${openNcr} open NCR(s)` : "No open NCR") : "Open quality authority to assess"}</p>
          </div>
          <div className="rounded-lg border border-border p-3">
            <p className="text-xs uppercase tracking-wider text-muted">Inventory</p>
            <p
              className={
                warningsError
                  ? "mt-1 font-semibold text-warn"
                  : warningsLoaded && warnings.length
                    ? "mt-1 font-semibold text-warn"
                    : warningsLoaded
                      ? "mt-1 font-semibold text-ok"
                      : "mt-1 font-semibold text-muted"
              }
            >
              {warningsError
                ? "Warning check unavailable"
                : warningsLoaded
                  ? warnings.length
                    ? `${warnings.length} MSL / stock alert(s)`
                    : "No active alert"
                  : "Checking inventory alerts…"}
            </p>
          </div>
        </div>
      </Panel>

      <Panel title="Quality authority" kicker="load only when evidence is required">
        <details className="rounded-xl border border-border p-3" onToggle={(event) => { if (event.currentTarget.open) void loadQualityAuthority(); }}>
          <summary className="cursor-pointer font-semibold text-accent">Quality evidence ({qualityLoaded ? `${releases} release(s) · ${openNcr} open NCR` : "load on demand"})</summary>
          {qualityBusy ? <p className="mt-3 text-sm text-muted">Loading Quality authority…</p> : qualityError ? <p role="alert" className="mt-3 text-sm text-warn">{qualityError}</p> : qualityLoaded ? <p className="mt-3 text-sm text-muted">{releases} current release(s) · {openNcr} open NCR(s). Full Quality controls remain in the Quality workspace.</p> : <p className="mt-3 text-sm text-muted">Open to load current governed Quality evidence.</p>}
        </details>
      </Panel>

      <Panel title="Operating controls" kicker="compact register · expand only the evidence you need">
        <div className="space-y-3">
          <details className="rounded-xl border border-border p-3" onToggle={(event) => { if (event.currentTarget.open) void loadDispatchRegister(); }}>
            <summary className="cursor-pointer font-semibold text-accent">Canonical Dispatch Register ({dispatchLoaded ? dispatch.length : "load on demand"})</summary>
            <p className="mt-2 text-xs text-muted">Operations/Fulfilment owns shipment truth; Finance is downstream.</p>
            {dispatchBusy ? <p className="mt-3 text-sm text-muted">Loading canonical dispatch…</p> : dispatchError ? <p role="alert" className="mt-3 text-sm text-warn">{dispatchError}</p> : dispatch.length ? (
              <div className="mt-3 space-y-2" data-full-view-table="operations-dispatch-register">
                <div className="hidden grid-cols-[minmax(0,.95fr)_minmax(0,1.35fr)_minmax(0,.55fr)_minmax(0,.8fr)_minmax(0,.7fr)_minmax(0,1.45fr)] gap-3 rounded-lg border border-border bg-surface/55 px-3 py-2 text-[9px] font-bold uppercase tracking-[0.12em] text-subtle lg:grid">
                  <span>Shipment</span><span>Order / job</span><span className="text-right">Units</span><span>Quality</span><span>Status</span><span>Finance downstream</span>
                </div>
                {dispatch.map((row) => <DispatchRecord key={row.shipmentId} row={row} candidates={dispatchSerialCandidates.filter((candidate) => candidate.shipmentId === row.shipmentId)} />)}
              </div>
            ) : <p className="mt-3 text-sm text-muted">No dispatch has been posted. This is a valid empty canonical register, not an unknown route binding.</p>}
          </details>

          <details className="rounded-xl border border-border p-3" onToggle={(event) => { if (event.currentTarget.open) void loadOperatingLineage(); }}>
            <summary className="cursor-pointer font-semibold text-accent">Order-to-cash lineage ({lineageLoaded ? lineage.length : "load on demand"})</summary>
            <p className="mt-2 text-xs text-muted">Persisted evidence from order through production, procurement, receiving, genealogy, Quality, dispatch and Finance.</p>
            {lineageBusy ? <p className="mt-3 text-sm text-muted">Loading governed lineage…</p> : lineageError ? <p role="alert" className="mt-3 text-sm text-warn">{lineageError}</p> : lineage.length ? (
              <div className="mt-3 space-y-2" data-full-view-table="operations-order-to-cash-lineage">
                <div className="hidden grid-cols-[minmax(0,1fr)_minmax(0,.95fr)_minmax(0,.85fr)_minmax(0,1fr)_minmax(0,.65fr)_minmax(0,1.55fr)] gap-3 rounded-lg border border-border bg-surface/55 px-3 py-2 text-[9px] font-bold uppercase tracking-[0.12em] text-subtle lg:grid">
                  <span>Order</span><span>Job Card</span><span>Material</span><span>Procurement</span><span>Traveller</span><span>Dispatch / invoice / collection</span>
                </div>
                {lineage.map((row) => (
                  <LineageRecord key={`${row.salesOrderId}-${row.salesOrderRevision}`} row={row} />
                ))}
              </div>
            ) : <p className="mt-3 text-sm text-muted">No confirmed order lineage exists yet.</p>}
          </details>
        </div>
      </Panel>

      <p className="text-xs text-muted">
        Dispatch source authority: <code>vyndi_dispatch_register</code> via <code>src/lib/dispatch-authority.ts</code>. Quality evidence is loaded from <code>src/lib/quality-authority.ts</code>. This surface does not write Finance records.
      </p>
    </div>
  );
}
