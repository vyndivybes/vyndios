/**
 * Candidate digital-employee roster for VYNDI OS.
 *
 * This is a planning/qualification contract, NOT an autonomous executor or
 * an authorization service. Business authority remains with the existing
 * role-protected operating workspaces and docs/VYNDI-BUSINESS-OPERATOR.md.
 */
export const VYNDI_DIGITAL_EMPLOYEES = [
  {
    id: "planning",
    name: "Planning & Forecast Analyst",
    department: "Planning",
    sources: ["src/lib/ibpe-copilot.ts", "src/lib/vibpe-planning.ts"],
    deliverable: "36-month demand, capacity, funding and scenario exception brief",
    mayPrepare: true,
  },
  {
    id: "commercial",
    name: "Commercial & CRM Analyst",
    department: "Commercial",
    sources: ["src/lib/crm-authority.ts", "src/lib/sales-order-authority.ts"],
    deliverable: "Opportunity, confirmed-order and fulfillment-risk brief",
    mayPrepare: true,
  },
  {
    id: "procurement",
    name: "Procurement Analyst",
    department: "Supply & Production",
    sources: ["src/lib/procurement-authority.ts", "src/lib/supplier-risk-model.ts"],
    deliverable: "Supplier risk, material gap and draft replenishment recommendation",
    mayPrepare: true,
  },
  {
    id: "inventory",
    name: "Inventory & Stores Analyst",
    department: "Supply & Production",
    sources: ["src/lib/master-inventory.ts", "src/lib/store01-dock-preflight.ts"],
    deliverable: "Stock health, FIFO, quarantine and GRN exception brief",
    mayPrepare: true,
  },
  {
    id: "production",
    name: "Production & MES Analyst",
    department: "Supply & Production",
    sources: ["src/lib/production-job-card.ts", "src/lib/manufacturing-quality-model.ts"],
    deliverable: "Job-card readiness, capacity and traveler blockers",
    mayPrepare: true,
  },
  {
    id: "engineering-quality",
    name: "Engineering & Quality Analyst",
    department: "Engineering",
    sources: ["src/lib/engineering-release-readiness.ts", "src/lib/quality-authority.ts"],
    deliverable: "Configuration, NCR/CAPA and release-evidence gap brief",
    mayPrepare: true,
  },
  {
    id: "finance",
    name: "Finance & CA Audit Analyst",
    department: "Finance",
    sources: ["src/lib/finance/financial-intelligence.ts", "src/lib/finance/tally-reconciliation.ts"],
    deliverable: "Liquidity, ledger-vs-plan and CA/Tally reconciliation exceptions",
    mayPrepare: true,
  },
  {
    id: "people",
    name: "People & Office Analyst",
    department: "People & Office",
    sources: ["src/lib/people-office-authority.ts", "src/lib/finance/people-office-ledger.ts"],
    deliverable: "Staffing, office spend and asset-control exceptions",
    mayPrepare: true,
  },
] as const;

export type VyndiDigitalEmployeeId = (typeof VYNDI_DIGITAL_EMPLOYEES)[number]["id"];
export type VyndiDigitalEmployeeMode = "observe" | "prepare" | "execute";
export type VyndiEvidence = {
  /** A lineage link supplied by the existing governed source, not an AI claim. */
  sourceId: string;
  sourceSha: string;
  capturedAt: string;
  authority: "governed-internal" | "scenario-assumption" | "external-reference" | "model-inference";
};
export type VyndiAgentRequest = {
  employeeId: string;
  mode: VyndiDigitalEmployeeMode;
  /** The upstream authenticated actor must be verified separately. */
  verifiedActorId: string | null;
  evidence: VyndiEvidence | null;
};
export type VyndiAgentDecision = {
  employeeId: string;
  status: "BLOCKED" | "HOLD" | "ADVISORY" | "PREPARED";
  executionEnabled: false;
  reason: string;
};

/**
 * Fail-closed eligibility check for analyst work packets.
 * Approval, RBAC and any actual database write MUST happen in the established
 * owning workflow. A PREPARED verdict is not an approval or a transaction.
 */
export function evaluateVyndiAgentRequest(
  request: VyndiAgentRequest,
  now: Date = new Date(),
): VyndiAgentDecision {
  const base = { employeeId: request.employeeId, executionEnabled: false as const };
  const employee = VYNDI_DIGITAL_EMPLOYEES.find((item) => item.id === request.employeeId);
  if (!employee) return { ...base, status: "BLOCKED", reason: "Unknown digital employee." };
  if (request.mode === "execute") {
    return { ...base, status: "BLOCKED", reason: "No autonomous transaction authority is commissioned." };
  }
  if (!request.verifiedActorId?.trim()) {
    return { ...base, status: "HOLD", reason: "Verified upstream business actor is required." };
  }
  const e = request.evidence;
  if (!e || !e.sourceId.trim() || !/^[a-f0-9]{40}$/i.test(e.sourceSha)) {
    return { ...base, status: "HOLD", reason: "Controlled source identity and 40-character SHA are required." };
  }
  if (e.authority !== "governed-internal") {
    return { ...base, status: "HOLD", reason: "Scenario, inference and external reference are not governed transaction evidence." };
  }
  const capturedAt = Date.parse(e.capturedAt);
  if (!Number.isFinite(capturedAt) || capturedAt > now.getTime() || now.getTime() - capturedAt > 24 * 60 * 60 * 1000) {
    return { ...base, status: "HOLD", reason: "Current source snapshot is required (24-hour advisory freshness policy)." };
  }
  if (request.mode === "prepare") {
    if (!employee.mayPrepare) return { ...base, status: "BLOCKED", reason: "This employee cannot prepare work packets." };
    return { ...base, status: "PREPARED", reason: "Advisory packet preparation only; owning workspace approval is mandatory." };
  }
  if (request.mode === "observe") {
    return { ...base, status: "ADVISORY", reason: "Governed evidence may be read for analysis; no mutation permitted." };
  }
  return { ...base, status: "BLOCKED", reason: "Unsupported work mode." };
}
