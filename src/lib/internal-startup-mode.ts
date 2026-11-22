/**
 * Founder-declared internal startup assistance scope, 23 Nov 2026.
 *
 * This is a scope classifier for the pre-operational workspace, NOT an
 * authentication, RBAC, database authorization or execution decision.
 * Every real write still passes the existing server-side actor and source
 * controls. No declaration upgrades historical simulation to actuals.
 */
export const INTERNAL_STARTUP_MODE = Object.freeze({
  schemaVersion: "VYNDI_INTERNAL_STARTUP_MODE_V1",
  company: "Vāyú Shastr Pvt Ltd",
  mode: "INTERNAL_PREOPERATIONAL",
  multiTenantCommercialOffering: false,
  historicalData: "FOUNDER_DECLARED_SIMULATION_ONLY",
  autonomousScope: "INTERNAL_PLANNING_ANALYSIS_AND_PREPARATION",
  bypassesAuthentication: false,
  bypassesExistingWriteGates: false,
  productionWriteAuthorized: false,
});

const PREPARATORY_ACTIONS = new Set([
  "OBSERVE", "ANALYZE", "FORECAST", "SIMULATE",
  "PREPARE_INTERNAL_DRAFT", "PREPARE_INTERNAL_REPORT",
]);
const PHYSICAL_OR_EXTERNAL_ACTIONS = new Set([
  "PAY_SUPPLIER", "ISSUE_REAL_PO", "POST_STOCK",
  "RELEASE_PRODUCTION", "FILE_TAX", "CREATE_EXTERNAL_ACCOUNT",
  "SEND_EXTERNAL_COMMITMENT", "POST_LEDGER", "ISSUE_PAYROLL",
]);

export function assessStartupAction({
  action, dataClass, externalEffect = false,
}: {
  action?: string;
  dataClass?: string;
  externalEffect?: boolean;
} = {}) {
  const common = {
    executionPermissionGranted: false,
    externalEffectAuthorized: false,
    productionWriteAuthorized: false,
    requiresExistingRoleCheck: true,
  } as const;
  if (externalEffect === true || PHYSICAL_OR_EXTERNAL_ACTIONS.has(action ?? "")) {
    return Object.freeze({ ...common, status: "HUMAN_APPROVAL_REQUIRED" as const });
  }
  if (!PREPARATORY_ACTIONS.has(action ?? "")) {
    return Object.freeze({ ...common, status: "ACTION_NOT_IN_SCOPE" as const });
  }
  if (dataClass !== "SIMULATION_ONLY" && dataClass !== "INTERNAL_DRAFT") {
    return Object.freeze({ ...common, status: dataClass === "ACTUAL_BUSINESS"
      ? "SOURCE_AUTHORITY_REQUIRED" as const
      : "CLASSIFICATION_REQUIRED" as const });
  }
  return Object.freeze({ ...common, status: "INTERNAL_SUPPORT_ELIGIBLE" as const });
}
