/**
 * Founder/Managing Director internal startup autonomy decision, 23 Nov 2026.
 * Scope classification only. No client-provided boolean proves auth, approval
 * or audit readiness. Real writes require the existing server-side actor,
 * authorization, provenance and audit controls of their specific executor.
 */
export const INTERNAL_STARTUP_MODE = Object.freeze({
  schemaVersion: "VYNDI_INTERNAL_STARTUP_MODE_V2",
  company: "Vāyú Shastr Pvt Ltd",
  mode: "INTERNAL_PREOPERATIONAL",
  multiTenantCommercialOffering: false,
  historicalData: "FOUNDER_DECLARED_SIMULATION_ONLY",
  autonomousScope: "INTERNAL_PLANNING_ANALYSIS_DRAFT_AND_AUDITED_INTERNAL_WRITES",
  autonomousInternalDraftWritesPolicyApproved: true,
  externalCommunicationRequiresFounderApproval: true,
  purchaseCommitmentRequiresFounderApproval: true,
  bypassesAuthentication: false,
  bypassesExistingWriteGates: false,
  productionWriteAuthorized: false,
});

const PREPARATORY_ACTIONS = new Set([
  "OBSERVE", "ANALYZE", "FORECAST", "SIMULATE",
  "PREPARE_INTERNAL_DRAFT", "PREPARE_INTERNAL_REPORT",
]);
const INTERNAL_WRITE_ACTIONS = new Set([
  "WRITE_INTERNAL_DRAFT", "UPDATE_INTERNAL_TASK",
  "SAVE_INTERNAL_PLAN", "SAVE_INTERNAL_REPORT",
  "RECORD_INTERNAL_ANALYSIS",
]);
const APPROVAL_BOUND_DRAFTS = new Set([
  "PREPARE_PURCHASE_DRAFT", "PREPARE_EXTERNAL_MESSAGE_DRAFT",
]);
const PHYSICAL_OR_EXTERNAL_ACTIONS = new Set([
  "PAY_SUPPLIER", "ISSUE_REAL_PO", "POST_STOCK",
  "RELEASE_PRODUCTION", "FILE_TAX", "CREATE_EXTERNAL_ACCOUNT",
  "SEND_EXTERNAL_COMMITMENT", "POST_LEDGER", "ISSUE_PAYROLL",
  "SEND_EXTERNAL_MESSAGE", "SEND_EMAIL", "SEND_RFQ",
  "AUTHORIZE_PURCHASE", "PLACE_ORDER", "TRANSFER_FUNDS",
  "POST_INVENTORY_MOVEMENT", "RELEASE_ENGINEERING_BASELINE",
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
    autonomousInternalWritePolicyApproved: false,
    requiresExistingRoleCheck: true,
    requiresAuthenticatedActor: true,
    requiresAuditTrail: true,
    draftPreparationAllowed: false,
    releaseRequiresFounderApproval: false,
  } as const;
  if (externalEffect === true || PHYSICAL_OR_EXTERNAL_ACTIONS.has(action ?? "")) {
    return Object.freeze({ ...common, status: "HUMAN_APPROVAL_REQUIRED" as const,
      releaseRequiresFounderApproval: true });
  }
  const isDraft = APPROVAL_BOUND_DRAFTS.has(action ?? "");
  const isWrite = INTERNAL_WRITE_ACTIONS.has(action ?? "");
  if (!PREPARATORY_ACTIONS.has(action ?? "") && !isWrite && !isDraft) {
    return Object.freeze({ ...common, status: "ACTION_NOT_IN_SCOPE" as const });
  }
  if (dataClass !== "SIMULATION_ONLY" && dataClass !== "INTERNAL_DRAFT") {
    return Object.freeze({ ...common, status: dataClass === "ACTUAL_BUSINESS"
      ? "SOURCE_AUTHORITY_REQUIRED" as const
      : "CLASSIFICATION_REQUIRED" as const });
  }
  if (isDraft) return Object.freeze({ ...common,
    status: "DRAFT_ONLY_AWAITING_FOUNDER" as const,
    autonomousInternalWritePolicyApproved: true,
    draftPreparationAllowed: true,
    releaseRequiresFounderApproval: true,
  });
  if (isWrite) return Object.freeze({ ...common,
    status: "INTERNAL_WRITE_POLICY_APPROVED" as const,
    autonomousInternalWritePolicyApproved: true,
  });
  return Object.freeze({ ...common, status: "INTERNAL_SUPPORT_ELIGIBLE" as const });
}
