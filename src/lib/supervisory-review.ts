import type { buildGovernedIntelligence } from "./intelligence-model.ts";
import type { buildReadinessAssessment, ReadinessEvidence } from "./readiness-model.ts";

type Planning = ReturnType<typeof buildGovernedIntelligence>;
type Readiness = {
  assessment: ReturnType<typeof buildReadinessAssessment>;
  persistedEvidence: ReadinessEvidence[];
  vedmEvidence: Array<{ id: string; domain: string; evidenceState: string; sourceReference: string }>;
  source: { vedmCommit: string; programId: string };
};
type EvidenceState = "BOUNDED_EVIDENCE" | "SOURCE_UNAVAILABLE" | "STALE_OR_MISMATCHED";
type Lens = {
  id: string; name: string; state: EvidenceState; observation: string;
  sourceRefs: string[]; guidance: string; hypothesis: string; nextAction: string;
  experiment: string; metric: string; measuredBenefit: null; actionAuthorized: false;
};

const advice = [
  { id: "orchestrator", name: "Orchestrator", guidance: "Align funding, demand, supply and capacity before committing resources.",
    hypothesis: "An unaligned constraint may be consuming effort without advancing the next milestone.",
    nextAction: "Identify the highest-priority dependency and compare the next two feasible actions.",
    experiment: "Compare a lean milestone-first plan against the existing IBPE scenario.",
    metric: "Open dependency count and time to next evidenced milestone" },
  { id: "project", name: "Project", guidance: "Manage milestones through evidence, dependencies and explicit ownership.",
    hypothesis: "Unclear dependencies or sequencing may delay the next deliverable.",
    nextAction: "Map critical dependencies and assign review owners; distinguish proposed dates from committed dates.",
    experiment: "Compare two milestone sequences without changing the governed master plan.",
    metric: "Unresolved dependencies and modeled critical-path duration" },
  { id: "vibpe", name: "VIBPE", guidance: "Compare design and manufacturing options against controlled requirements, not model opinion.",
    hypothesis: "A material or process alternative may improve yield, weight or prototype cost.",
    nextAction: "Identify a controlled requirement and select a candidate comparison for engineering review.",
    experiment: "Prepare a virtual trade study with declared assumptions, followed by the required validation.",
    metric: "Modeled mass, material yield and validation evidence coverage" },
  { id: "qa", name: "QA", guidance: "Use preventive risk assessment, evidence-based root-cause analysis and verified CAPA.",
    hypothesis: "An unclear acceptance criterion may cause avoidable rework.",
    nextAction: "Review applicable inspection criteria and distinguish observed defects from potential failure modes.",
    experiment: "Prepare a trial inspection checklist and a cause-and-effect review using labelled sample data.",
    metric: "Acceptance-criteria coverage and measured defect or rework rate when available" },
  { id: "risk", name: "Risk", guidance: "Review funding, schedule and supply exposure separately and test downside assumptions.",
    hypothesis: "A funding delay or supply constraint may materially change milestone feasibility.",
    nextAction: "Rank recorded risks using governed exposure evidence and document missing assumptions.",
    experiment: "Compare conservative, base and optimistic scenarios using the existing scenario tools.",
    metric: "Modeled funding gap and schedule exposure; actual outcomes reviewed separately" },
  { id: "security", name: "Security", guidance: "Use least privilege, verified access reviews and secure configuration checks.",
    hypothesis: "An excessive permission or unreviewed configuration may introduce avoidable exposure.",
    nextAction: "Request a separately authorized access and security evidence review.",
    experiment: "Review a non-production permission matrix against the intended role policy.",
    metric: "Verified access-review coverage and confirmed exceptions" },
  { id: "knowledge", name: "Knowledge", guidance: "Compare source provenance, revision, freshness and conflicting claims before synthesis.",
    hypothesis: "Missing or stale reference evidence may reduce the usefulness of recommendations.",
    nextAction: "List unresolved source gaps and reconcile the relevant controlled revisions.",
    experiment: "Test retrieval of a known controlled reference and compare the answer with its source.",
    metric: "Correct source retrieval and citation coverage in reviewed samples" },
  { id: "release", name: "Release", guidance: "Keep design validation, production release and commercial readiness separately governed.",
    hypothesis: "An incomplete validation gate may prevent the next controlled release.",
    nextAction: "Review each missing applicable evidence item with its owning authority.",
    experiment: "Rehearse a release-evidence checklist using a labelled non-production scenario.",
    metric: "Applicable evidence completeness and unresolved release gates" },
] as const;

export function buildSupervisoryReview({ planning, readiness }: { planning: Planning; readiness: Readiness | null }) {
  const current = planning.available && planning.lineage.sourceCurrent
    && planning.lineage.ageHours !== null && planning.lineage.ageHours <= 24;
  const planningState: EvidenceState = !planning.available ? "SOURCE_UNAVAILABLE"
    : current ? "BOUNDED_EVIDENCE" : "STALE_OR_MISMATCHED";
  const assessment = readiness?.assessment;
  const readinessRefs = readiness ? [readiness.source.programId, readiness.source.vedmCommit].filter(Boolean) : [];
  const planningRefs = planning.available ? [planning.lineage.ibpeRunId, planning.lineage.sourceSha].filter(Boolean) : [];
  const qaEvidence = readiness?.persistedEvidence.filter(e => /^(qa|quality|quality assurance)$/i.test(e.domain)) ?? [];
  function evidence(id: string): Pick<Lens, "state" | "observation" | "sourceRefs"> {
    const none = { state: "SOURCE_UNAVAILABLE" as const, observation: "No applicable governed evidence supplied to this review. The proposal is conditional.", sourceRefs: [] };
    if (id === "orchestrator") return { state: planningState,
      observation: !planning.available ? none.observation : !current ? "Planning snapshot is stale or source revision does not match; refresh before relying on its figures."
        : String(planning.totalFindings) + " recorded IBPE findings; " + String(planning.decisionsRequiringApproval) + " recommendations require authorized action. These are snapshot planning results, not verified actuals.",
      sourceRefs: planningRefs };
    if (id === "project" && assessment && assessment.requiredTaskCount > 0) return { state: "BOUNDED_EVIDENCE",
      observation: assessment.dispositionedTaskCount + " of " + assessment.requiredTaskCount + " required program tasks dispositioned; waivers are not proof of completed work.", sourceRefs: readinessRefs };
    if (id === "vibpe" && readiness?.vedmEvidence.length) return { state: "BOUNDED_EVIDENCE",
      observation: readiness.vedmEvidence.length + " required VEDM evidence nodes returned. Their recorded states are not independent engineering validation.", sourceRefs: readinessRefs };
    if (id === "qa" && qaEvidence.length) return { state: "BOUNDED_EVIDENCE",
      observation: qaEvidence.length + " persisted quality-readiness evidence items. No defect rate or root cause is inferred.", sourceRefs: qaEvidence.map(e => e.id) };
    if (id === "risk" && assessment) return { state: "BOUNDED_EVIDENCE",
      observation: assessment.activeRiskCount + " recorded active risks in the read scope; unrecorded risks may exist.", sourceRefs: readinessRefs };
    if (id === "knowledge" && readiness?.vedmEvidence.length) return { state: "BOUNDED_EVIDENCE",
      observation: readiness.vedmEvidence.length + " controlled evidence references available for comparison; retrieval accuracy and currency require separate review.", sourceRefs: readinessRefs };
    if (id === "release" && assessment && assessment.applicableEvidenceCount > 0) return { state: "BOUNDED_EVIDENCE",
      observation: assessment.sufficientEvidenceCount + " of " + assessment.applicableEvidenceCount + " applicable readiness items recorded sufficient. This does not authorize release.", sourceRefs: readinessRefs };
    return none;
  }
  const lenses: Lens[] = advice.map(item => ({ ...item, ...evidence(item.id), measuredBenefit: null, actionAuthorized: false }));
  return { schema: "vyndi-supervisory-review/v1" as const, lenses,
    classification: "CONDITIONAL_ADVISORY" as const, workerDispatchAuthorized: false as const,
    actionAuthorized: false as const, benefitsVerified: false as const,
    modelInvoked: false as const, externalDataSent: false as const };
}
