export type VibpeVerificationStatus =
  | "verified"
  | "supported"
  | "partially-supported"
  | "contradicted"
  | "insufficient-evidence"
  | "requires-simulation"
  | "requires-physical-test";

export type VibpeDimensionAssessment = {
  status: VibpeVerificationStatus;
  basis: string;
};

export type VibpeFiveDimensionAssessment = {
  mathematical: VibpeDimensionAssessment;
  theoretical: VibpeDimensionAssessment;
  physical: VibpeDimensionAssessment;
  practical: VibpeDimensionAssessment;
  scientific: VibpeDimensionAssessment;
};

export type VibpeEvidenceClaim = {
  claimId: string;
  claim: string;
  source: string;
  revision?: string;
  effectiveDate?: string;
  authority: "governed-internal" | "scenario-assumption" | "external-reference" | "model-inference";
  support: "direct" | "derived" | "contradicting" | "unresolved";
};

export type VibpeContradiction = {
  claim: string;
  evidenceA: string;
  evidenceB: string;
  resolution: "resolved" | "unresolved" | "superseded";
};

export type VibpeCalculationReceipt = {
  label: string;
  expression: string;
  result: number | string;
  unit?: string;
};

export type VibpeSourceState = {
  source: string;
  status: "live" | "cached" | "fixture" | "assumed" | "unavailable";
  detail?: string;
};

export type VibpeDegradationState = {
  mode: "live" | "partial" | "degraded" | "fixture" | "assumption-dependent";
  live: boolean;
  disclosure: string;
  sources: VibpeSourceState[];
};

export function deriveVibpeDegradationState(sources: VibpeSourceState[]): VibpeDegradationState {
  const unavailable = sources.filter((item) => item.status === "unavailable");
  const fixture = sources.filter((item) => item.status === "fixture");
  const assumed = sources.filter((item) => item.status === "assumed");
  const cached = sources.filter((item) => item.status === "cached");

  let mode: VibpeDegradationState["mode"] = "live";
  if (unavailable.length) mode = "degraded";
  else if (fixture.length) mode = "fixture";
  else if (assumed.length) mode = "assumption-dependent";
  else if (cached.length) mode = "partial";

  const fragments: string[] = [];
  for (const item of unavailable) fragments.push(`${item.source} unavailable${item.detail ? `: ${item.detail}` : ""}`);
  for (const item of fixture) fragments.push(`${item.source} fixture data`);
  for (const item of assumed) fragments.push(`${item.source} assumption-dependent`);
  for (const item of cached) fragments.push(`${item.source} cached`);

  return {
    mode,
    live: mode === "live",
    disclosure: fragments.length ? `Degraded-state disclosure: ${fragments.join("; ")}.` : "All declared answer sources are live.",
    sources,
  };
}

export type VibpeAnswerReceipt = {
  schema: "vibpe-answer-receipt/v1";
  answerId: string;
  createdAt: string;
  question: string;
  intent: string;
  dataMode: VibpeDegradationState["mode"];
  evidence: VibpeEvidenceClaim[];
  assumptions: string[];
  contradictions: VibpeContradiction[];
  calculations: VibpeCalculationReceipt[];
  fiveDimensions: VibpeFiveDimensionAssessment;
  confidence: number;
  nextAction?: string;
  reviewerStatus: "unreviewed" | "accepted" | "corrected" | "rejected";
};

export function buildVibpeAnswerReceipt(input: Omit<VibpeAnswerReceipt, "schema" | "createdAt" | "reviewerStatus"> & {
  reviewerStatus?: VibpeAnswerReceipt["reviewerStatus"];
}): VibpeAnswerReceipt {
  if (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) {
    throw new Error("VIBPE confidence must be calibrated to the closed interval [0,1].");
  }
  return {
    schema: "vibpe-answer-receipt/v1",
    createdAt: new Date().toISOString(),
    reviewerStatus: input.reviewerStatus ?? "unreviewed",
    ...input,
  };
}

export type VibpeSensitivityInput = {
  variable: string;
  baseValue: number;
  lowValue: number;
  highValue: number;
  lowOutcome: number;
  baseOutcome: number;
  highOutcome: number;
  unit?: string;
};

export type VibpeSensitivityDriver = VibpeSensitivityInput & {
  lowEffect: number;
  highEffect: number;
  maximumAbsoluteEffect: number;
  direction: "increases-outcome" | "decreases-outcome" | "mixed" | "neutral";
};

export function rankSensitivityDrivers(rows: VibpeSensitivityInput[]): VibpeSensitivityDriver[] {
  return rows
    .map((row) => {
      const lowEffect = row.lowOutcome - row.baseOutcome;
      const highEffect = row.highOutcome - row.baseOutcome;
      const maximumAbsoluteEffect = Math.max(Math.abs(lowEffect), Math.abs(highEffect));
      const direction =
        lowEffect === 0 && highEffect === 0 ? "neutral" :
        lowEffect <= 0 && highEffect >= 0 ? "increases-outcome" :
        lowEffect >= 0 && highEffect <= 0 ? "decreases-outcome" :
        "mixed";
      return { ...row, lowEffect, highEffect, maximumAbsoluteEffect, direction } satisfies VibpeSensitivityDriver;
    })
    .sort((a, b) => b.maximumAbsoluteEffect - a.maximumAbsoluteEffect || a.variable.localeCompare(b.variable));
}

export type VibpeFinitePlanningConstraint = {
  id: string;
  kind: "machine" | "labour" | "routing" | "supplier" | "material" | "moq" | "setup" | "lead-time" | "yield" | "scrap" | "inventory" | "cash" | "service-level";
  capacity?: number;
  requirement?: number;
  unit?: string;
  binding?: boolean;
  evidence?: string;
};

export function explainBindingConstraints(constraints: VibpeFinitePlanningConstraint[]) {
  return constraints
    .filter((item) => item.binding || (
      Number.isFinite(item.capacity) &&
      Number.isFinite(item.requirement) &&
      Number(item.requirement) > Number(item.capacity)
    ))
    .map((item) => ({
      ...item,
      gap: Number.isFinite(item.capacity) && Number.isFinite(item.requirement)
        ? Number(item.requirement) - Number(item.capacity)
        : undefined,
    }))
    .sort((a, b) => Math.abs(Number(b.gap ?? 0)) - Math.abs(Number(a.gap ?? 0)));
}
