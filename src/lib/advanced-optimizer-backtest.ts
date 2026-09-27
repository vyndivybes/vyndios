export type OptimizerBacktestObservation = {
  id: string;
  plannedQuantity: number;
  actualQuantity: number;
  plannedCost?: number;
  actualCost?: number;
};

export type OptimizerBacktestSummary = {
  samples: number;
  meanAbsoluteQuantityError: number;
  quantityBias: number;
  meanAbsoluteCostError: number | null;
};

export function summarizeOptimizerBacktest(
  observations: OptimizerBacktestObservation[],
): OptimizerBacktestSummary {
  if (!observations.length) {
    return {
      samples: 0,
      meanAbsoluteQuantityError: 0,
      quantityBias: 0,
      meanAbsoluteCostError: null,
    };
  }

  const quantityErrors = observations.map((row) => row.actualQuantity - row.plannedQuantity);
  const costErrors = observations
    .filter((row) => row.plannedCost != null && row.actualCost != null)
    .map((row) => Number(row.actualCost) - Number(row.plannedCost));

  return {
    samples: observations.length,
    meanAbsoluteQuantityError:
      quantityErrors.reduce((sum, value) => sum + Math.abs(value), 0) / observations.length,
    quantityBias: quantityErrors.reduce((sum, value) => sum + value, 0) / observations.length,
    meanAbsoluteCostError:
      costErrors.length > 0
        ? costErrors.reduce((sum, value) => sum + Math.abs(value), 0) / costErrors.length
        : null,
  };
}
