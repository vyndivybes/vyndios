export type ReadinessTask = {
  id: string;
  domain: string;
  status: string;
  readinessRequired: boolean;
};

export type ReadinessEvidence = {
  id: string;
  domain: string;
  state: "sufficient" | "insufficient" | "unrated" | "not_applicable";
  confidence: number | null;
  required: boolean;
};

export type ReadinessRisk = {
  id: string;
  exposureScore: number | null;
  status: string;
};

const roundedPct = (numerator: number, denominator: number) =>
  denominator <= 0 ? null : Math.round((numerator / denominator) * 1000) / 10;

export function buildReadinessAssessment(input: {
  tasks: ReadinessTask[];
  evidence: ReadinessEvidence[];
  activeRisks: ReadinessRisk[];
  configurationBlockers: number;
}) {
  const requiredTasks = input.tasks.filter((task) => task.readinessRequired);
  const dispositioned = requiredTasks.filter(
    (task) => task.status === "complete" || task.status === "waived",
  );
  const waivedTaskCount = requiredTasks.filter((task) => task.status === "waived").length;

  const applicableEvidence = input.evidence.filter(
    (item) => item.required && item.state !== "not_applicable",
  );
  const sufficientEvidence = applicableEvidence.filter(
    (item) => item.state === "sufficient",
  );
  const confidenceRated = applicableEvidence.filter(
    (item) => item.confidence != null && Number.isFinite(item.confidence),
  );
  const evidenceConfidencePct = confidenceRated.length
    ? Math.round(
        (confidenceRated.reduce((sum, item) => sum + Number(item.confidence), 0) /
          confidenceRated.length) *
          1000,
      ) / 10
    : null;

  const activeRisks = input.activeRisks.filter((risk) => risk.status !== "closed");
  const riskScores = activeRisks
    .map((risk) => risk.exposureScore)
    .filter((value): value is number => value != null && Number.isFinite(value));

  const domains = new Set(requiredTasks.map((task) => task.domain));
  const domainReadiness: Record<
    string,
    { requiredTasks: number; dispositionedTasks: number; readinessPct: number | null }
  > = {};
  for (const domain of domains) {
    const scoped = requiredTasks.filter((task) => task.domain === domain);
    const done = scoped.filter(
      (task) => task.status === "complete" || task.status === "waived",
    );
    domainReadiness[domain] = {
      requiredTasks: scoped.length,
      dispositionedTasks: done.length,
      readinessPct: roundedPct(done.length, scoped.length),
    };
  }

  return {
    taskReadinessPct: roundedPct(dispositioned.length, requiredTasks.length),
    requiredTaskCount: requiredTasks.length,
    dispositionedTaskCount: dispositioned.length,
    waivedTaskCount,
    evidenceCompletenessPct: roundedPct(
      sufficientEvidence.length,
      applicableEvidence.length,
    ),
    applicableEvidenceCount: applicableEvidence.length,
    sufficientEvidenceCount: sufficientEvidence.length,
    evidenceConfidencePct,
    evidenceConfidenceCoveragePct: roundedPct(
      confidenceRated.length,
      applicableEvidence.length,
    ),
    activeRiskCount: activeRisks.length,
    highestRiskExposureScore: riskScores.length ? Math.max(...riskScores) : null,
    configurationBlockers: Math.max(0, Math.round(input.configurationBlockers || 0)),
    domainReadiness,
    overallReadinessPct: null,
    overallReadinessReason:
      "Composite VPRI is withheld until governed weighting exists across readiness, evidence, configuration, supply and risk dimensions.",
  };
}
