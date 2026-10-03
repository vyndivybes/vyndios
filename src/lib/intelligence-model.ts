export type IntelligenceStatus = "green" | "amber" | "red";

export type IntelligenceMetric = {
  domain: string;
  readiness: number;
  confidence: number;
  risk: number;
  trend: "up" | "flat" | "down";
  status: IntelligenceStatus;
};

export const intelligenceSnapshot = {
  product: "VYNDI Altitude · governed program view",
  readiness: 67,
  confidence: 71,
  riskExposure: 34,
  evidenceCoverage: 76,
  configurationIntegrity: 98,
  forecast: { p50: "18 Dec", p80: "03 Jan", p95: "12 Jan" },
  criticalPath: ["Material authority", "FEA release", "Tooling", "Prototype", "Validation"],
  metrics: [
    { domain: "Geometry", readiness: 92, confidence: 88, risk: 12, trend: "down", status: "green" },
    { domain: "Materials", readiness: 54, confidence: 46, risk: 68, trend: "up", status: "red" },
    { domain: "FEA", readiness: 71, confidence: 63, risk: 37, trend: "flat", status: "amber" },
    { domain: "Manufacturing", readiness: 59, confidence: 52, risk: 43, trend: "down", status: "amber" },
    { domain: "Validation", readiness: 42, confidence: 39, risk: 61, trend: "flat", status: "red" },
    { domain: "Evidence", readiness: 68, confidence: 72, risk: 29, trend: "down", status: "amber" },
  ] satisfies IntelligenceMetric[],
  risks: [
    { id: "RISK-00017", title: "Production material system unresolved", domain: "Material", level: "RED", impact: "Blocks production FEA authority and tooling release.", source: "MAT-01 · Toray review · provisional" },
    { id: "RISK-00021", title: "Fork clearance confidence below closure level", domain: "Technical", level: "AMBER", impact: "Validation evidence required before geometry freeze.", source: "GEO-301 Rev 5.3.9 · review candidate" },
    { id: "RISK-00024", title: "Validation evidence coverage at 76%", domain: "Evidence", level: "AMBER", impact: "Release gate cannot close until required evidence is linked.", source: "VEDM gate register · derived" },
  ],
  gates: [
    { gate: "G1", title: "Requirements / geometry authority", forecast: "Closed / controlled", readiness: 92, status: "green" },
    { gate: "G2", title: "Material and laminate authority", forecast: "Blocked by MAT-01", readiness: 54, status: "red" },
    { gate: "G3", title: "Design validation", forecast: "P80 · 03 Jan", readiness: 43, status: "amber" },
    { gate: "G4", title: "Production release", forecast: "Not forecastable yet", readiness: 31, status: "red" },
  ],
  scenarios: [
    { label: "Baseline", change: "Current controlled candidate", effect: "No new impact", schedule: "P50 18 Dec", release: "Open" },
    { label: "Scenario A", change: "Fork A-C 380 → 385 mm", effect: "Geometry, trail, clearance, CAD and drawings refresh", schedule: "+4–7 days", release: "Blocked" },
    { label: "Scenario B", change: "Add selective T800 reinforcement", effect: "Laminate, FEA, mass, QC and validation review", schedule: "+6–10 days", release: "Review" },
  ],
} as const;

export function readinessTone(value: number): IntelligenceStatus {
  return value >= 80 ? "green" : value >= 55 ? "amber" : "red";
}
