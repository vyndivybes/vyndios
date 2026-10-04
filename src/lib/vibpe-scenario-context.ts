import type { IbpeScenarioRequest } from "@/lib/ibpe-scenario-lab";
import type { VibpeScenarioParse } from "@/lib/vibpe-intent";

/** Apply only explicitly parsed changes; never overwrite retained values with parser defaults. */
export function resolveVibpeScenarioContext(
  parsed: VibpeScenarioParse,
  prior?: IbpeScenarioRequest,
): { scenario?: IbpeScenarioRequest; clarification?: string } {
  const base = parsed.resetScenario ? undefined : prior;
  if (!parsed.scenario && parsed.fundingDelayMonths == null) return { scenario: base };
  if (parsed.fundingDelayMonths != null && !(parsed.scenarioPatch?.cashInjectionLakh || base?.cashInjectionLakh)) {
    return { clarification: "Specify the funding amount and its planned arrival month before delaying it. No funding-delay scenario has been calculated." };
  }
  const scenario = { ...(base ?? parsed.scenario), ...parsed.scenarioPatch } as IbpeScenarioRequest;
  scenario.id = parsed.scenario?.id ?? `advisory-${Date.now()}`;
  scenario.label = [base ? "Follow-up" : "Scenario", parsed.scenario?.label, parsed.fundingDelayMonths != null ? `funding delayed ${parsed.fundingDelayMonths}m` : undefined].filter(Boolean).join(" · ");
  if (parsed.scenarioPatch?.demandMultiplierByProduct) {
    scenario.demandMultiplierByProduct = { ...base?.demandMultiplierByProduct, ...parsed.scenarioPatch.demandMultiplierByProduct };
  }
  if (parsed.scenarioPatch?.demandMultiplier != null) {
    // An explicit all-product demand instruction replaces earlier family overrides.
    scenario.demandMultiplierByProduct = parsed.scenarioPatch.demandMultiplierByProduct;
  }
  if (parsed.fundingDelayMonths != null) {
    const month = (scenario.cashInjectionPeriod ?? 1) + parsed.fundingDelayMonths;
    if (month > 36) return { clarification: "The delayed funding falls beyond M36. Choose an arrival month within the governed planning horizon; no scenario was calculated." };
    scenario.cashInjectionPeriod = month;
  }
  const limits: Array<[keyof IbpeScenarioRequest, number, number]> = [
    ["demandMultiplier", 0.1, 3], ["capacityMultiplier", 0.1, 3],
    ["procurementCostMultiplier", 0.25, 3], ["leadTimeMultiplier", 0.25, 3],
    ["receiptDelayMonths", 0, 12], ["cashInjectionLakh", 0, 10000], ["cashInjectionPeriod", 1, 36],
  ];
  for (const [key, min, max] of limits) {
    const value = scenario[key];
    if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max)) {
      return { clarification: `The requested ${key} is outside the supported range ${min}–${max}. No scenario was calculated or silently clamped.` };
    }
  }
  if (Object.values(scenario.demandMultiplierByProduct ?? {}).some((value) => !Number.isFinite(value) || value < 0.1 || value > 3)) {
    return { clarification: "Product demand multipliers must be between 0.1 and 3. No scenario was calculated or silently clamped." };
  }
  return { scenario };
}
