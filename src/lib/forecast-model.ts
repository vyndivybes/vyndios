export type ForecastTask = {
  id: string;
  optimisticDays: number | null;
  mostLikelyDays: number | null;
  pessimisticDays: number | null;
  costForecastRequired: boolean;
  costOptimisticLakh: number | null;
  costMostLikelyLakh: number | null;
  costPessimisticLakh: number | null;
};

export type ForecastDependency = {
  predecessorId: string;
  successorId: string;
  lagDays: number;
};

type PertEstimate =
  | { valid: true; mean: number; variance: number }
  | { valid: false; mean: null; variance: null };

const round1 = (value: number) => Math.round(value * 10) / 10;

export function pertEstimate(
  optimistic: number | null,
  mostLikely: number | null,
  pessimistic: number | null,
): PertEstimate {
  if (
    optimistic == null ||
    mostLikely == null ||
    pessimistic == null ||
    !Number.isFinite(optimistic) ||
    !Number.isFinite(mostLikely) ||
    !Number.isFinite(pessimistic) ||
    optimistic <= 0 ||
    optimistic > mostLikely ||
    mostLikely > pessimistic
  ) {
    return { valid: false, mean: null, variance: null };
  }
  const mean = (optimistic + 4 * mostLikely + pessimistic) / 6;
  const variance = Math.pow((pessimistic - optimistic) / 6, 2);
  return { valid: true, mean, variance };
}

function pertCostEstimate(
  optimistic: number | null,
  mostLikely: number | null,
  pessimistic: number | null,
): PertEstimate {
  if (
    optimistic == null ||
    mostLikely == null ||
    pessimistic == null ||
    !Number.isFinite(optimistic) ||
    !Number.isFinite(mostLikely) ||
    !Number.isFinite(pessimistic) ||
    optimistic < 0 ||
    optimistic > mostLikely ||
    mostLikely > pessimistic
  ) {
    return { valid: false, mean: null, variance: null };
  }
  const mean = (optimistic + 4 * mostLikely + pessimistic) / 6;
  const variance = Math.pow((pessimistic - optimistic) / 6, 2);
  return { valid: true, mean, variance };
}

function quantiles(mean: number, variance: number) {
  const sd = Math.sqrt(Math.max(0, variance));
  return {
    p50: round1(mean),
    p80: round1(mean + 0.841621 * sd),
    p95: round1(mean + 1.644854 * sd),
  };
}

function topologicalOrder(
  tasks: ForecastTask[],
  dependencies: ForecastDependency[],
) {
  const ids = new Set(tasks.map((task) => task.id));
  const indegree = new Map<string, number>();
  const successors = new Map<string, ForecastDependency[]>();
  const predecessors = new Map<string, ForecastDependency[]>();
  for (const id of ids) {
    indegree.set(id, 0);
    successors.set(id, []);
    predecessors.set(id, []);
  }

  for (const dependency of dependencies) {
    if (!ids.has(dependency.predecessorId) || !ids.has(dependency.successorId)) {
      return { valid:false as const, order:[] as string[], successors, predecessors, reason:"Broken dependency reference." };
    }
    if (dependency.predecessorId === dependency.successorId || dependency.lagDays < 0) {
      return { valid:false as const, order:[] as string[], successors, predecessors, reason:"Invalid dependency relationship." };
    }
    successors.get(dependency.predecessorId)!.push(dependency);
    predecessors.get(dependency.successorId)!.push(dependency);
    indegree.set(dependency.successorId, (indegree.get(dependency.successorId) ?? 0) + 1);
  }

  const queue = [...ids].filter((id) => indegree.get(id) === 0).sort();
  const order:string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const dependency of successors.get(id) ?? []) {
      const next = dependency.successorId;
      const remaining = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, remaining);
      if (remaining === 0) {
        queue.push(next);
        queue.sort();
      }
    }
  }

  return order.length === ids.size
    ? { valid:true as const, order, successors, predecessors, reason:null }
    : { valid:false as const, order, successors, predecessors, reason:"Dependency cycle prevents schedule forecasting." };
}

export function buildProgramForecast(input: {
  tasks: ForecastTask[];
  dependencies: ForecastDependency[];
}) {
  const scheduleStats = new Map<string, { mean:number; variance:number }>();
  const missingTaskIds:string[] = [];
  for (const task of input.tasks) {
    const estimate = pertEstimate(
      task.optimisticDays,
      task.mostLikelyDays,
      task.pessimisticDays,
    );
    if (!estimate.valid) missingTaskIds.push(task.id);
    else scheduleStats.set(task.id, { mean:estimate.mean, variance:estimate.variance });
  }

  const scheduleCoveragePct = input.tasks.length
    ? round1((scheduleStats.size / input.tasks.length) * 100)
    : 0;
  const topo = topologicalOrder(input.tasks, input.dependencies);

  let schedule = {
    available: false,
    coveragePct: scheduleCoveragePct,
    missingTaskIds: [...missingTaskIds].sort(),
    criticalPath: [] as string[],
    p50Days: null as number | null,
    p80Days: null as number | null,
    p95Days: null as number | null,
    reason: input.tasks.length ? "Three-point schedule inputs are incomplete." : "No governed program tasks exist.",
  };

  if (
    input.tasks.length > 0 &&
    missingTaskIds.length === 0 &&
    topo.valid
  ) {
    const earliestFinish = new Map<string, number>();
    const parent = new Map<string, string>();
    for (const id of topo.order) {
      const stats = scheduleStats.get(id)!;
      let start = 0;
      let selectedParent:string | undefined;
      for (const dependency of topo.predecessors.get(id) ?? []) {
        const candidate = (earliestFinish.get(dependency.predecessorId) ?? 0) + dependency.lagDays;
        if (
          candidate > start ||
          (candidate === start && selectedParent && dependency.predecessorId < selectedParent)
        ) {
          start = candidate;
          selectedParent = dependency.predecessorId;
        }
      }
      earliestFinish.set(id, start + stats.mean);
      if (selectedParent) parent.set(id, selectedParent);
    }

    let terminal = topo.order[0]!;
    for (const id of topo.order) {
      const finish = earliestFinish.get(id) ?? 0;
      const current = earliestFinish.get(terminal) ?? 0;
      if (finish > current || (finish === current && id < terminal)) terminal = id;
    }

    const path:string[] = [];
    let cursor:string|undefined = terminal;
    while (cursor) {
      path.push(cursor);
      cursor = parent.get(cursor);
    }
    path.reverse();

    const mean = earliestFinish.get(terminal) ?? 0;
    const variance = path.reduce(
      (sum, id) => sum + (scheduleStats.get(id)?.variance ?? 0),
      0,
    );
    const q = quantiles(mean, variance);
    schedule = {
      available: true,
      coveragePct: 100,
      missingTaskIds: [],
      criticalPath: path,
      p50Days: q.p50,
      p80Days: q.p80,
      p95Days: q.p95,
      reason: "PERT-normal approximation from complete governed three-point task estimates.",
    };
  } else if (!topo.valid && input.tasks.length > 0 && missingTaskIds.length === 0) {
    schedule.reason = topo.reason ?? "Program network is invalid.";
  }

  const costRequired = input.tasks.filter((task) => task.costForecastRequired);
  const costStats = costRequired
    .map((task) => ({
      task,
      estimate: pertCostEstimate(
        task.costOptimisticLakh,
        task.costMostLikelyLakh,
        task.costPessimisticLakh,
      ),
    }));
  const costComplete = costStats.filter((item) => item.estimate.valid);
  const costCoveragePct = costRequired.length
    ? round1((costComplete.length / costRequired.length) * 100)
    : 0;

  let cost = {
    available:false,
    coveragePct:costCoveragePct,
    requiredTaskCount:costRequired.length,
    missingTaskIds:costStats.filter((item)=>!item.estimate.valid).map((item)=>item.task.id).sort(),
    p50Lakh:null as number|null,
    p80Lakh:null as number|null,
    p95Lakh:null as number|null,
    reason:costRequired.length ? "Three-point cost inputs are incomplete." : "No program tasks are marked cost-forecast required.",
  };

  if (costRequired.length > 0 && costComplete.length === costRequired.length) {
    const mean = costComplete.reduce((sum,item)=>sum+(item.estimate.valid?item.estimate.mean:0),0);
    const variance = costComplete.reduce((sum,item)=>sum+(item.estimate.valid?item.estimate.variance:0),0);
    const q=quantiles(mean,variance);
    cost={
      available:true,
      coveragePct:100,
      requiredTaskCount:costRequired.length,
      missingTaskIds:[],
      p50Lakh:q.p50,
      p80Lakh:q.p80,
      p95Lakh:q.p95,
      reason:"PERT-normal approximation from complete governed cost estimates.",
    };
  }

  return {
    method:"PERT_NORMAL_APPROXIMATION" as const,
    schedule,
    cost,
    limitations:[
      "Critical path is fixed at expected task durations; path switching under uncertainty is not modeled.",
      "Task uncertainty and cost uncertainty are treated as independent; correlation is not modeled.",
      "These are planning quantiles, not promised completion dates or approved budgets.",
      "Monte Carlo simulation is a later governed engine.",
    ],
  };
}
