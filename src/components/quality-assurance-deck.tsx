import { useState, type ReactNode } from "react";
import { Kpi, Panel } from "@/components/kpi";
import { ManufacturingQualityIntelligencePanel } from "@/components/manufacturing-quality-intelligence-panel";
import { listIsoQualityCompliance } from "@/lib/iso-quality-compliance";
import { getManufacturingQualityIntelligence } from "@/lib/manufacturing-quality-authority";

type IsoState = Awaited<ReturnType<typeof listIsoQualityCompliance>>;
type IntelligenceState = Awaited<ReturnType<typeof getManufacturingQualityIntelligence>>;
type Row = Record<string, unknown>;

const text = (row: Row, ...keys: string[]) => {
  for (const key of keys) if (row[key] != null) return String(row[key]);
  return "";
};
const num = (row: Row, ...keys: string[]) => {
  for (const key of keys) if (row[key] != null) return Number(row[key]) || 0;
  return 0;
};

function StatusPill({ value }: { value: string }) {
  const positive = ["current", "pass", "approved", "ready_for_dual_approval", "released", "active"].includes(value);
  const warning = value.includes("watch") || value.includes("conditional") || value.includes("pending");
  return (
    <span className={`rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${positive ? "border-green/30 text-green" : warning ? "border-accent/30 text-accent" : "border-border text-muted"}`}>
      {value.replaceAll("_", " ") || "—"}
    </span>
  );
}

function ReviewSection({
  title,
  loaded,
  loading,
  error,
  onOpen,
  children,
}: {
  title: string;
  loaded: boolean;
  loading: boolean;
  error: string;
  onOpen: () => void;
  children: ReactNode;
}) {
  return (
    <details
      className="rounded-xl border border-border bg-surface/25 p-4"
      onToggle={(event) => {
        if (event.currentTarget.open && !loaded && !loading) onOpen();
      }}
    >
      <summary className="cursor-pointer text-sm font-semibold text-accent">
        {title} · {loaded ? "loaded" : loading ? "loading…" : "load on demand"}
      </summary>
      {error ? <p role="alert" className="mt-3 text-xs text-warn">{error}</p> : null}
      {loaded ? <div className="mt-4">{children}</div> : !loading ? (
        <p className="mt-3 text-xs leading-5 text-muted">
          Governed assurance evidence is loaded only when reviewed; canonical Quality entry remains lightweight.
        </p>
      ) : <p className="mt-3 text-xs text-muted">Loading governed evidence…</p>}
    </details>
  );
}

function IsoComplianceView({ iso }: { iso: IsoState }) {
  const standards = iso.standards as Row[];
  const testMethods = iso.testMethods as Row[];
  const equipment = iso.equipment as Row[];
  const testRuns = iso.testRuns as Row[];
  const releaseStatus = iso.releaseStatus as Row[];
  const today = new Date().toISOString().slice(0, 10);

  const passedIsoTests = testRuns.filter((row) => text(row, "result") === "pass").length;
  const completedIsoTests = testRuns.filter((row) => text(row, "result") !== "scheduled").length;
  const expiredCalibration = equipment.filter((row) => {
    const required = row.calibration_required === true || row.calibrationRequired === true;
    const status = text(row, "status");
    const due = text(row, "calibration_due_on", "calibrationDueOn");
    return required && status === "active" && (!due || due < today);
  }).length;
  const readyProducts = releaseStatus.filter((row) => ["approved", "ready_for_dual_approval"].includes(text(row, "release_status", "releaseStatus"))).length;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="ISO standards" value={String(standards.length)} hint="Version-controlled register" />
        <Kpi label="ISO tests passed" value={`${passedIsoTests}/${completedIsoTests}`} hint="Recorded physical verification" tone={completedIsoTests && passedIsoTests === completedIsoTests ? "ok" : "warn"} />
        <Kpi label="Calibration blocks" value={String(expiredCalibration)} hint="Active equipment overdue/missing" tone={expiredCalibration ? "warn" : "ok"} />
        <Kpi label="ISO release ready" value={String(readyProducts)} hint="Governed product conformity" tone={readyProducts ? "ok" : "warn"} />
      </div>

      <Panel title="ISO Standards Register" kicker="Controlled edition · lifecycle · source">
        <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
          {standards.map((row) => (
            <div key={text(row, "id")} className="rounded-xl border border-border p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-accent">{text(row, "standard_code", "standardCode")}</p>
                  <p className="text-xs text-muted">Edition {text(row, "edition")} · {text(row, "domain").replaceAll("_", " ")}</p>
                </div>
                <StatusPill value={text(row, "lifecycle_status", "lifecycleStatus")} />
              </div>
              <p className="mt-3 text-sm leading-5 text-muted">{text(row, "scope_summary", "scopeSummary")}</p>
              <div className="mt-3 space-y-1 text-xs text-subtle">
                <p>Controlled copy: {text(row, "controlled_copy_ref", "controlledCopyRef") || "Not linked yet"}</p>
                {text(row, "amendment_watch_ref", "amendmentWatchRef") ? <p>Watch: {text(row, "amendment_watch_ref", "amendmentWatchRef")}</p> : null}
              </div>
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs leading-5 text-muted">
          VYNDI stores internal requirement IDs, clause references, acceptance-document references and evidence. The licensed controlled ISO copy remains authoritative; proprietary ISO requirement text and acceptance tables are not replicated in the application.
        </p>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="ISO 4210 Frame & Fork Verification" kicker="Part 6 · controlled method catalogue">
          <div className="grid gap-2 sm:grid-cols-2">
            {testMethods.map((row) => (
              <div key={text(row, "id")} className="rounded-lg border border-border p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono text-xs font-semibold text-accent">{text(row, "id")}</span>
                  <StatusPill value={row.active === false ? "inactive" : "active"} />
                </div>
                <p className="mt-2 text-sm font-semibold">{text(row, "internal_method_name", "internalMethodName")}</p>
                <p className="mt-1 text-xs leading-5 text-muted">{text(row, "scope_summary", "scopeSummary")}</p>
                <p className="mt-2 text-[11px] text-subtle">Method authority: {text(row, "controlled_method_ref", "controlledMethodRef")}</p>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Measurement & Laboratory Control" kicker="ISO 10012 · ISO/IEC 17025 evidence">
          {equipment.length ? (
            <div className="space-y-2">
              {equipment.slice(0, 12).map((row) => {
                const due = text(row, "calibration_due_on", "calibrationDueOn");
                const required = row.calibration_required === true || row.calibrationRequired === true;
                const valid = !required || (text(row, "status") === "active" && Boolean(due) && due >= today);
                return (
                  <div key={text(row, "id")} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3">
                    <div>
                      <p className="text-sm font-semibold text-accent">{text(row, "id")} · {text(row, "equipment_type", "equipmentType")}</p>
                      <p className="text-xs text-muted">Serial {text(row, "serial_number", "serialNumber") || "—"} · due {due || "not recorded"}</p>
                    </div>
                    <StatusPill value={valid ? "current" : "calibration blocked"} />
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-muted">No controlled measurement equipment has been registered yet. Physical ISO test execution will block if required calibration evidence is missing or expired.</p>
          )}
        </Panel>
      </div>

      <Panel title="Product Conformity & Production Release" kicker="Engineering revision · verification completeness · dual approval">
        {releaseStatus.length ? (
          <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
            {releaseStatus.map((row) => (
              <div key={`${text(row, "family_code", "familyCode")}-${text(row, "variant_id", "variantId")}-${text(row, "engineering_revision", "engineeringRevision")}`} className="rounded-xl border border-border p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-accent">{text(row, "family_code", "familyCode").toUpperCase()} · Rev {text(row, "engineering_revision", "engineeringRevision")}</p>
                    <p className="text-xs text-muted">ITP {text(row, "itp_id", "itpId") || "not approved"}</p>
                  </div>
                  <StatusPill value={text(row, "release_status", "releaseStatus")} />
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-md border border-border p-2"><p className="text-subtle">Evidence</p><p className="mt-1 font-semibold text-accent">{num(row, "evidence_completeness_pct", "evidenceCompletenessPct").toFixed(0)}%</p></div>
                  <div className="rounded-md border border-border p-2"><p className="text-subtle">Mandatory pass</p><p className="mt-1 font-semibold text-accent">{num(row, "passed_test_count", "passedTestCount")}/{num(row, "mandatory_test_count", "mandatoryTestCount")}</p></div>
                  <div className="rounded-md border border-border p-2"><p className="text-subtle">Open NCR/CAPA</p><p className="mt-1 font-semibold text-accent">{num(row, "open_ncr_count", "openNcrCount")}/{num(row, "open_capa_count", "openCapaCount")}</p></div>
                  <div className="rounded-md border border-border p-2"><p className="text-subtle">Calibration exceptions</p><p className="mt-1 font-semibold text-accent">{num(row, "invalid_calibration_count", "invalidCalibrationCount")}</p></div>
                </div>
                <p className="mt-3 text-[11px] leading-4 text-muted">Engineering approval: {text(row, "engineering_approval_ref", "engineeringApprovalRef") || "pending"} · Quality approval: {text(row, "quality_approval_ref", "qualityApprovalRef") || "pending"}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted">Released engineering baselines will appear here with live ISO verification readiness as approved ITPs and test evidence are recorded.</p>
        )}
      </Panel>
    </div>
  );
}

export function QualityAssuranceDeck() {
  const [iso, setIso] = useState<IsoState | null>(null);
  const [intelligence, setIntelligence] = useState<IntelligenceState | null>(null);
  const [loading, setLoading] = useState<"" | "iso" | "intelligence">("");
  const [errors, setErrors] = useState<{ iso?: string; intelligence?: string }>({});

  async function loadIso() {
    if (iso || loading) return;
    setLoading("iso");
    setErrors((current) => ({ ...current, iso: "" }));
    try {
      setIso(await listIsoQualityCompliance());
    } catch (error) {
      setErrors((current) => ({ ...current, iso: error instanceof Error ? error.message : "ISO compliance could not be loaded." }));
    } finally {
      setLoading("");
    }
  }

  async function loadIntelligence() {
    if (intelligence || loading) return;
    setLoading("intelligence");
    setErrors((current) => ({ ...current, intelligence: "" }));
    try {
      setIntelligence(await getManufacturingQualityIntelligence());
    } catch (error) {
      setErrors((current) => ({ ...current, intelligence: error instanceof Error ? error.message : "Manufacturing Quality intelligence could not be loaded." }));
    } finally {
      setLoading("");
    }
  }

  return (
    <section className="space-y-3" aria-label="Quality assurance evidence">
      <div className="rounded-xl border border-border bg-surface/35 p-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-green">Quality assurance · review-driven evidence</p>
        <p className="mt-2 text-xs leading-5 text-muted">
          Canonical inspection/NCR/CAPA/release authority loads with the workspace. ISO compliance and empirical Manufacturing & Quality Intelligence remain governed but load only when reviewed.
        </p>
      </div>

      <ReviewSection
        title="ISO compliance & product conformity"
        loaded={Boolean(iso)}
        loading={loading === "iso"}
        error={errors.iso ?? ""}
        onOpen={() => void loadIso()}
      >
        {iso ? <IsoComplianceView iso={iso} /> : null}
      </ReviewSection>

      <ReviewSection
        title="Manufacturing & Quality Intelligence"
        loaded={Boolean(intelligence)}
        loading={loading === "intelligence"}
        error={errors.intelligence ?? ""}
        onOpen={() => void loadIntelligence()}
      >
        {intelligence ? <ManufacturingQualityIntelligencePanel state={intelligence} /> : null}
      </ReviewSection>
    </section>
  );
}
