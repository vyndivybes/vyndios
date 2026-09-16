import type { IntegratedPlanningResult } from "./integrated-business-planning-engine.ts";
import type { RuntimeIbpeInput } from "./ibpe-runtime-parity.ts";
import {
  validateAdvancedPlanningConstraintModel,
  type AdvancedPlanningConstraintModel,
  type RoutingOperation,
  type SupplierLane,
} from "./advanced-planning-constraints.ts";
import type { AdvancedPlanningSourceLineage } from "./advanced-planning-decision-packet.ts";
import {
  buildAdvancedPlanningFromGovernedIbpe,
  type AdvancedPlanningAuthorityAssessment,
  type IbpeCapacityStandardEvidence,
} from "./advanced-planning-ibpe-bridge.ts";
import {
  compileCashGuardrailsFromIbpe,
  type AdvancedCashGuardrail,
  type AdvancedCashTimingControls,
} from "./advanced-planning-cash-guardrails.ts";

export const ADVANCED_OPTIMIZER_PREPARATION_VERSION = "VYNDI-OPTIMIZER-PREPARATION-0.2" as const;

export type AdvancedOptimizerPreparationIssue = {
  severity: "error" | "warning";
  code: string;
  message: string;
};

export type AdvancedOptimizerPreparationEnvelope = {
  version: typeof ADVANCED_OPTIMIZER_PREPARATION_VERSION;
  lineage: AdvancedPlanningSourceLineage;
  packetId: string;
  authority: AdvancedPlanningAuthorityAssessment;
  model: AdvancedPlanningConstraintModel;
  cashGuardrails: AdvancedCashGuardrail[];
  cashTiming: Required<AdvancedCashTimingControls> & {
    cashAnchorPeriod: number;
    cashAnchorSourceRef?: string;
  };
  readyForGovernedOptimization: boolean;
  issues: AdvancedOptimizerPreparationIssue[];
  evidence: {
    sourceSnapshotId: string;
    sourceInputHash: string;
    sourceSha: string;
    capacitySourceRefs: string[];
    persistedRoutingRevisionIds: string[];
    persistedSupplierLaneRevisionIds: string[];
    cashSourceRef: string;
    cashAnchorPeriod: number;
    cashAnalysisStartPeriod: number;
    cashAnchorSourceRef?: string;
    paymentLagControlCount: number;
  };
};

export type PrepareAdvancedOptimizerInput = {
  lineage: AdvancedPlanningSourceLineage;
  input: RuntimeIbpeInput;
  result: IntegratedPlanningResult;
  capacityStandards: IbpeCapacityStandardEvidence[];
  governedRoutingOperations?: RoutingOperation[];
  persistedRoutingRevisionIds?: string[];
  supplierLanes?: SupplierLane[];
  persistedSupplierLaneRevisionIds?: string[];
  packetId: string;
  createdAt: string;
};

export type PrepareFrozenAdvancedOptimizerInput = {
  lineage: AdvancedPlanningSourceLineage;
  input: RuntimeIbpeInput;
  result: IntegratedPlanningResult;
  model: AdvancedPlanningConstraintModel;
  authority: AdvancedPlanningAuthorityAssessment;
  packetId: string;
};

function appendAuthorityIssues(
  authority: AdvancedPlanningAuthorityAssessment,
  issues: AdvancedOptimizerPreparationIssue[],
) {
  if (authority.sourceTruth !== "persisted-governed-ibpe-input") {
    issues.push({
      severity: "error",
      code: "SOURCE_TRUTH_NOT_GOVERNED_IBPE",
      message: "Governed optimization requires authority frozen from persisted governed IBPE input truth.",
    });
  }
  if (authority.capacityAuthority !== "approved-frozen-evidence") {
    issues.push({
      severity: "error",
      code: "CAPACITY_AUTHORITY_NOT_APPROVED",
      message: "Governed optimization requires capacity that was approved when the immutable model evidence was frozen.",
    });
  }
  if (authority.routingAuthority !== "approved-persisted") {
    issues.push({
      severity: "error",
      code: "ROUTING_AUTHORITY_NOT_PERSISTED",
      message: "Governed optimization requires complete approved persisted routing authority; capacity-derived routing remains advisory only.",
    });
  }
  if (authority.supplierLaneAuthority !== "approved-persisted") {
    issues.push({
      severity: "error",
      code: "SUPPLIER_LANE_AUTHORITY_NOT_PERSISTED",
      message: "Governed optimization requires complete approved persisted supplier-lane authority.",
    });
  }
}

function appendLineageIssues(
  lineage: AdvancedPlanningSourceLineage,
  issues: AdvancedOptimizerPreparationIssue[],
) {
  if (!lineage.sourceSnapshotId.trim() || !lineage.sourceInputHash.trim() || !lineage.sourceSha.trim()) {
    issues.push({
      severity: "error",
      code: "SOURCE_LINEAGE_INCOMPLETE",
      message: "Optimizer preparation requires exact governed IBPE snapshot ID, input hash and source SHA.",
    });
  }
}

function sanitizePaymentLagBySku(value: Record<string, number> | undefined) {
  return Object.fromEntries(
    Object.entries(value ?? {})
      .map(([sku, lag]) => [sku, Math.max(0, Math.ceil(Number(lag) || 0))] as const)
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

function buildCashTiming(input: RuntimeIbpeInput, horizon: number) {
  const rawAnchor = Number(input.runtimeControls?.cashAnchorPeriod ?? 0);
  const cashAnchorPeriod = Number.isFinite(rawAnchor)
    ? Math.max(0, Math.min(horizon, Math.floor(rawAnchor)))
    : 0;
  const analysisStartPeriod = cashAnchorPeriod > 0
    ? Math.min(horizon, cashAnchorPeriod + 1)
    : 1;
  return {
    cashAnchorPeriod,
    analysisStartPeriod,
    paymentLagBySku: sanitizePaymentLagBySku(input.runtimeControls?.paymentLagBySku),
    cashAnchorSourceRef: input.runtimeControls?.cashAnchorSourceRef?.trim() || undefined,
  };
}

function buildEnvelope(
  source: PrepareFrozenAdvancedOptimizerInput,
  initialIssues: AdvancedOptimizerPreparationIssue[] = [],
): AdvancedOptimizerPreparationEnvelope {
  const issues = [...initialIssues];
  appendAuthorityIssues(source.authority, issues);
  appendLineageIssues(source.lineage, issues);

  const modelValidation = validateAdvancedPlanningConstraintModel(source.model);
  for (const issue of modelValidation.issues) {
    issues.push({
      severity: issue.severity,
      code: `MODEL_${issue.code}`,
      message: issue.message,
    });
  }

  const cashTiming = buildCashTiming(source.input, source.model.horizonPeriods);
  const cashSourceRef = `${source.lineage.sourceSnapshotId}:${source.lineage.sourceInputHash}:CASH`;
  const cash = compileCashGuardrailsFromIbpe(
    source.result.cash ?? [],
    source.model.horizonPeriods,
    cashSourceRef,
    cashTiming.analysisStartPeriod,
  );
  for (const issue of cash.issues) {
    issues.push({ severity: issue.severity, code: `CASH_${issue.code}`, message: issue.message });
  }

  const readyForGovernedOptimization =
    modelValidation.valid &&
    source.authority.sourceTruth === "persisted-governed-ibpe-input" &&
    source.authority.capacityAuthority === "approved-frozen-evidence" &&
    source.authority.routingAuthority === "approved-persisted" &&
    source.authority.supplierLaneAuthority === "approved-persisted" &&
    cash.valid &&
    !issues.some((issue) => issue.severity === "error");

  return {
    version: ADVANCED_OPTIMIZER_PREPARATION_VERSION,
    lineage: { ...source.lineage },
    packetId: source.packetId,
    authority: source.authority,
    model: source.model,
    cashGuardrails: cash.valid ? cash.guardrails : [],
    cashTiming,
    readyForGovernedOptimization,
    issues,
    evidence: {
      sourceSnapshotId: source.lineage.sourceSnapshotId,
      sourceInputHash: source.lineage.sourceInputHash,
      sourceSha: source.lineage.sourceSha,
      capacitySourceRefs: [...source.authority.capacitySourceRefs].sort(),
      persistedRoutingRevisionIds: [...(source.authority.persistedRoutingRevisionIds ?? [])].sort(),
      persistedSupplierLaneRevisionIds: [...(source.authority.persistedSupplierLaneRevisionIds ?? [])].sort(),
      cashSourceRef,
      cashAnchorPeriod: cashTiming.cashAnchorPeriod,
      cashAnalysisStartPeriod: cashTiming.analysisStartPeriod,
      cashAnchorSourceRef: cashTiming.cashAnchorSourceRef,
      paymentLagControlCount: Object.keys(cashTiming.paymentLagBySku).length,
    },
  };
}

export function prepareFrozenAdvancedOptimizerEnvelope(
  source: PrepareFrozenAdvancedOptimizerInput,
): AdvancedOptimizerPreparationEnvelope {
  return buildEnvelope(source);
}

export function prepareAdvancedOptimizerEnvelope(
  source: PrepareAdvancedOptimizerInput,
): AdvancedOptimizerPreparationEnvelope {
  const issues: AdvancedOptimizerPreparationIssue[] = [];
  const built = buildAdvancedPlanningFromGovernedIbpe({
    lineage: source.lineage,
    input: source.input,
    capacityStandards: source.capacityStandards,
    governedRoutingOperations: source.governedRoutingOperations,
    persistedRoutingRevisionIds: source.persistedRoutingRevisionIds,
    supplierLanes: source.supplierLanes,
    persistedSupplierLaneRevisionIds: source.persistedSupplierLaneRevisionIds,
    packetId: source.packetId,
    createdAt: source.createdAt,
  });

  for (const issue of built.packetBuild.issues) {
    issues.push({ severity: issue.severity, code: `PACKET_${issue.code}`, message: issue.message });
  }

  return buildEnvelope(
    {
      lineage: source.lineage,
      input: source.input,
      result: source.result,
      model: built.model,
      authority: built.authority,
      packetId: source.packetId,
    },
    issues,
  );
}
