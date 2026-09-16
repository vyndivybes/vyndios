export type MaterialCostLine = {
  sku: string;
  description?: string;
  quantityIssued: number;
  actualUnitCostInr: number;
  standardUnitCostInr?: number;
};

export type LabourCostLine = {
  role: string;
  hours: number;
  hourlyRateInr: number;
};

export type OutsourcingCostLine = {
  reference: string;
  amountInr: number;
};

export type OverheadCostLine = {
  category: string;
  amountInr: number;
  allocationPct?: number;
};

export type JobCostInput = {
  jobCardId: string;
  model: string;
  plannedQuantity: number;
  completedQuantity: number;
  material: MaterialCostLine[];
  labour?: LabourCostLine[];
  outsourcing?: OutsourcingCostLine[];
  manufacturingConsumablesInr?: number;
  manufacturingDepreciationInr?: number;
  supportDepreciationInr?: number;
  otherOverhead?: OverheadCostLine[];
  scrapCostInr?: number;
  reworkCostInr?: number;
};

export type JobCostResult = {
  jobCardId: string;
  model: string;
  plannedQuantity: number;
  completedQuantity: number;
  materialActualInr: number;
  materialStandardInr: number;
  materialVarianceInr: number;
  directLabourInr: number;
  outsourcingInr: number;
  manufacturingConsumablesInr: number;
  manufacturingDepreciationInr: number;
  supportDepreciationInr: number;
  otherOverheadInr: number;
  scrapInr: number;
  reworkInr: number;
  totalActualCostInr: number;
  unitActualCostInr: number;
  finishedGoodsValueInr: number;
  wipValueInr: number;
};

const positive = (value: number | null | undefined) => Math.max(0, Number(value ?? 0));

export function buildJobCost(input: JobCostInput): JobCostResult {
  const plannedQuantity = positive(input.plannedQuantity);
  const completedQuantity = Math.min(plannedQuantity, positive(input.completedQuantity));

  const materialActualInr = input.material.reduce(
    (sum, line) => sum + positive(line.quantityIssued) * positive(line.actualUnitCostInr),
    0,
  );
  const materialStandardInr = input.material.reduce(
    (sum, line) => sum + positive(line.quantityIssued) * positive(line.standardUnitCostInr ?? line.actualUnitCostInr),
    0,
  );
  const directLabourInr = (input.labour ?? []).reduce(
    (sum, line) => sum + positive(line.hours) * positive(line.hourlyRateInr),
    0,
  );
  const outsourcingInr = (input.outsourcing ?? []).reduce(
    (sum, line) => sum + positive(line.amountInr),
    0,
  );
  const otherOverheadInr = (input.otherOverhead ?? []).reduce(
    (sum, line) => sum + positive(line.amountInr) * positive(line.allocationPct ?? 100) / 100,
    0,
  );
  const manufacturingConsumablesInr = positive(input.manufacturingConsumablesInr);
  const manufacturingDepreciationInr = positive(input.manufacturingDepreciationInr);
  const supportDepreciationInr = positive(input.supportDepreciationInr);
  const scrapInr = positive(input.scrapCostInr);
  const reworkInr = positive(input.reworkCostInr);

  const totalActualCostInr =
    materialActualInr +
    directLabourInr +
    outsourcingInr +
    manufacturingConsumablesInr +
    manufacturingDepreciationInr +
    supportDepreciationInr +
    otherOverheadInr +
    scrapInr +
    reworkInr;

  const unitActualCostInr = plannedQuantity > 0 ? totalActualCostInr / plannedQuantity : 0;
  const finishedGoodsValueInr = unitActualCostInr * completedQuantity;
  const wipValueInr = Math.max(0, totalActualCostInr - finishedGoodsValueInr);

  return {
    jobCardId: input.jobCardId,
    model: input.model,
    plannedQuantity,
    completedQuantity,
    materialActualInr,
    materialStandardInr,
    materialVarianceInr: materialActualInr - materialStandardInr,
    directLabourInr,
    outsourcingInr,
    manufacturingConsumablesInr,
    manufacturingDepreciationInr,
    supportDepreciationInr,
    otherOverheadInr,
    scrapInr,
    reworkInr,
    totalActualCostInr,
    unitActualCostInr,
    finishedGoodsValueInr,
    wipValueInr,
  };
}
