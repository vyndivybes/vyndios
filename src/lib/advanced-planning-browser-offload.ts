import type { AdvancedPlanningConstraintModel } from "./advanced-planning-constraints.ts";
import {
  compileAdvancedPlanningMathematicalModel,
  type MathConstraint,
  type MathVariable,
} from "./advanced-planning-math-model.ts";
import {
  compileGovernedHardCapitalConstraints,
  type GovernedHardCapitalEnvelope,
} from "./advanced-planning-hard-capital.ts";
import type { AdvancedOptimizationRequest } from "./advanced-planning-optimizer.ts";

export const VYNDI_BROWSER_SOLVER_OFFLOAD_VERSION = "VYNDI-HIGHS-BROWSER-OFFLOAD-0.1" as const;

export type BrowserHighsRawSolution = {
  Status: string;
  ObjectiveValue?: number;
  Columns?: Record<string, { Primal: number }>;
};

export type BrowserHighsSolveRequest = AdvancedOptimizationRequest & {
  hardCapitalEnvelope?: GovernedHardCapitalEnvelope;
};

export type BrowserHighsVerification = {
  valid: boolean;
  primalValidated: boolean;
  reportedStatus: "optimal" | "feasible" | "infeasible" | "indeterminate" | "error";
  issues: string[];
  expectedVariableCount: number;
  constraintCount: number;
  reconstructedObjectiveValue: number | null;
};

const VALUE_TOLERANCE = 1e-6;

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function statusKind(rawStatus: string, hasColumns: boolean): BrowserHighsVerification["reportedStatus"] {
  const status = rawStatus.toLowerCase();
  if (status === "optimal" || status === "empty") return "optimal";
  if (status === "infeasible") return "infeasible";
  if (
    status.includes("time limit") ||
    status.includes("iteration limit") ||
    status.includes("solution limit") ||
    status.includes("objective target")
  ) {
    return hasColumns ? "feasible" : "indeterminate";
  }
  if (status.includes("error")) return "error";
  return "indeterminate";
}

function tolerance(reference: number) {
  return Math.max(VALUE_TOLERANCE, Math.abs(reference) * 1e-7);
}

function valueFor(columns: BrowserHighsRawSolution["Columns"], variableId: string) {
  const value = columns?.[variableId]?.Primal ?? 0;
  return finite(value) ? value : Number.NaN;
}

function checkVariable(variable: MathVariable, value: number, issues: string[]) {
  if (!finite(value)) {
    issues.push(`NON_FINITE_PRIMAL ${variable.id}`);
    return;
  }
  if (value < variable.lowerBound - tolerance(variable.lowerBound)) {
    issues.push(`LOWER_BOUND ${variable.id}: ${value} < ${variable.lowerBound}`);
  }
  if (variable.upperBound !== undefined && value > variable.upperBound + tolerance(variable.upperBound)) {
    issues.push(`UPPER_BOUND ${variable.id}: ${value} > ${variable.upperBound}`);
  }
  if (variable.type === "integer" || variable.type === "binary") {
    if (Math.abs(value - Math.round(value)) > VALUE_TOLERANCE) {
      issues.push(`INTEGRALITY ${variable.id}: ${value}`);
    }
  }
  if (variable.type === "binary" && value > 1 + VALUE_TOLERANCE) {
    issues.push(`BINARY_RANGE ${variable.id}: ${value}`);
  }
}

function checkConstraint(
  row: MathConstraint,
  columns: BrowserHighsRawSolution["Columns"],
  issues: string[],
) {
  let lhs = 0;
  for (const term of row.terms) {
    const value = valueFor(columns, term.variableId);
    if (!finite(value)) {
      issues.push(`NON_FINITE_TERM ${row.id}:${term.variableId}`);
      return;
    }
    lhs += term.coefficient * value;
  }
  const tol = tolerance(row.rhs);
  if (row.sense === "eq" && Math.abs(lhs - row.rhs) > tol) {
    issues.push(`CONSTRAINT_EQ ${row.id}: lhs=${lhs} rhs=${row.rhs}`);
  } else if (row.sense === "le" && lhs > row.rhs + tol) {
    issues.push(`CONSTRAINT_LE ${row.id}: lhs=${lhs} rhs=${row.rhs}`);
  } else if (row.sense === "ge" && lhs < row.rhs - tol) {
    issues.push(`CONSTRAINT_GE ${row.id}: lhs=${lhs} rhs=${row.rhs}`);
  }
}

/**
 * Lightweight server-side verification for a HiGHS primal produced in the
 * operator's browser Web Worker. This deliberately does not solve the model.
 * It independently recompiles the governed model and proves the submitted
 * primal satisfies every variable bound, integrality rule and mathematical /
 * hard-capital constraint before persistence is allowed.
 *
 * A browser-reported infeasible status cannot be independently proven without
 * re-solving, so it is allowed through only as non-primal advisory evidence and
 * must be downgraded to indeterminate by the persistence boundary.
 */
export function verifyBrowserHighsRawSolution(
  source: AdvancedPlanningConstraintModel,
  request: BrowserHighsSolveRequest,
  raw: BrowserHighsRawSolution,
): BrowserHighsVerification {
  const issues: string[] = [];
  if (!raw || typeof raw !== "object") {
    return {
      valid: false,
      primalValidated: false,
      reportedStatus: "error",
      issues: ["RAW_RESULT_MISSING"],
      expectedVariableCount: 0,
      constraintCount: 0,
      reconstructedObjectiveValue: null,
    };
  }
  const rawStatus = String(raw.Status ?? "").trim().slice(0, 160);
  if (!rawStatus) issues.push("RAW_STATUS_MISSING");

  const compiled = compileAdvancedPlanningMathematicalModel(source);
  if (!compiled.valid || !compiled.model) {
    return {
      valid: false,
      primalValidated: false,
      reportedStatus: "error",
      issues: [
        ...issues,
        ...compiled.issues.map((issue) => `MODEL_${issue.code}: ${issue.message}`),
      ],
      expectedVariableCount: 0,
      constraintCount: 0,
      reconstructedObjectiveValue: null,
    };
  }

  const hardCapital = request.hardCapitalEnvelope
    ? compileGovernedHardCapitalConstraints(source, request.hardCapitalEnvelope)
    : { valid: true, variables: [], constraints: [], issues: [], semantics: [] };
  if (!hardCapital.valid) {
    return {
      valid: false,
      primalValidated: false,
      reportedStatus: "error",
      issues: [
        ...issues,
        ...hardCapital.issues.map((issue) => `HARD_CAPITAL_${issue.code}: ${issue.message}`),
      ],
      expectedVariableCount: 0,
      constraintCount: 0,
      reconstructedObjectiveValue: null,
    };
  }

  const variables = [...compiled.model.variables, ...hardCapital.variables];
  const constraints = [...compiled.model.constraints, ...hardCapital.constraints];
  const expectedIds = new Set(variables.map((row) => row.id));
  const columns = raw.Columns;
  const hasColumns = Boolean(columns && Object.keys(columns).length);
  const reportedStatus = statusKind(rawStatus, hasColumns);

  if (reportedStatus === "error") issues.push(`SOLVER_STATUS ${rawStatus}`);
  if (reportedStatus === "indeterminate") issues.push(`SOLVER_STATUS_INDETERMINATE ${rawStatus}`);

  if (reportedStatus === "infeasible") {
    return {
      valid: issues.length === 0,
      primalValidated: false,
      reportedStatus,
      issues,
      expectedVariableCount: variables.length,
      constraintCount: constraints.length,
      reconstructedObjectiveValue: null,
    };
  }

  if (reportedStatus !== "optimal" && reportedStatus !== "feasible") {
    return {
      valid: false,
      primalValidated: false,
      reportedStatus,
      issues,
      expectedVariableCount: variables.length,
      constraintCount: constraints.length,
      reconstructedObjectiveValue: null,
    };
  }

  if (!columns) {
    issues.push("PRIMAL_COLUMNS_MISSING");
  } else {
    for (const key of Object.keys(columns)) {
      if (!expectedIds.has(key)) issues.push(`UNKNOWN_PRIMAL_VARIABLE ${key}`);
    }
  }

  for (const variable of variables) {
    checkVariable(variable, valueFor(columns, variable.id), issues);
  }
  for (const row of constraints) {
    checkConstraint(row, columns, issues);
  }

  let objective = 0;
  for (const variable of compiled.model.variables) {
    const value = valueFor(columns, variable.id);
    if (!finite(value)) continue;
    objective += value * variable.objectiveCoefficient;
  }
  if (!finite(raw.ObjectiveValue)) {
    issues.push("OBJECTIVE_VALUE_MISSING");
  } else if (Math.abs(raw.ObjectiveValue - objective) > tolerance(objective)) {
    issues.push(`OBJECTIVE_MISMATCH solver=${raw.ObjectiveValue} reconstructed=${objective}`);
  }

  return {
    valid: issues.length === 0,
    primalValidated: issues.length === 0,
    reportedStatus,
    issues,
    expectedVariableCount: variables.length,
    constraintCount: constraints.length,
    reconstructedObjectiveValue: finite(objective) ? objective : null,
  };
}
