import type { IntegratedPlanningResult, PlanningFinding } from "./integrated-business-planning-engine.ts";
import type { VibpeOptimizerReleaseClosure } from "./vibpe-optimizer-release-closure.ts";

export type GovernedIntelligenceRun = {
  id: string;
  sourceSha: string;
  snapshotAt: string;
  approvedPlanId: string;
  approvedPlanRevision: number;
  result: IntegratedPlanningResult;
};

export type GovernedIntelligenceInput = {
  run: GovernedIntelligenceRun | null;
  closure: VibpeOptimizerReleaseClosure;
  deployedSourceSha: string;
  readAt: string;
};

const severityOrder: Record<PlanningFinding["severity"], number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export function buildGovernedIntelligence(input: GovernedIntelligenceInput) {
  const { run, closure } = input;
  if (!run) {
    return {
      available: false as const,
      readAt: input.readAt,
      reason: "No complete governed IBPE run is available. Run governed IBPE to create a planning snapshot.",
    };
  }

  const ageHours = (Date.parse(input.readAt) - Date.parse(run.snapshotAt)) / 3_600_000;
  const sourceCurrent = Boolean(input.deployedSourceSha && run.sourceSha === input.deployedSourceSha);
  const packetIsExact = Boolean(
    closure.packet && closure.packet.parent_ibpe_run_id === run.id
      && closure.packet.source_sha === run.sourceSha,
  );
  const runIsExact = Boolean(packetIsExact && closure.run && closure.run.parent_advanced_packet_id === closure.packet?.id);
  const releaseCurrent = runIsExact && closure.verdict === "GREEN";

  const periods = new Map<number, { period: number; plan: number; forecast: number; committed: number; actual: number }>();
  for (const row of run.result.demand) {
    if (!Number.isInteger(row.period) || row.period < 1 || row.period > 36) continue;
    const period = periods.get(row.period) ?? { period: row.period, plan: 0, forecast: 0, committed: 0, actual: 0 };
    period.plan += row.planQty;
    period.forecast += row.forecastQty;
    period.committed += row.committedQty;
    period.actual += row.actualQty;
    periods.set(row.period, period);
  }

  const findings = [...run.result.findings]
    .sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity] || a.id.localeCompare(b.id))
    .slice(0, 6)
    .map((finding) => ({
      id: finding.id,
      severity: finding.severity,
      domain: finding.domain,
      title: finding.title,
      impact: finding.businessImpact,
      action: finding.recommendedAction,
      evidence: finding.evidence.map((ref) => ref.sourceRef ?? ref.entityId ?? ref.label).filter(Boolean).slice(0, 3),
    }));

  return {
    available: true as const,
    readAt: input.readAt,
    lineage: {
      ibpeRunId: run.id,
      approvedPlanId: run.approvedPlanId,
      approvedPlanRevision: run.approvedPlanRevision,
      sourceSha: run.sourceSha,
      deployedSourceSha: input.deployedSourceSha,
      snapshotAt: run.snapshotAt,
      ageHours: Number.isFinite(ageHours) && ageHours >= 0 ? ageHours : null,
      sourceCurrent,
      packetId: packetIsExact ? closure.packet?.id ?? null : null,
      optimizerRunId: runIsExact ? closure.run?.id ?? null : null,
      releaseCurrent,
    },
    summary: run.result.summary,
    funding: run.result.funding,
    demandByPeriod: [...periods.values()].sort((a, b) => a.period - b.period).slice(0, 6),
    findings,
    totalFindings: run.result.findings.length,
    decisionsRequiringApproval: run.result.decisions.length,
    optimizer: runIsExact && closure.run ? {
      accepted: closure.run.accepted,
      math: closure.run.optimization_status,
      cash: closure.run.cash_guardrail_status,
    } : null,
    blockedReleaseGates: packetIsExact ? closure.gates.filter((gate) => !gate.pass).map((gate) => gate.label) : [],
  };
}
