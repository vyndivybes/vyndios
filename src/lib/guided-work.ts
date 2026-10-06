import { canAccessRoute, type CommandRole } from "@/lib/page-access";

export type GuidedWorkMode = "learn" | "work";

export type GuidedWorkStep = {
  label: string;
  to: string;
  reason: string;
  question: string;
};

export type GuidedWorkPlaybook = {
  id: string;
  department:
    | "Management"
    | "Commercial"
    | "Planning"
    | "Engineering"
    | "Procurement"
    | "Inventory"
    | "Production"
    | "Quality"
    | "Finance"
    | "Administration"
    | "Governance";
  routes: readonly string[];
  purpose: string;
  why: string;
  procedure: readonly string[];
  nextSteps: readonly GuidedWorkStep[];
  advisoryOnly: true;
};

export type ResolvedGuidedWork = GuidedWorkPlaybook & {
  accessibleSteps: readonly GuidedWorkStep[];
};

export const GUIDED_WORK_AUTHORITY_NOTICE =
  "Guidance never grants approval or transaction authority. RBAC, maker/checker controls, evidence requirements and explicit human approval remain authoritative.";

const PLAYBOOKS: readonly GuidedWorkPlaybook[] = [
  {
    id: "management",
    department: "Management",
    routes: ["/command", "/command/decision-inbox", "/command/control-tower", "/command/ibpe-operating-workspace"],
    purpose: "Turn current governed business state into an ordered management review and action sequence.",
    why: "Management should work from current exceptions and evidence rather than page-by-page inspection or memory.",
    procedure: [
      "Review Command Centre condition and unresolved exception counts.",
      "Open Action Inbox and identify decisions that require an authorised owner.",
      "Use Control Tower to verify operational blockers and cross-functional impact.",
      "Use VIBPE for advisory synthesis, then execute decisions only in the owning transaction workspace.",
    ],
    nextSteps: [
      { label: "Review Action Inbox", to: "/command/decision-inbox", reason: "Start with governed actions that already require attention.", question: "Summarise the highest-priority Action Inbox items for my role and explain the governing evidence." },
      { label: "Review Control Tower", to: "/command/control-tower", reason: "Check the current cross-functional operating blockers.", question: "What are the current Control Tower blockers and which governed workspace owns each next action?" },
      { label: "Open VIBPE Workspace", to: "/command/ibpe-operating-workspace", reason: "Use governed planning intelligence only after the current exception state is understood.", question: "Guide me through the current VIBPE operating review without granting or implying transaction authority." },
    ],
    advisoryOnly: true,
  },
  {
    id: "commercial",
    department: "Commercial",
    routes: ["/command/sales", "/command/gtm", "/command/market-survey"],
    purpose: "Move demand from market evidence to a controlled commercial commitment.",
    why: "Commercial demand becomes authoritative only through governed order state and downstream synchronization.",
    procedure: [
      "Review market/GTM evidence before creating or revising demand.",
      "Create or revise demand in Demand & Orders with the correct lifecycle status.",
      "Confirm that committed demand is synchronized to planning and production state.",
      "Escalate mismatches instead of manually forcing downstream records.",
    ],
    nextSteps: [
      { label: "Open Demand & Orders", to: "/command/sales", reason: "Demand & Orders is the controlled commercial transaction surface.", question: "What should I verify before creating or revising a commercial demand/order in VYNDI?" },
      { label: "Review Integrated Plan", to: "/command/planning", reason: "Confirm the demand is represented in the governed operating horizon.", question: "Check how current commercial demand should reconcile to the Integrated Operating Plan." },
      { label: "Review Scenarios", to: "/command/scenarios", reason: "Use scenarios for alternatives without changing approved baseline authority.", question: "Explain which planning scenario is relevant to this demand and what remains advisory versus approved." },
    ],
    advisoryOnly: true,
  },
  {
    id: "planning",
    department: "Planning",
    routes: ["/command/planning", "/command/scenarios"],
    purpose: "Maintain one approved operating horizon linking demand, engineering, material and cash feasibility.",
    why: "Planning coordinates consequences across departments; it must not bypass released engineering, procurement or finance authority.",
    procedure: [
      "Review the current Integrated Operating Plan revision and approval state.",
      "Reconcile confirmed demand and released product/BOM state.",
      "Review material, capacity and funding exceptions.",
      "Use scenarios to compare alternatives, then submit only governed plan changes for approval.",
    ],
    nextSteps: [
      { label: "Open Integrated Plan", to: "/command/planning", reason: "Confirm the current approved baseline before evaluating alternatives.", question: "Guide me through the current Integrated Operating Plan review and identify blocked planning inputs." },
      { label: "Open Scenarios", to: "/command/scenarios", reason: "Compare alternatives without silently changing the approved baseline.", question: "What scenario should I run for the current planning constraint, and what evidence must be reviewed before adoption?" },
      { label: "Review Material Requirements", to: "/command/procurement-planning", reason: "Validate whether the approved plan is materially feasible.", question: "Explain the current material-requirement blockers against the approved plan." },
    ],
    advisoryOnly: true,
  },
  {
    id: "engineering",
    department: "Engineering",
    routes: ["/command/product", "/command/engineering", "/command/bom-control", "/command/bom"],
    purpose: "Control product identity, engineering authority and BOM release before downstream execution.",
    why: "Procurement and production must consume released engineering truth rather than informal compatibility assumptions.",
    procedure: [
      "Confirm the current product/configuration authority and open engineering changes.",
      "Review BOM revision, component mappings and approved inventory masters.",
      "Release engineering/BOM changes only with required evidence and authority.",
      "Review downstream procurement and existing Job Card impact after a material release change.",
    ],
    nextSteps: [
      { label: "Open Engineering", to: "/command/engineering", reason: "Confirm the current engineering release state and evidence.", question: "What is the current engineering authority and what remains open before release?" },
      { label: "Open BOM Control", to: "/command/bom-control", reason: "BOM Control is the governed material-definition surface.", question: "Guide me through the BOM release checks for the current product configuration." },
      { label: "Review BOM Cost", to: "/command/bom", reason: "Check downstream cost and missing-cost consequences after configuration review.", question: "Explain the current BOM cost exceptions without changing engineering authority." },
    ],
    advisoryOnly: true,
  },
  {
    id: "procurement",
    department: "Procurement",
    routes: ["/command/procurement-planning", "/command/purchase-execution", "/command/procurement", "/command/receiving"],
    purpose: "Convert governed shortages and authorised needs into controlled supplier commitments and receipts.",
    why: "Supplier commitment must follow approved requirement, supplier, price/evidence and approval state.",
    procedure: [
      "Review material requirements and shortage lineage against the approved plan.",
      "Select an approved supplier and verify commercial evidence.",
      "Submit the controlled PO for approval before issuance.",
      "Receive against the issued PO and preserve inspection/GRN evidence.",
    ],
    nextSteps: [
      { label: "Review Requirements", to: "/command/procurement-planning", reason: "Start from governed material need rather than ad-hoc purchasing.", question: "Which procurement requirements are currently actionable, blocked or awaiting evidence?" },
      { label: "Open Purchase Execution", to: "/command/purchase-execution", reason: "Create or progress controlled supplier commitments.", question: "Guide me through the next governed PO action and the evidence required before approval or issue." },
      { label: "Open Receiving", to: "/command/receiving", reason: "Close the supplier commitment through controlled receipt and inspection.", question: "What must be verified before posting the next controlled GRN?" },
    ],
    advisoryOnly: true,
  },
  {
    id: "inventory",
    department: "Inventory",
    routes: ["/command/inventory", "/command/inventory-truth", "/command/inventory-ledgers", "/command/inventory-master", "/command/inventory-openings", "/command/inventory-control-audit", "/command/component-control"],
    purpose: "Maintain auditable quantity, availability, FIFO and material-master truth.",
    why: "Production and procurement decisions depend on inventory truth; manual corrections must not conceal receiving or issue errors.",
    procedure: [
      "Review current stock, reservations, shortages and health.",
      "Trace stock movement to PO/GRN, adjustment or production issue evidence.",
      "Resolve master-data or opening-balance exceptions through the controlled inventory surfaces.",
      "Never alter quantity solely to make a downstream workflow appear ready.",
    ],
    nextSteps: [
      { label: "Open Inventory", to: "/command/inventory", reason: "Review available, reserved and shortage state from the canonical inventory surface.", question: "Explain the current inventory exceptions and the evidence path for each one." },
      { label: "Review Material Requirements", to: "/command/procurement-planning", reason: "Translate verified shortages into governed procurement demand.", question: "Which inventory shortages are represented in governed material requirements and which are not?" },
      { label: "Open Receiving", to: "/command/receiving", reason: "Trace inbound stock through controlled receipt and inspection.", question: "Show me how to verify the receiving lineage for the inventory shortage I am reviewing." },
    ],
    advisoryOnly: true,
  },
  {
    id: "production",
    department: "Production",
    routes: ["/command/production", "/command/manufacturing", "/command/actuals"],
    purpose: "Execute released demand and engineering state through controlled Job Card, Traveller and material issue.",
    why: "Build execution must preserve frozen configuration, serialized genealogy and material evidence.",
    procedure: [
      "Verify the Job Card is synchronized to confirmed demand and a released BOM/configuration.",
      "Review material readiness and controlled issue/reservation state.",
      "Execute authorised production steps against the correct Traveller/serial.",
      "Route non-conformance to Quality rather than bypassing release controls.",
    ],
    nextSteps: [
      { label: "Open Production / Build", to: "/command/production", reason: "Use the canonical Job Card and Traveller execution surface.", question: "Guide me through the next production action for the current Job Card without bypassing material or Quality controls." },
      { label: "Review Inventory", to: "/command/inventory", reason: "Verify material availability and reservations before build execution.", question: "What inventory evidence should be checked before this production step?" },
      { label: "Open Quality", to: "/command/quality", reason: "Quality owns inspection, NCR/CAPA and serialized release decisions.", question: "What Quality evidence is required before this build can progress to release?" },
    ],
    advisoryOnly: true,
  },
  {
    id: "quality",
    department: "Quality",
    routes: ["/command/quality", "/command/qa-verification"],
    purpose: "Control inspection, NCR/CAPA and serialized release evidence.",
    why: "Production completion does not equal Quality Release; unresolved NCR/CAPA and EPR holds must remain visible.",
    procedure: [
      "Review incoming, in-process and final inspection lineage.",
      "Open and disposition NCR/CAPA through authorised evidence.",
      "Verify EPR and other release holds before serialized release.",
      "Post Quality Release only when the governed release conditions are satisfied.",
    ],
    nextSteps: [
      { label: "Open Quality", to: "/command/quality", reason: "Review the canonical inspection, NCR/CAPA and release registers.", question: "Summarise the current Quality release blockers and the evidence needed to close each one." },
      { label: "Open QA Verification", to: "/command/qa-verification", reason: "Use Governance QA verification for independent assurance evidence where applicable.", question: "Which QA verification evidence is relevant to the current release decision?" },
      { label: "Review EPR Workflow", to: "/command/epr-workflow", reason: "Confirm unresolved EPR controls are not being bypassed.", question: "Are there EPR holds that affect the current Quality release decision?" },
    ],
    advisoryOnly: true,
  },
  {
    id: "finance",
    department: "Finance",
    routes: ["/command/financial-cockpit", "/command/cash", "/command/payables", "/command/receivables", "/command/sales-ledger", "/command/accounting", "/command/accounting-statements", "/command/finance-control", "/command/aluminium-finance"],
    purpose: "Reconcile governed transaction evidence to cash, ledgers, statements and planning control.",
    why: "Finance should reflect operational truth and approved accounting treatment rather than repair upstream process gaps with manual postings.",
    procedure: [
      "Review the consolidated Finance condition and unreconciled exceptions.",
      "Trace payables/receivables to the originating governed transaction.",
      "Post or approve accounting treatment only with required evidence and role authority.",
      "Review statements and budget/forecast/actual variance after transaction reconciliation.",
    ],
    nextSteps: [
      { label: "Open Finance Overview", to: "/command/financial-cockpit", reason: "Start from consolidated financial condition and exceptions.", question: "Summarise the current finance exceptions and their originating transaction lineage." },
      { label: "Open Accounting Workbench", to: "/command/accounting", reason: "Use controlled accounting treatment rather than ad-hoc correction.", question: "Guide me through the evidence required for the next accounting action." },
      { label: "Review Statements", to: "/command/accounting-statements", reason: "Validate the reporting consequence after transaction reconciliation.", question: "Explain which current transaction exceptions materially affect the financial statements." },
    ],
    advisoryOnly: true,
  },
  {
    id: "administration",
    department: "Administration",
    routes: ["/command/people-office", "/command/users", "/command/master-data", "/command/classification", "/command/recovery"],
    purpose: "Maintain people/office records, access, master data and resilience through controlled administrative surfaces.",
    why: "Administrative convenience must not weaken identity, RBAC, master-data or recovery controls.",
    procedure: [
      "Use People & Office for operating administration and cost/evidence records.",
      "Use Users & Roles only for authorised identity and access changes.",
      "Maintain master data/classification through controlled system-data surfaces.",
      "Use Backup & Recovery for governed resilience actions and evidence.",
    ],
    nextSteps: [
      { label: "Open People & Office", to: "/command/people-office", reason: "Use the operating administration register for people/office records.", question: "Guide me through the controlled People & Office action relevant to this record." },
      { label: "Open Users & Roles", to: "/command/users", reason: "Identity and role changes belong to the authorised access-control surface.", question: "What RBAC checks are required before changing this user or role?" },
      { label: "Open Backup & Recovery", to: "/command/recovery", reason: "Use governed recovery controls rather than manual data manipulation.", question: "Explain the safe recovery procedure and evidence required for the current issue." },
    ],
    advisoryOnly: true,
  },
  {
    id: "governance",
    department: "Governance",
    routes: ["/command/governance", "/command/risk", "/command/legal", "/command/epr-workflow", "/command/epr-execution", "/command/epr-live", "/command/legal-control", "/command/actions", "/command/ca-audit"],
    purpose: "Control approvals, risk, legal/EPR obligations and audit evidence without substituting advisory guidance for authority.",
    why: "Governance exists to make authority, exceptions and evidence explicit and independently reviewable.",
    procedure: [
      "Identify the governing obligation, approval or exception.",
      "Verify source evidence and the authorised owner.",
      "Record the governed decision/action with reason and evidence.",
      "Confirm closure through audit/assurance rather than narrative assertion.",
    ],
    nextSteps: [
      { label: "Open Approvals", to: "/command/governance", reason: "Start with the current governed approval state.", question: "Which governance approvals are open for my role and what evidence controls each decision?" },
      { label: "Review Risk", to: "/command/risk", reason: "Confirm material risk and mitigation ownership before closure.", question: "Summarise the current material risks and their evidence-backed mitigation status." },
      { label: "Open Audit & Actions", to: "/command/actions", reason: "Verify that decisions and corrective actions have closure evidence.", question: "Which audit or corrective actions remain open and what evidence is required for closure?" },
    ],
    advisoryOnly: true,
  },
] as const;

function routeMatches(pathname: string, route: string) {
  if (route === "/command") return pathname === route;
  return pathname === route || pathname.startsWith(`${route}/`);
}

function playbookForPath(pathname: string) {
  const candidates = PLAYBOOKS.flatMap((playbook) =>
    playbook.routes
      .filter((route) => routeMatches(pathname, route))
      .map((route) => ({ playbook, specificity: route.length })),
  ).sort((left, right) => right.specificity - left.specificity);

  return candidates[0]?.playbook ?? PLAYBOOKS[0];
}

export function resolveGuidedWork(
  role: CommandRole | null,
  pathname: string,
): ResolvedGuidedWork {
  const playbook = playbookForPath(pathname);
  const accessibleSteps = playbook.nextSteps.filter((step) => canAccessRoute(role, step.to));

  return {
    ...playbook,
    accessibleSteps,
  };
}

export const GUIDED_WORK_PLAYBOOKS = PLAYBOOKS;
