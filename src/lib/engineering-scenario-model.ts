import type { CompiledVedmAuthorityGraph } from "./vedm-authority-graph.ts";
import { analyzeEngineeringImpact } from "./impact-propagation-model.ts";
import {
  buildProgramForecast,
  type ForecastDependency,
  type ForecastTask,
} from "./forecast-model.ts";

export type EngineeringScenarioRequest = {
  sourceNodeId: string;
  targetTaskId: string | null;
  scheduleOverride: {
    optimisticDays: number;
    mostLikelyDays: number;
    pessimisticDays: number;
  } | null;
  costOverride: {
    optimisticLakh: number;
    mostLikelyLakh: number;
    pessimisticLakh: number;
  } | null;
};

export type EngineeringScenarioInput = {
  graph: CompiledVedmAuthorityGraph;
  tasks: ForecastTask[];
  dependencies: ForecastDependency[];
  request: EngineeringScenarioRequest;
};

const delta = (scenario: number | null, baseline: number | null) =>
  scenario == null || baseline == null ? null : Math.round((scenario - baseline) * 10) / 10;

export function buildEngineeringScenario(input: EngineeringScenarioInput) {
  const impact = analyzeEngineeringImpact(input.graph, input.request.sourceNodeId);
  if (!impact.valid) {
    return {
      valid: false as const,
      impact,
      baseline: buildProgramForecast({ tasks: input.tasks, dependencies: input.dependencies }),
      scenario: buildProgramForecast({ tasks: input.tasks, dependencies: input.dependencies }),
      scheduleDelta: null,
      costDelta: null,
      issues: [...impact.issues],
    };
  }

  const hasOverride = Boolean(input.request.scheduleOverride || input.request.costOverride);
  if (hasOverride && !input.request.targetTaskId) {
    return {
      valid: false as const,
      impact,
      baseline: buildProgramForecast({ tasks: input.tasks, dependencies: input.dependencies }),
      scenario: buildProgramForecast({ tasks: input.tasks, dependencies: input.dependencies }),
      scheduleDelta: null,
      costDelta: null,
      issues: ["A governed target program task is required when scenario schedule or cost assumptions are supplied."],
    };
  }

  if (
    input.request.targetTaskId &&
    hasOverride &&
    !input.tasks.some((task) => task.id === input.request.targetTaskId)
  ) {
    return {
      valid: false as const,
      impact,
      baseline: buildProgramForecast({ tasks: input.tasks, dependencies: input.dependencies }),
      scenario: buildProgramForecast({ tasks: input.tasks, dependencies: input.dependencies }),
      scheduleDelta: null,
      costDelta: null,
      issues: [`Scenario target task ${input.request.targetTaskId} is not present in the governed program plan.`],
    };
  }

  const baseline = buildProgramForecast({
    tasks: input.tasks,
    dependencies: input.dependencies,
  });

  const scenarioTasks = input.tasks.map((task) => {
    if (!input.request.targetTaskId || task.id !== input.request.targetTaskId) {
      return { ...task };
    }
    const schedule = input.request.scheduleOverride;
    const cost = input.request.costOverride;
    return {
      ...task,
      optimisticDays: schedule?.optimisticDays ?? task.optimisticDays,
      mostLikelyDays: schedule?.mostLikelyDays ?? task.mostLikelyDays,
      pessimisticDays: schedule?.pessimisticDays ?? task.pessimisticDays,
      costOptimisticLakh: cost?.optimisticLakh ?? task.costOptimisticLakh,
      costMostLikelyLakh: cost?.mostLikelyLakh ?? task.costMostLikelyLakh,
      costPessimisticLakh: cost?.pessimisticLakh ?? task.costPessimisticLakh,
      costForecastRequired: cost ? true : task.costForecastRequired,
    };
  });

  const scenario = buildProgramForecast({
    tasks: scenarioTasks,
    dependencies: input.dependencies,
  });

  const scheduleDelta =
    baseline.schedule.available && scenario.schedule.available
      ? {
          p50Days: delta(scenario.schedule.p50Days, baseline.schedule.p50Days),
          p80Days: delta(scenario.schedule.p80Days, baseline.schedule.p80Days),
          p95Days: delta(scenario.schedule.p95Days, baseline.schedule.p95Days),
        }
      : null;

  const costDelta =
    baseline.cost.available && scenario.cost.available
      ? {
          p50Lakh: delta(scenario.cost.p50Lakh, baseline.cost.p50Lakh),
          p80Lakh: delta(scenario.cost.p80Lakh, baseline.cost.p80Lakh),
          p95Lakh: delta(scenario.cost.p95Lakh, baseline.cost.p95Lakh),
        }
      : null;

  return {
    valid: true as const,
    impact,
    baseline,
    scenario,
    scheduleDelta,
    costDelta,
    scenarioAssumptions: {
      targetTaskId: input.request.targetTaskId,
      scheduleOverride: input.request.scheduleOverride,
      costOverride: input.request.costOverride,
    },
    issues: [
      ...impact.issues,
      ...(scheduleDelta ? [] : ["Schedule delta is withheld because both baseline and scenario do not have complete governed schedule uncertainty inputs."]),
      ...(costDelta ? [] : ["Cost delta is withheld because both baseline and scenario do not have complete governed cost uncertainty inputs."]),
    ],
  };
}
