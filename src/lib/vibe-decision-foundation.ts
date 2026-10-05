export type VibeTruthClass =
  | "governed-internal"
  | "scenario-assumption"
  | "external-reference"
  | "model-inference";

export type VibeEvidenceFreshness = "current" | "stale" | "unknown";

export type VibeEvidenceClaim = {
  key: string;
  value: unknown;
  truthClass: VibeTruthClass;
  source: string;
  observedAt?: string;
  maxAgeHours?: number;
};

export type VibeEvidenceConflict = {
  key: string;
  sources: string[];
  values: unknown[];
};

export type VibeDecisionFoundation = {
  question: string;
  decisionClass: string;
  facts: Array<VibeEvidenceClaim & { freshness: VibeEvidenceFreshness }>;
  assumptions: Array<VibeEvidenceClaim & { freshness: VibeEvidenceFreshness }>;
  externalReferences: Array<VibeEvidenceClaim & { freshness: VibeEvidenceFreshness }>;
  inferences: Array<VibeEvidenceClaim & { freshness: VibeEvidenceFreshness }>;
  conflicts: VibeEvidenceConflict[];
  missingEvidence: string[];
  confidence: {
    level: "LOW" | "MEDIUM" | "HIGH";
    evidenceCoverage: number;
    staleEvidence: number;
    unresolvedConflicts: number;
  };
  authority: {
    approvalRequired: true;
    executable: false;
  };
};

export function assessEvidenceFreshness(
  evidence: Pick<VibeEvidenceClaim, "observedAt" | "maxAgeHours">,
  now = new Date(),
): VibeEvidenceFreshness {
  if (!evidence.observedAt || evidence.maxAgeHours == null) return "unknown";
  const observedAt = Date.parse(evidence.observedAt);
  if (!Number.isFinite(observedAt)) return "unknown";
  const ageHours = (now.getTime() - observedAt) / 3_600_000;
  return ageHours <= evidence.maxAgeHours ? "current" : "stale";
}

function stableValue(value: unknown): string {
  if (value == null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return JSON.stringify(value.map((item) => stableValue(item)));
  const record = value as Record<string, unknown>;
  return JSON.stringify(Object.keys(record).sort().map((key) => [key, stableValue(record[key])]));
}

export function detectEvidenceConflicts(evidence: VibeEvidenceClaim[]): VibeEvidenceConflict[] {
  const governed = evidence.filter((claim) => claim.truthClass === "governed-internal");
  const byKey = new Map<string, VibeEvidenceClaim[]>();
  for (const claim of governed) byKey.set(claim.key, [...(byKey.get(claim.key) ?? []), claim]);

  const conflicts: VibeEvidenceConflict[] = [];
  for (const [key, claims] of byKey) {
    const distinct = new Map(claims.map((claim) => [stableValue(claim.value), claim.value]));
    if (distinct.size <= 1) continue;
    conflicts.push({
      key,
      sources: [...new Set(claims.map((claim) => claim.source))],
      values: [...distinct.values()],
    });
  }
  return conflicts.sort((a, b) => a.key.localeCompare(b.key));
}

export function buildVibeDecisionFoundation(input: {
  question: string;
  decisionClass: string;
  evidence: VibeEvidenceClaim[];
  requiredEvidenceKeys?: string[];
  now?: Date;
}): VibeDecisionFoundation {
  const now = input.now ?? new Date();
  const classified = input.evidence.map((claim) => ({
    ...claim,
    freshness: assessEvidenceFreshness(claim, now),
  }));
  const facts = classified.filter((claim) => claim.truthClass === "governed-internal");
  const assumptions = classified.filter((claim) => claim.truthClass === "scenario-assumption");
  const externalReferences = classified.filter((claim) => claim.truthClass === "external-reference");
  const inferences = classified.filter((claim) => claim.truthClass === "model-inference");
  const conflicts = detectEvidenceConflicts(input.evidence);

  const governedKeys = new Set(facts.map((claim) => claim.key));
  const required = [...new Set(input.requiredEvidenceKeys ?? [])];
  const missingEvidence = required.filter((key) => !governedKeys.has(key));
  const staleEvidence = facts.filter((claim) => claim.freshness === "stale").length;
  const evidenceCoverage = required.length
    ? (required.length - missingEvidence.length) / required.length
    : facts.length
      ? 1
      : 0;

  const confidenceLevel =
    conflicts.length || missingEvidence.length || staleEvidence
      ? "LOW"
      : evidenceCoverage >= 1 && facts.length
        ? "HIGH"
        : "MEDIUM";

  return {
    question: input.question,
    decisionClass: input.decisionClass,
    facts,
    assumptions,
    externalReferences,
    inferences,
    conflicts,
    missingEvidence,
    confidence: {
      level: confidenceLevel,
      evidenceCoverage,
      staleEvidence,
      unresolvedConflicts: conflicts.length,
    },
    authority: {
      approvalRequired: true,
      executable: false,
    },
  };
}
