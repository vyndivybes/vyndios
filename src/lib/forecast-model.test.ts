import assert from "node:assert/strict";
import { test } from "node:test";
import { buildProgramForecast, pertEstimate } from "./forecast-model.ts";

test("PERT estimate uses explicit optimistic most-likely pessimistic inputs", () => {
  const estimate = pertEstimate(1, 2, 3);
  assert.equal(estimate.valid, true);
  assert.equal(estimate.mean, 2);
  assert.ok(Math.abs((estimate.variance ?? 0) - 1/9) < 1e-9);
});

test("invalid or incomplete three-point inputs do not produce a forecast", () => {
  assert.equal(pertEstimate(null, 2, 3).valid, false);
  assert.equal(pertEstimate(3, 2, 1).valid, false);
  assert.equal(pertEstimate(0, 1, 2).valid, false);
});

test("schedule P50 P80 P95 are emitted only with complete task uncertainty inputs", () => {
  const result = buildProgramForecast({
    tasks: [
      { id:"A", optimisticDays:1, mostLikelyDays:2, pessimisticDays:3, costForecastRequired:false, costOptimisticLakh:null, costMostLikelyLakh:null, costPessimisticLakh:null },
      { id:"B", optimisticDays:2, mostLikelyDays:4, pessimisticDays:8, costForecastRequired:false, costOptimisticLakh:null, costMostLikelyLakh:null, costPessimisticLakh:null },
    ],
    dependencies: [{ predecessorId:"A", successorId:"B", lagDays:0 }],
  });
  assert.equal(result.schedule.available, true);
  assert.deepEqual(result.schedule.criticalPath, ["A","B"]);
  assert.equal(result.schedule.p50Days, 6.3);
  assert.ok((result.schedule.p80Days ?? 0) > (result.schedule.p50Days ?? 0));
  assert.ok((result.schedule.p95Days ?? 0) > (result.schedule.p80Days ?? 0));
  assert.equal(result.method, "PERT_NORMAL_APPROXIMATION");
});

test("missing schedule uncertainty withholds P quantiles", () => {
  const result = buildProgramForecast({
    tasks: [
      { id:"A", optimisticDays:1, mostLikelyDays:2, pessimisticDays:3, costForecastRequired:false, costOptimisticLakh:null, costMostLikelyLakh:null, costPessimisticLakh:null },
      { id:"B", optimisticDays:null, mostLikelyDays:4, pessimisticDays:8, costForecastRequired:false, costOptimisticLakh:null, costMostLikelyLakh:null, costPessimisticLakh:null },
    ],
    dependencies: [],
  });
  assert.equal(result.schedule.available, false);
  assert.equal(result.schedule.coveragePct, 50);
  assert.deepEqual(result.schedule.missingTaskIds, ["B"]);
  assert.equal(result.schedule.p50Days, null);
});

test("cost forecast requires complete estimates for every task explicitly marked cost-required", () => {
  const complete = buildProgramForecast({
    tasks: [
      { id:"A", optimisticDays:1, mostLikelyDays:1, pessimisticDays:1, costForecastRequired:true, costOptimisticLakh:1, costMostLikelyLakh:2, costPessimisticLakh:3 },
      { id:"B", optimisticDays:1, mostLikelyDays:1, pessimisticDays:1, costForecastRequired:true, costOptimisticLakh:2, costMostLikelyLakh:3, costPessimisticLakh:4 },
    ],
    dependencies: [],
  });
  assert.equal(complete.cost.available, true);
  assert.equal(complete.cost.p50Lakh, 5);

  const incomplete = buildProgramForecast({
    tasks: [
      { id:"A", optimisticDays:1, mostLikelyDays:1, pessimisticDays:1, costForecastRequired:true, costOptimisticLakh:1, costMostLikelyLakh:null, costPessimisticLakh:3 },
    ],
    dependencies: [],
  });
  assert.equal(incomplete.cost.available, false);
  assert.equal(incomplete.cost.p50Lakh, null);
});

test("forecast declares PERT limitations instead of claiming Monte Carlo", () => {
  const result = buildProgramForecast({ tasks: [], dependencies: [] });
  assert.match(result.limitations.join(" "), /critical path/i);
  assert.match(result.limitations.join(" "), /correlation/i);
  assert.doesNotMatch(result.method, /MONTE_CARLO/);
});
