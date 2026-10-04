export type EarnedValueTaskStatus =
  | "planned"
  | "ready"
  | "in_progress"
  | "blocked"
  | "complete"
  | "waived";

export type EarnedValueTaskInput = {
  id: string;
  status: EarnedValueTaskStatus;
  plannedStart: string | null;
  plannedFinish: string | null;
  actualStart?: string | null;
  budgetAtCompletionLakh: number | null;
  progressPct: number | null;
  progressSourceRef: string | null;
  actualCostLakh: number | null;
  actualCostSourceRef: string | null;
};

export type EarnedValueSnapshotInput = {
  asOfDate: string;
  tasks: EarnedValueTaskInput[];
};

const DAY_MS = 86_400_000;
const round4 = (value: number) => Math.round(value * 10_000) / 10_000;
const clean = (value: string | null | undefined) => value?.trim() ?? "";

function dateValue(value: string | null | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const time = Date.parse(value + "T00:00:00Z");
  return Number.isFinite(time) ? time : null;
}

function plannedFraction(asOfDate: string, start: string | null, finish: string | null) {
  const asOf = dateValue(asOfDate);
  const from = dateValue(start);
  const to = dateValue(finish);
  if (asOf == null || from == null || to == null || to < from) return null;
  if (asOf < from) return 0;
  if (asOf >= to) return 1;
  if (to === from) return 1;
  return Math.max(0, Math.min(1, (asOf - from) / Math.max(DAY_MS, to - from)));
}

function progressEvidenceRequired(task: EarnedValueTaskInput) {
  if (task.status === "in_progress") return true;
  if (task.status !== "blocked") return false;
  return Boolean(clean(task.actualStart) || task.progressPct != null || clean(task.progressSourceRef));
}

function earnedFraction(task: EarnedValueTaskInput) {
  if (task.status === "complete") return 1;
  if (!progressEvidenceRequired(task)) return 0;
  if (
    task.progressPct == null ||
    !Number.isFinite(task.progressPct) ||
    task.progressPct < 0 ||
    task.progressPct > 100 ||
    !clean(task.progressSourceRef)
  ) return null;
  return task.progressPct / 100;
}

function actualCostRequired(task: EarnedValueTaskInput) {
  return task.status === "in_progress" || task.status === "complete" || Boolean(clean(task.actualStart));
}

function ratio(numerator: number, denominator: number) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  return round4(numerator / denominator);
}

export function buildEarnedValueSnapshot(input: EarnedValueSnapshotInput) {
  const budgetedTasks = input.tasks.filter((task) =>
    task.budgetAtCompletionLakh != null &&
    Number.isFinite(task.budgetAtCompletionLakh) &&
    task.budgetAtCompletionLakh >= 0
  );

  const missingBudgetTaskIds = input.tasks
    .filter((task) => task.budgetAtCompletionLakh == null || !Number.isFinite(task.budgetAtCompletionLakh) || task.budgetAtCompletionLakh < 0)
    .map((task) => task.id)
    .sort();

  const missingPlanTaskIds: string[] = [];
  const missingProgressTaskIds: string[] = [];
  const missingActualCostTaskIds: string[] = [];
  const taskResults: Array<{
    id: string;
    bacLakh: number;
    plannedFraction: number | null;
    earnedFraction: number | null;
    pvLakh: number | null;
    evLakh: number | null;
    acLakh: number | null;
  }> = [];

  let bac = 0;
  let pv = 0;
  let ev = 0;
  let ac = 0;
  let progressRequired = 0;
  let progressCovered = 0;
  let actualCostRequiredCount = 0;
  let actualCostCovered = 0;

  for (const task of budgetedTasks) {
    const taskBac = Number(task.budgetAtCompletionLakh);
    bac += taskBac;

    const planned = plannedFraction(input.asOfDate, task.plannedStart, task.plannedFinish);
    if (planned == null) missingPlanTaskIds.push(task.id);
    else pv += taskBac * planned;

    const earned = earnedFraction(task);
    if (progressEvidenceRequired(task)) {
      progressRequired += 1;
      if (earned == null) missingProgressTaskIds.push(task.id);
      else progressCovered += 1;
    }
    if (earned != null) ev += taskBac * earned;

    const requiresActualCost = actualCostRequired(task);
    let taskActualCost: number | null = null;
    if (requiresActualCost) {
      actualCostRequiredCount += 1;
      if (
        task.actualCostLakh == null ||
        !Number.isFinite(task.actualCostLakh) ||
        task.actualCostLakh < 0 ||
        !clean(task.actualCostSourceRef)
      ) {
        missingActualCostTaskIds.push(task.id);
      } else {
        taskActualCost = Number(task.actualCostLakh);
        ac += taskActualCost;
        actualCostCovered += 1;
      }
    } else if (
      task.actualCostLakh != null &&
      Number.isFinite(task.actualCostLakh) &&
      task.actualCostLakh >= 0 &&
      clean(task.actualCostSourceRef)
    ) {
      taskActualCost = Number(task.actualCostLakh);
      ac += taskActualCost;
    }

    taskResults.push({
      id: task.id,
      bacLakh: round4(taskBac),
      plannedFraction: planned == null ? null : round4(planned),
      earnedFraction: earned == null ? null : round4(earned),
      pvLakh: planned == null ? null : round4(taskBac * planned),
      evLakh: earned == null ? null : round4(taskBac * earned),
      acLakh: taskActualCost == null ? null : round4(taskActualCost),
    });
  }

  const progressCoveragePct = progressRequired === 0 ? 100 : round4((progressCovered / progressRequired) * 100);
  const actualCostCoveragePct = actualCostRequiredCount === 0 ? 100 : round4((actualCostCovered / actualCostRequiredCount) * 100);
  const available =
    budgetedTasks.length > 0 &&
    bac > 0 &&
    missingBudgetTaskIds.length === 0 &&
    missingPlanTaskIds.length === 0 &&
    missingProgressTaskIds.length === 0 &&
    missingActualCostTaskIds.length === 0;

  const roundedBac = round4(bac);
  const roundedPv = round4(pv);
  const roundedEv = round4(ev);
  const roundedAc = round4(ac);
  const svLakh = available ? round4(roundedEv - roundedPv) : null;
  const cvLakh = available ? round4(roundedEv - roundedAc) : null;
  const rawSpi = available && roundedPv > 0 ? roundedEv / roundedPv : null;
  const rawCpi = available && roundedAc > 0 ? roundedEv / roundedAc : null;
  const spi = rawSpi == null ? null : round4(rawSpi);
  const cpi = rawCpi == null ? null : round4(rawCpi);
  const eacLakh = rawCpi != null && rawCpi > 0 ? round4(roundedBac / rawCpi) : null;
  const etcLakh = eacLakh == null ? null : round4(eacLakh - roundedAc);
  const vacLakh = eacLakh == null ? null : round4(roundedBac - eacLakh);
  const tcpiBac = available && roundedBac > roundedAc && (roundedPv > 0 || roundedEv > 0 || roundedAc > 0)
    ? ratio(roundedBac - roundedEv, roundedBac - roundedAc)
    : null;

  let reason = "Earned Value performance is available from governed program budget, schedule, progress and actual-cost evidence.";
  if (!available) {
    reason = "Earned Value performance withheld until evidence coverage is complete.";
    if (missingBudgetTaskIds.length) reason += " Missing budget: " + missingBudgetTaskIds.join(", ") + ".";
    if (missingPlanTaskIds.length) reason += " Missing/invalid plan dates: " + missingPlanTaskIds.join(", ") + ".";
    if (missingProgressTaskIds.length) reason += " Missing progress evidence: " + missingProgressTaskIds.join(", ") + ".";
    if (missingActualCostTaskIds.length) reason += " Missing actual-cost evidence: " + missingActualCostTaskIds.join(", ") + ".";
  }

  return {
    method: "VYNDI_EVM_1" as const,
    asOfDate: input.asOfDate,
    available,
    bacLakh: roundedBac,
    pvLakh: roundedPv,
    evLakh: roundedEv,
    acLakh: roundedAc,
    svLakh,
    cvLakh,
    spi,
    cpi,
    eacLakh,
    etcLakh,
    vacLakh,
    tcpiBac,
    progressCoveragePct,
    actualCostCoveragePct,
    missingBudgetTaskIds,
    missingPlanTaskIds: missingPlanTaskIds.sort(),
    missingProgressTaskIds: missingProgressTaskIds.sort(),
    missingActualCostTaskIds: missingActualCostTaskIds.sort(),
    reason,
    tasks: taskResults.sort((a, b) => a.id.localeCompare(b.id)),
    boundaries: [
      "EV is computed from governed task completion/progress evidence; no editable EV amount exists.",
      "Completed tasks earn 100%; in-progress tasks and blocked tasks with execution history require explicit progress percentage and evidence reference.",
      "Active tasks require explicit actual-cost evidence before CPI/EAC are published.",
      "PV is time-phased linearly between governed planned start and finish dates; no hidden weighting is applied.",
      "EAC uses BAC/CPI. ETC = EAC - AC, VAC = BAC - EAC, and TCPI is calculated against BAC when the denominator is valid.",
      "All outputs are advisory program-control evidence and do not approve budgets, payments, schedules or engineering release.",
    ],
  };
}
