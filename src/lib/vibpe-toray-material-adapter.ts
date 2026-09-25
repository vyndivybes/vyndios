import type { TorayMaterialReleaseEvidence } from "./vibpe-carbon-bike-material-gate.ts";

const TORAY_DATASHEET_URL = "https://www.toraytac.com/resources/datasheets";
const TORAY_CALCULATOR_URL = "https://www.toraytac.com/resources/Calculators";

export type TorayNormalizedMaterialEvidence = {
  supplier?: string;
  materialSystem?: string;
  fibreBasis?: string;
  fawGm2?: number;
  resinContentPct?: number;
  curedPlyThicknessMm?: number;
  datasheetUrl: typeof TORAY_DATASHEET_URL;
  datasheetRef?: string;
  calculatorUrl: typeof TORAY_CALCULATOR_URL;
  calculatorRecordId?: string;
  checkedAt?: string;
};

function optionalNumber(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function optionalText(value: unknown) {
  if (value === undefined || value === null) return undefined;
  const s = String(value).trim();
  return s || undefined;
}

export function normalizeTorayMaterialEvidence(input: Record<string, unknown>): TorayNormalizedMaterialEvidence {
  if (input.datasheetUrl !== TORAY_DATASHEET_URL) {
    throw new Error("Toray datasheet authority URL is required.");
  }
  if (input.calculatorUrl !== TORAY_CALCULATOR_URL) {
    throw new Error("Toray calculator authority URL is required.");
  }
  const supplier = optionalText(input.supplier);
  if (supplier && !/toray/i.test(supplier)) throw new Error("Supplier must identify Toray.");

  return {
    supplier,
    materialSystem: optionalText(input.materialSystem),
    fibreBasis: optionalText(input.fibreBasis),
    fawGm2: optionalNumber(input.fawGm2),
    resinContentPct: optionalNumber(input.resinContentPct),
    curedPlyThicknessMm: optionalNumber(input.curedPlyThicknessMm),
    datasheetUrl: TORAY_DATASHEET_URL,
    datasheetRef: optionalText(input.datasheetRef),
    calculatorUrl: TORAY_CALCULATOR_URL,
    calculatorRecordId: optionalText(input.calculatorRecordId),
    checkedAt: optionalText(input.checkedAt),
  };
}

export function toTorayMaterialReleaseEvidence(
  normalized: TorayNormalizedMaterialEvidence,
): TorayMaterialReleaseEvidence {
  return {
    supplier: normalized.supplier,
    materialSystem: normalized.materialSystem,
    fibreBasis: normalized.fibreBasis,
    fawGm2: normalized.fawGm2,
    resinContentPct: normalized.resinContentPct,
    curedPlyThicknessMm: normalized.curedPlyThicknessMm,
    calculatorUrl: normalized.calculatorUrl,
    calculatorRecordId: normalized.calculatorRecordId,
    calculatorCheckedAt: normalized.checkedAt,
    supplierDatasheetUrl: normalized.datasheetUrl,
    supplierDatasheetRef: normalized.datasheetRef,
  };
}

export const TORAY_MATERIAL_SOURCE_URLS = {
  datasheets: TORAY_DATASHEET_URL,
  calculators: TORAY_CALCULATOR_URL,
} as const;
