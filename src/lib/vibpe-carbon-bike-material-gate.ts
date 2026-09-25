export type TorayMaterialReleaseEvidence = {
  supplier?: string;
  materialSystem?: string;
  fibreBasis?: string;
  fawGm2?: number;
  resinContentPct?: number;
  curedPlyThicknessMm?: number;
  calculatorUrl?: string;
  calculatorRecordId?: string;
  calculatorCheckedAt?: string;
  supplierDatasheetUrl?: string;
  supplierDatasheetRef?: string;
};

export type TorayMaterialReleaseGateResult = {
  supplierValidated: boolean;
  promoteRev1FromProvisional: boolean;
  productionReleased: false;
  blockers: string[];
  requiredDownstreamChecks: readonly string[];
  releaseNote: string;
  evidence: TorayMaterialReleaseEvidence;
};

const REQUIRED_DOWNSTREAM_CHECKS = [
  "laminate allowables",
  "manufacturing process controls",
  "FEA/test correlation",
  "coupon/subcomponent validation",
  "ISO 4210 frame/fork validation",
] as const;

export function evaluateTorayMaterialReleaseGate(
  evidence: TorayMaterialReleaseEvidence,
): TorayMaterialReleaseGateResult {
  const blockers: string[] = [];

  if (!evidence.supplier?.trim()) blockers.push("Supplier identity is required.");
  if (!evidence.materialSystem?.trim()) blockers.push("Commercial prepreg/material system must be frozen.");
  if (!evidence.fibreBasis?.trim()) blockers.push("Fibre basis is required.");
  if (!(evidence.fawGm2 && evidence.fawGm2 > 0)) blockers.push("Fibre areal weight (FAW) must be supplier-backed.");
  if (!(evidence.resinContentPct && evidence.resinContentPct > 0 && evidence.resinContentPct < 100)) {
    blockers.push("Resin content must be supplier-backed.");
  }
  if (!(evidence.curedPlyThicknessMm && evidence.curedPlyThicknessMm > 0)) {
    blockers.push("Cured ply thickness must be validated from supplier data/calculator evidence.");
  }
  if (evidence.calculatorUrl !== "https://www.toraytac.com/resources/Calculators") {
    blockers.push("Toray calculator source URL must be recorded.");
  }
  if (!evidence.calculatorRecordId?.trim()) blockers.push("Calculator evidence record ID is required.");
  if (!evidence.calculatorCheckedAt?.trim()) blockers.push("Calculator verification timestamp is required.");
  if (evidence.supplierDatasheetUrl !== "https://www.toraytac.com/resources/datasheets") {
    blockers.push("Toray datasheet source URL must be recorded.");
  }
  if (!evidence.supplierDatasheetRef?.trim()) blockers.push("Supplier datasheet reference is required.");

  const supplierValidated = blockers.length === 0;

  return {
    supplierValidated,
    promoteRev1FromProvisional: supplierValidated,
    productionReleased: false,
    blockers,
    requiredDownstreamChecks: REQUIRED_DOWNSTREAM_CHECKS,
    releaseNote: supplierValidated
      ? "Supplier material inputs are validated for Rev-1 engineering use. This does not constitute structural or production release."
      : "Rev-1 remains provisional until all supplier-material evidence blockers are closed. This does not constitute structural or production release.",
    evidence,
  };
}
