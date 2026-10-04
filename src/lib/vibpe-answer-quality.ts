/** Evidence coverage is a checklist score, never a probability of correctness. */
export type VibpeEvidenceQuality = {
  status: "supported" | "limited" | "withheld";
  coverageScore: number;
  interpretation: "evidence-coverage-not-probability";
  reasons: string[];
  snapshotAgeHours: number | null;
};

export function assessVibpeEvidenceQuality(input: {
  sourceCount: number;
  unavailableCount: number;
  unresolvedCount: number;
  lineageComplete: boolean;
  capturedAt?: string;
  methodVerified: boolean;
  now?: number;
}): VibpeEvidenceQuality {
  const now = input.now ?? Date.now();
  const captured = input.capturedAt ? Date.parse(input.capturedAt) : NaN;
  const age = Number.isFinite(captured) && captured <= now ? (now - captured) / 3_600_000 : null;
  const checks = [
    { ok: input.sourceCount > 0, reason: "No supporting source was retrieved." },
    { ok: input.lineageComplete, reason: "Source lineage is incomplete." },
    { ok: input.unavailableCount === 0, reason: "One or more required sources are unavailable." },
    { ok: input.unresolvedCount === 0, reason: "Unresolved authority evidence requires review." },
    { ok: age !== null && age <= 24, reason: age === null ? "Snapshot age is unknown." : "Snapshot is older than the 24-hour advisory freshness threshold; refresh before a current decision." },
    { ok: input.methodVerified, reason: "The requested analytical method was not demonstrated by this answer." },
  ];
  const reasons = checks.filter((check) => !check.ok).map((check) => check.reason);
  const withheld = !input.sourceCount || !input.lineageComplete || !input.methodVerified || input.unavailableCount > 0 || input.unresolvedCount > 0;
  return {
    status: withheld ? "withheld" : reasons.length ? "limited" : "supported",
    coverageScore: checks.filter((check) => check.ok).length / checks.length,
    interpretation: "evidence-coverage-not-probability",
    reasons,
    snapshotAgeHours: age === null ? null : Math.round(age * 100) / 100,
  };
}

export type VibpeAnalyticalMethod = "monte-carlo" | "highs-optimisation" | "scenario" | "record-retrieval" | "planning";

export function requiredVibpeMethod(question: string): VibpeAnalyticalMethod {
  if (/monte[ -]+carlo|probabilistic\s+schedule|critical\s+path\s+frequency|schedule\s+uncertainty\s+simulation/i.test(question)) return "monte-carlo";
  if (/\b(highs|milp|solver|optimi[sz](?:e|er|ation))\b|best (?:plan|option)|binding constraints?/i.test(question)) return "highs-optimisation";
  if (/what\s+if|\bscenario\b|\b(?:increase|reduce|decrease|inject|delay)\b.*(?:%|lakh|months?)/i.test(question)) return "scenario";
  if (/\b(revision|document|eco|ecn|capa|supplier|traceability|where.used)\b/i.test(question)) return "record-retrieval";
  return "planning";
}

export function describeVibpeMethod(method: VibpeAnalyticalMethod, scenarioEvaluated: boolean): string {
  if (method === "monte-carlo") return "Method requested: Monte Carlo. Only a captured seeded simulation can support probability or percentile claims; chat does not execute a new simulation.";
  if (method === "highs-optimisation") return "Method requested: HiGHS optimisation. Review the persisted solver status, acceptance, binding constraints and cash gate in the Optimizer workspace. Chat does not execute a new solver run.";
  if (method === "scenario") return scenarioEvaluated ? "Method: deterministic scenario recalculation against the governed baseline; hypothetical, not an approved plan." : "Method requested: scenario analysis. No successful scenario recalculation was established; scenario conclusions are withheld.";
  if (method === "record-retrieval") return "Method: governed record/reference retrieval. Record existence does not independently establish approval or physical validation.";
  return "Method: governed planning snapshot interpretation; no new optimisation or simulation is implied.";
}

export function vibpeSourceFailureMessage(source: string): string {
  return `${source} is unavailable. The requested conclusion is withheld. Restore the owning source and retry; no cached value is being presented as a live result.`;
}
