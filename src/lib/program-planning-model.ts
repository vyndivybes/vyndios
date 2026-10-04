export type ProgramTaskStatus =
  | "planned"
  | "ready"
  | "in_progress"
  | "blocked"
  | "complete"
  | "waived";

export type ProgramTaskInput = {
  id: string;
  title: string;
  durationDays: number;
  status: ProgramTaskStatus;
};

export type ProgramDependencyInput = {
  predecessorId: string;
  successorId: string;
  lagDays: number;
};

export type ProgramPlanningIssue = {
  code:
    | "DUPLICATE_TASK"
    | "INVALID_DURATION"
    | "INVALID_LAG"
    | "BROKEN_DEPENDENCY"
    | "SELF_DEPENDENCY"
    | "DEPENDENCY_CYCLE";
  taskId?: string;
  dependency?: ProgramDependencyInput;
  message: string;
};

export type ProgramTaskSchedule = ProgramTaskInput & {
  earliestStartDay: number;
  earliestFinishDay: number;
  latestStartDay: number;
  latestFinishDay: number;
  slackDays: number;
  critical: boolean;
};

export type ProgramNetworkResult = {
  valid: boolean;
  projectDurationDays: number | null;
  criticalPath: string[];
  cycleTaskIds: string[];
  topologicalOrder: string[];
  taskById: Record<string, ProgramTaskSchedule | undefined>;
  issues: ProgramPlanningIssue[];
};

const wholeDay = (value: number) =>
  Number.isFinite(value) && Number.isInteger(value);

export function buildProgramNetwork(
  tasks: ProgramTaskInput[],
  dependencies: ProgramDependencyInput[],
): ProgramNetworkResult {
  const issues: ProgramPlanningIssue[] = [];
  const taskMap = new Map<string, ProgramTaskInput>();

  for (const task of tasks) {
    if (taskMap.has(task.id)) {
      issues.push({
        code: "DUPLICATE_TASK",
        taskId: task.id,
        message: `Task ${task.id} is duplicated.`,
      });
      continue;
    }
    if (!wholeDay(task.durationDays) || task.durationDays <= 0) {
      issues.push({
        code: "INVALID_DURATION",
        taskId: task.id,
        message: `Task ${task.id} must have a positive whole-day duration.`,
      });
    }
    taskMap.set(task.id, task);
  }

  const predecessors = new Map<string, ProgramDependencyInput[]>();
  const successors = new Map<string, ProgramDependencyInput[]>();
  const indegree = new Map<string, number>();
  for (const id of taskMap.keys()) {
    predecessors.set(id, []);
    successors.set(id, []);
    indegree.set(id, 0);
  }

  for (const dependency of dependencies) {
    const predecessor = taskMap.get(dependency.predecessorId);
    const successor = taskMap.get(dependency.successorId);
    if (!predecessor || !successor) {
      issues.push({
        code: "BROKEN_DEPENDENCY",
        dependency,
        message: `Dependency ${dependency.predecessorId} → ${dependency.successorId} references a missing task.`,
      });
      continue;
    }
    if (dependency.predecessorId === dependency.successorId) {
      issues.push({
        code: "SELF_DEPENDENCY",
        taskId: dependency.predecessorId,
        dependency,
        message: `Task ${dependency.predecessorId} cannot depend on itself.`,
      });
      continue;
    }
    if (!wholeDay(dependency.lagDays) || dependency.lagDays < 0) {
      issues.push({
        code: "INVALID_LAG",
        dependency,
        message: `Dependency ${dependency.predecessorId} → ${dependency.successorId} has an invalid lag.`,
      });
      continue;
    }
    predecessors.get(dependency.successorId)!.push(dependency);
    successors.get(dependency.predecessorId)!.push(dependency);
    indegree.set(
      dependency.successorId,
      (indegree.get(dependency.successorId) ?? 0) + 1,
    );
  }

  if (issues.length) {
    return {
      valid: false,
      projectDurationDays: null,
      criticalPath: [],
      cycleTaskIds: [],
      topologicalOrder: [],
      taskById: {},
      issues,
    };
  }

  const queue = [...taskMap.keys()]
    .filter((id) => indegree.get(id) === 0)
    .sort();
  const topologicalOrder: string[] = [];

  while (queue.length) {
    const id = queue.shift()!;
    topologicalOrder.push(id);
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

  if (topologicalOrder.length !== taskMap.size) {
    const cycleTaskIds = [...taskMap.keys()]
      .filter((id) => (indegree.get(id) ?? 0) > 0)
      .sort();
    return {
      valid: false,
      projectDurationDays: null,
      criticalPath: [],
      cycleTaskIds,
      topologicalOrder,
      taskById: {},
      issues: [{
        code: "DEPENDENCY_CYCLE",
        message: `Program dependency cycle involves: ${cycleTaskIds.join(", ")}.`,
      }],
    };
  }

  const earliestStart = new Map<string, number>();
  const earliestFinish = new Map<string, number>();

  for (const id of topologicalOrder) {
    const start = Math.max(
      0,
      ...(predecessors.get(id) ?? []).map((dependency) =>
        (earliestFinish.get(dependency.predecessorId) ?? 0) + dependency.lagDays
      ),
    );
    earliestStart.set(id, start);
    earliestFinish.set(id, start + taskMap.get(id)!.durationDays);
  }

  const projectDurationDays = Math.max(
    0,
    ...[...earliestFinish.values()],
  );
  const latestFinish = new Map<string, number>();
  const latestStart = new Map<string, number>();

  for (const id of [...topologicalOrder].reverse()) {
    const outgoing = successors.get(id) ?? [];
    const finish = outgoing.length
      ? Math.min(
          ...outgoing.map((dependency) =>
            (latestStart.get(dependency.successorId) ?? projectDurationDays) -
            dependency.lagDays
          ),
        )
      : projectDurationDays;
    latestFinish.set(id, finish);
    latestStart.set(id, finish - taskMap.get(id)!.durationDays);
  }

  const taskById: Record<string, ProgramTaskSchedule | undefined> = {};
  for (const id of topologicalOrder) {
    const start = earliestStart.get(id) ?? 0;
    const finish = earliestFinish.get(id) ?? start;
    const latestStartDay = latestStart.get(id) ?? start;
    const latestFinishDay = latestFinish.get(id) ?? finish;
    const slackDays = latestStartDay - start;
    taskById[id] = {
      ...taskMap.get(id)!,
      earliestStartDay: start,
      earliestFinishDay: finish,
      latestStartDay,
      latestFinishDay,
      slackDays,
      critical: slackDays === 0,
    };
  }

  const criticalPath = topologicalOrder.filter(
    (id) => taskById[id]?.critical,
  );

  return {
    valid: true,
    projectDurationDays,
    criticalPath,
    cycleTaskIds: [],
    topologicalOrder,
    taskById,
    issues: [],
  };
}
