import assert from "node:assert/strict";
import test from "node:test";
import { summarizeOptimizerBacktest } from "../src/lib/advanced-optimizer-backtest.ts";

test("optimizer backtest quantifies plan versus actual quantity and cost variance", () => {
  const summary = summarizeOptimizerBacktest([
    { id: "A", plannedQuantity: 10, actualQuantity: 9, plannedCost: 100, actualCost: 110 },
    { id: "B", plannedQuantity: 5, actualQuantity: 7, plannedCost: 50, actualCost: 45 },
    { id: "C", plannedQuantity: 8, actualQuantity: 8 },
  ]);

  assert.equal(summary.samples, 3);
  assert.equal(summary.meanAbsoluteQuantityError, 1);
  assert.equal(summary.quantityBias, 1 / 3);
  assert.equal(summary.meanAbsoluteCostError, 7.5);
});

test("optimizer backtest handles an empty historical actual set without fabricating evidence", () => {
  assert.deepEqual(summarizeOptimizerBacktest([]), {
    samples: 0,
    meanAbsoluteQuantityError: 0,
    quantityBias: 0,
    meanAbsoluteCostError: null,
  });
});
