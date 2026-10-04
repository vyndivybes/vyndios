import type { VedmAuthorityIssue } from "./vedm-authority-graph.ts";

export type RiskOrdinal = "Low" | "Med" | "High";
export type RiskExposureBand = "low" | "medium" | "high" | "critical";
export type EvidenceConfidenceState = "unrated" | "low" | "medium" | "high";
export type VyndiRiskDomain =
  | "technical"
  | "material"
  | "manufacturing"
  | "quality"
  | "validation"
  | "schedule"
  | "cost"
  | "supply_chain"
  | "configuration"
  | "compliance"
  | "commercial"
  | "cybersecurity"
  | "ip"
  | "operational"
  | "evidence";

export type RiskExposure = {
  score: number;
  band: RiskExposureBand;
};

export type DerivedVedmRisk = {
  id: string;
  title: string;
  domain: VyndiRiskDomain;
  probability: null;
  impact: RiskOrdinal;
  status: "open";
  provenanceClass: "derived";
  sourceCode: VedmAuthorityIssue["code"];
  sourceDomain: string | null;
  affectedObjects: string[];
  message: string;
};

const ordinalScore: Record<RiskOrdinal, number> = { Low: 1, Med: 2, High: 3 };

export function computeRiskExposure(input: {
  likelihood: RiskOrdinal;
  impact: RiskOrdinal;
}): RiskExposure {
  const score = ordinalScore[input.likelihood] * ordinalScore[input.impact];
  const band: RiskExposureBand =
    score >= 9 ? "critical" : score >= 6 ? "high" : score >= 3 ? "medium" : "low";
  return { score, band };
}

export function computeFmeaRpn(input: {
  severity: number | null | undefined;
  occurrence: number | null | undefined;
  detection: number | null | undefined;
}) {
  const values = [input.severity, input.occurrence, input.detection];
  if (values.some((value) => value == null || !Number.isFinite(value))) return null;
  const [severity, occurrence, detection] = values as number[];
  if (
    severity < 1 || severity > 10 ||
    occurrence < 1 || occurrence > 10 ||
    detection < 1 || detection > 10
  ) return null;
  return severity * occurrence * detection;
}

export function evidenceConfidenceState(
  confidence: number | null | undefined,
): EvidenceConfidenceState {
  if (confidence == null || !Number.isFinite(confidence)) return "unrated";
  if (confidence < 0.6) return "low";
  if (confidence < 0.85) return "medium";
  return "high";
}

export function classifyVedmIssueDomain(
  code: VedmAuthorityIssue["code"],
): VyndiRiskDomain {
  if (code === "INSUFFICIENT_EVIDENCE") return "evidence";
  if (code === "RELEASE_GATE_OPEN") return "validation";
  return "configuration";
}

function issueImpact(severity: VedmAuthorityIssue["severity"]): RiskOrdinal {
  return severity === "warning" ? "Med" : "High";
}

export function deriveVedmRisk(issue: VedmAuthorityIssue): DerivedVedmRisk {
  const identity = issue.nodeId || issue.domain || issue.code;
  return {
    id: `VEDM-${issue.code}-${identity}`,
    title: issue.code.replaceAll("_", " "),
    domain: classifyVedmIssueDomain(issue.code),
    probability: null,
    impact: issueImpact(issue.severity),
    status: "open",
    provenanceClass: "derived",
    sourceCode: issue.code,
    sourceDomain: issue.domain ?? null,
    affectedObjects: issue.nodeId ? [issue.nodeId] : [],
    message: issue.message,
  };
}

type HeatmapRisk = {
  likelihood: RiskOrdinal | string | null | undefined;
  impact: RiskOrdinal | string | null | undefined;
  status: string | null | undefined;
};

export function buildRiskHeatmap(risks: HeatmapRisk[]) {
  const ordinals: RiskOrdinal[] = ["Low", "Med", "High"];
  const heatmap: Record<string, number> = {};
  for (const likelihood of ordinals) {
    for (const impact of ordinals) heatmap[`${likelihood}|${impact}`] = 0;
  }
  for (const risk of risks) {
    if (risk.status === "closed") continue;
    if (!ordinals.includes(risk.likelihood as RiskOrdinal)) continue;
    if (!ordinals.includes(risk.impact as RiskOrdinal)) continue;
    const key = `${risk.likelihood}|${risk.impact}`;
    heatmap[key] += 1;
  }
  return heatmap;
}
