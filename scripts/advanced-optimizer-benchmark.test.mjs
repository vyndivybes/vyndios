import assert from "node:assert/strict";
import test from "node:test";
import {
  ADVANCED_PLANNING_MODEL_VERSION,
  type AdvancedPlanningConstraintModel,
} from "../src/lib/advanced-planning-constraints.ts";
import {
  runGovernedAdvancedOptimizer,
  type AdvancedPlanningOptimizer,
} from "../src/lib/advanced-planning-optimizer.ts";

function benchmarkModel(): AdvancedPlanningConstraintModel {
  return {
    modelVersion: ADVANCED_PLANNING_MODEL_VERSION,
    horizonPeriods: 1,
    demands: [{ id: "D1", productId: "altitude", period: 1, quantity: 1, priority: 10, truth: "committed" }],
    bom: [{ id: "B1", productId: "altitude", sku: "FRAME", quantityPerUnit: 1 }],
    materials: [{ sku: "FRAME", onHandQty: 2, reservedQty: 0, safetyStockQty: 0 }],
    committedReceipts: [],
    resources: [{
      id: "WC1", name: "Assembly", type: "work_center", capabilities: ["ASSEMBLY"], efficiency: 1,
      capacity: [{ period: 1, availableHours: 8 }],
    }],
    routingOperations: [{
      id: "OP1", productId: "altitude", operationCode: "ASSEMBLY", sequence: 10,
      eligibleResourceIds: ["WC1"], runHoursPerUnit: 1,
    }],
    supplierLanes: [],
    objectiveWeights: {
      unmetCommittedDemand: 100, unmetForecastDemand: 30, lateness: 50, resourceOverload: 100,
      supplierOverload: 100, procurementCost: 5, workingCapital: 3, scheduleChange: 2,
    },
  };
}

function deterministicOptimizer(): AdvancedPlanningOptimizer {
  return {
    metadata: { id: "BENCH", version: "1.0.0", solverClass: "milp", engine: "benchmark", deterministic: true },
    async solve(model) {
      return {
        status: "optimal",
        objectiveValue: 0,
        objectiveContributions: Object.entries(model.objectiveWeights).map(([objective, weight]) => ({
          objective: objective as keyof typeof model.objectiveWeights,
          rawValue: 0,
          weight,
          weightedValue: 0,
        })),
        solution: {
          demandOutcomes: [{ demandId: "D1", servedQty: 1, unmetQty: 0, latenessPeriods: 0 }],
          production: [{ productId: "altitude", period: 1, quantity: 1 }],
          procurement: [],
          resourceAssignments: [{ operationId: "OP1", resourceId: "WC1", period: 1, quantity: 1, loadHours: 1 }],
        },
        bindingConstraints: [{
          code: "MATERIAL_BALANCE", entityType: "material", entityId: "FRAME", period: 1, slack: 1,
          message: "Governed inventory covers committed demand.",
        }],
        diagnostics: ["deterministic benchmark"],
      };
    },
  };
}

test("optimizer benchmark is deterministic for the same governed model", async () => {
  const model = benchmarkModel();
  const a = await runGovernedAdvancedOptimizer(model, deterministicOptimizer(), { requestId: "BENCH-A" });
  const b = await runGovernedAdvancedOptimizer(model, deterministicOptimizer(), { requestId: "BENCH-B" });
  assert.equal(a.accepted, true);
  assert.equal(b.accepted, true);
  assert.deepEqual(a.result, b.result);
  assert.equal(a.result?.objectiveValue, 0);
});

test("optimizer benchmark blocks infeasible governed constraint input before solve", async () => {
  const model = benchmarkModel();
  model.resources[0].efficiency = 2;
  let called = false;
  const optimizer = deterministicOptimizer();
  optimizer.solve = async () => {
    called = true;
    throw new Error("must not run");
  };
  const result = await runGovernedAdvancedOptimizer(model, optimizer, { requestId: "BENCH-INFEASIBLE" });
  assert.equal(called, false);
  assert.equal(result.accepted, false);
  assert.ok(result.issues.some((issue) => /constraint|efficiency|model/i.test(issue.code + issue.message)));
});
