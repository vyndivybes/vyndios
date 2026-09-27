export type EngineeringWorkflowState =
  | "draft"
  | "pending_approval"
  | "approved"
  | "released"
  | "superseded"
  | "rejected"
  | "blocked";

export type EngineeringActorAuthority =
  | "engineering_authority"
  | "qa_authority"
  | "configuration_authority"
  | "vibpe";

export type EngineeringBlockerClass =
  | "release_critical"
  | "safety"
  | "regulatory"
  | "administrative"
  | "documentation"
  | "commercial";

export type GovernedEngineeringWorkflow = {
  id: string;
  subjectId: string;
  state: EngineeringWorkflowState;
  createdBy: string;
  criticality: "ordinary" | "release";
  blockers: string[];
  supersedesId: string | null;
  successorId: string | null;
};

export type EngineeringWorkflowTransitionRequest = {
  actorUserId: string;
  actorAuthority: EngineeringActorAuthority;
  toState: EngineeringWorkflowState;
  reason: string;
};

export type EngineeringWorkflowDecisionCode =
  | "ALLOWED"
  | "INVALID_TRANSITION"
  | "HUMAN_APPROVAL_REQUIRED"
  | "SOD_MAKER_CHECKER"
  | "CONFIGURATION_AUTHORITY_REQUIRED"
  | "OPEN_BLOCKERS"
  | "SUCCESSOR_REQUIRED"
  | "REASON_REQUIRED";

export type EngineeringWorkflowDecision = {
  allowed: boolean;
  code: EngineeringWorkflowDecisionCode;
  fromState: EngineeringWorkflowState;
  toState: EngineeringWorkflowState;
  reason: string;
};

export type EngineeringWaiverRequest = {
  blockerId: string;
  blockerClass: EngineeringBlockerClass;
  requestedBy: string;
  approvedBy: string;
  reason: string;
  evidenceRef: string;
  expiresAt: string;
};

export type EngineeringWaiverDecision = {
  allowed: boolean;
  code:
    | "ALLOWED"
    | "BLOCKER_NOT_PRESENT"
    | "NON_WAIVABLE_BLOCKER"
    | "SOD_MAKER_CHECKER"
    | "WAIVER_REASON_REQUIRED"
    | "WAIVER_EVIDENCE_REQUIRED"
    | "WAIVER_EXPIRY_REQUIRED";
  remainingBlockers: string[];
};

const TRANSITIONS: Record<EngineeringWorkflowState, readonly EngineeringWorkflowState[]> = {
  draft: ["pending_approval", "blocked"],
  pending_approval: ["draft", "approved", "rejected", "blocked"],
  approved: ["released", "draft", "blocked"],
  released: ["superseded"],
  superseded: [],
  rejected: ["draft"],
  blocked: ["draft", "pending_approval"],
};

function clean(value: string) {
  return value.trim();
}

function validDate(value: string) {
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed);
}

export function evaluateEngineeringWorkflowTransition(
  workflow: GovernedEngineeringWorkflow,
  request: EngineeringWorkflowTransitionRequest,
): EngineeringWorkflowDecision {
  const fromState = workflow.state;
  const toState = request.toState;
  const base = { fromState, toState, reason: request.reason };

  if (!clean(request.reason)) return { ...base, allowed: false, code: "REASON_REQUIRED" };

  if (request.actorAuthority === "vibpe") {
    return { ...base, allowed: false, code: "HUMAN_APPROVAL_REQUIRED" };
  }

  if (!TRANSITIONS[fromState].includes(toState)) {
    return { ...base, allowed: false, code: "INVALID_TRANSITION" };
  }

  if (toState === "approved" && request.actorUserId === workflow.createdBy) {
    return { ...base, allowed: false, code: "SOD_MAKER_CHECKER" };
  }

  if (toState === "released") {
    if (workflow.blockers.length > 0) {
      return { ...base, allowed: false, code: "OPEN_BLOCKERS" };
    }
    if (request.actorAuthority !== "configuration_authority") {
      return { ...base, allowed: false, code: "CONFIGURATION_AUTHORITY_REQUIRED" };
    }
    if (request.actorUserId === workflow.createdBy) {
      return { ...base, allowed: false, code: "SOD_MAKER_CHECKER" };
    }
  }

  if (toState === "superseded") {
    if (request.actorAuthority !== "configuration_authority") {
      return { ...base, allowed: false, code: "CONFIGURATION_AUTHORITY_REQUIRED" };
    }
    if (!workflow.successorId?.trim()) {
      return { ...base, allowed: false, code: "SUCCESSOR_REQUIRED" };
    }
  }

  return { ...base, allowed: true, code: "ALLOWED" };
}

export function applyEngineeringWaiver(
  workflow: GovernedEngineeringWorkflow,
  request: EngineeringWaiverRequest,
): EngineeringWaiverDecision {
  const remaining = [...workflow.blockers];

  if (!remaining.includes(request.blockerId)) {
    return { allowed: false, code: "BLOCKER_NOT_PRESENT", remainingBlockers: remaining };
  }

  if (request.blockerClass === "release_critical" || request.blockerClass === "safety" || request.blockerClass === "regulatory") {
    return { allowed: false, code: "NON_WAIVABLE_BLOCKER", remainingBlockers: remaining };
  }

  if (request.requestedBy === request.approvedBy) {
    return { allowed: false, code: "SOD_MAKER_CHECKER", remainingBlockers: remaining };
  }

  if (!clean(request.reason)) {
    return { allowed: false, code: "WAIVER_REASON_REQUIRED", remainingBlockers: remaining };
  }
  if (!clean(request.evidenceRef)) {
    return { allowed: false, code: "WAIVER_EVIDENCE_REQUIRED", remainingBlockers: remaining };
  }
  if (!clean(request.expiresAt) || !validDate(request.expiresAt)) {
    return { allowed: false, code: "WAIVER_EXPIRY_REQUIRED", remainingBlockers: remaining };
  }

  return {
    allowed: true,
    code: "ALLOWED",
    remainingBlockers: remaining.filter((id) => id !== request.blockerId),
  };
}
