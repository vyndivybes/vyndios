import { buildModelWithInputs, type FinanceAssumptions, type ScenarioId } from "@/lib/finance/model";
import { TRANCHES } from "@/lib/data/company";

export const PROCUREMENT_PLANNING_HORIZON = 36;
export const MSL_PLANNING_LEAD_MONTHS = 2;

export type ProcurementForecastRow = {
  month: number;
  requirementMonth: number;
  planningMonth: number;
  tranche: string;
  trancheName: string;
  units: number;
  coreUnits: number;
  proUnits: number;
  apexUnits: number;
  procurementLakh: number;
  financialImpactMonth: number;
  trigger: "MSL-2M" | "scheduled" | "none";
  status: "planned" | "watch" | "no-buy";
};

export function trancheForMonth(month: number) {
  const direct = TRANCHES.find((x) => x.month === month);
  if (direct) return direct;
  const previous = [...TRANCHES].filter((x) => x.month <= month).sort((a, b) => b.month - a.month)[0];
  return previous ?? TRANCHES[0];
}

export function buildProcurementForecast(
  scenario: ScenarioId,
  finance: FinanceAssumptions,
  drawStandby: boolean,
): ProcurementForecastRow[] {
  const rows = buildModelWithInputs(scenario, drawStandby, finance);
  return rows.map((row) => {
    const procurement = Number(row.inventoryBuy.toFixed(2));
    const active = row.units > 0 || procurement > 0;
    const planningMonth = Math.max(1, row.m - MSL_PLANNING_LEAD_MONTHS);
    const tranche = trancheForMonth(row.m);
    const trigger = procurement > 0 ? "MSL-2M" : active ? "scheduled" : "none";
    return {
      month: row.m,
      requirementMonth: row.m,
      planningMonth,
      tranche: tranche.id,
      trancheName: tranche.name,
      units: row.units,
      coreUnits: row.aluminiumUnits,
      proUnits: row.carbonUnits,
      apexUnits: row.premiumCarbonUnits,
      procurementLakh: procurement,
      financialImpactMonth: row.m,
      trigger,
      status: procurement > 0 ? "planned" : active ? "watch" : "no-buy",
    };
  });
}

export function procurementSummary(
  scenario: ScenarioId,
  finance: FinanceAssumptions,
  drawStandby: boolean,
) {
  const rows = buildProcurementForecast(scenario, finance, drawStandby);
  return {
    scenario,
    horizonMonths: PROCUREMENT_PLANNING_HORIZON,
    planningLeadMonths: MSL_PLANNING_LEAD_MONTHS,
    totalProcurementLakh: rows.reduce((sum, row) => sum + row.procurementLakh, 0),
    procurementMonths: rows.filter((row) => row.procurementLakh > 0).length,
    firstPlanningMonth: rows.find((row) => row.procurementLakh > 0)?.planningMonth ?? null,
    rows,
  };
}
