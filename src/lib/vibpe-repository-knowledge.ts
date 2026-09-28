export type VibpeRepositoryKnowledgeAuthority =
  | "controlled-reference"
  | "advisory"
  | "unresolved";

export type VibpeRepositoryKnowledgeRecord = {
  id: string;
  claimText: string;
  claimClass: "verified_fact" | "decision" | "material_change" | "blocker" | "priority" | "assumption";
  authority: VibpeRepositoryKnowledgeAuthority;
  domain: "engineering" | "manufacturing" | "operations" | "finance" | "governance" | "optimization" | "venture";
  title: string;
  sourceRevision: string;
  repository: string;
  sourceCommit: string;
  sourcePath: string;
  sourceDate: string;
  knowledgeTier: "controlled-repository" | "current-operational" | "development-reference" | "legacy-working";
  keywords: string[];
};

const VEDM_REPO = "vayu-shastr/veloxis-engineering-design-manual";
const VEDM_COMMIT = "9ef41eb8afbc75429013bfd73133957ddccf3834";

const ADV_REPO = "vayu-shastr/adv-vibpe";
const ADV_COMMIT = "3ca30a7891272870190b3f21340102451d7ff94b";

const VYNDI_REPO = "vayu-shastr/vyndios";
// Self-repository records use the last independently audited main SHA as a
// stable evidence anchor. They deliberately do not try to equal the commit
// containing this file, which would be self-referential and impossible.
const VYNDI_COMMIT = "89de43701c16776a834b4ba67e38620d670160f7";

/**
 * Curated, commit-pinned cross-repository knowledge used by VIBPE Co-Pilot.
 *
 * These records are snapshots, not live GitHub reads. A source may itself be a
 * controlled engineering authority, but importing that statement into VYNDI OS
 * does not mutate ERP master data, approve a design or create a transaction.
 *
 * Refresh this register whenever a material source repository changes.
 */
export const VIBPE_REPOSITORY_KNOWLEDGE: VibpeRepositoryKnowledgeRecord[] = [
  {
    id: "repo-vedm-current-geometry",
    claimText:
      "Current VEDM configuration declares VEDM-301 Rev 5.3.9 Candidate E-K75 as the CONTROLLING FRAME-GEOMETRY AUTHORITY. Rev 5.4 FK75 inherits that frame/rider geometry unchanged and is the preferred VAEA fork/front-end development freeze, but it is NOT RELEASED.",
    claimClass: "decision",
    authority: "controlled-reference",
    domain: "engineering",
    title: "VEDM Current Configuration Status",
    sourceRevision: "Rev 0.8 configuration view",
    repository: VEDM_REPO,
    sourceCommit: VEDM_COMMIT,
    sourcePath: "CURRENT_CONFIGURATION_STATUS.md",
    sourceDate: "2026-09-20",
    knowledgeTier: "controlled-repository",
    keywords: ["geometry", "e-k75", "ek75", "rev 5.3.9", "fk75", "fork", "authority", "stack", "reach", "wheelbase", "clearance"],
  },
  {
    id: "repo-vedm-fk75-analysis",
    claimText:
      "The current FK75 development record reports M dense steering-sweep minimum 7.170 mm; nominal fork/tyre packaging XS/S/M/L/XL 8.61 / 8.60 / 8.37 / 8.18 / 7.33 mm; governing Tsai-Wu FI 0.623; positive-root strength ratio 1.43; and Hashin index 0.353. These are development analytical closure results, not production release.",
    claimClass: "verified_fact",
    authority: "controlled-reference",
    domain: "engineering",
    title: "VEDM Current Configuration Status",
    sourceRevision: "Rev 0.8 configuration view",
    repository: VEDM_REPO,
    sourceCommit: VEDM_COMMIT,
    sourcePath: "CURRENT_CONFIGURATION_STATUS.md",
    sourceDate: "2026-09-20",
    knowledgeTier: "controlled-repository",
    keywords: ["fk75", "tsai-wu", "hashin", "steering sweep", "fork tyre", "packaging", "strength ratio", "clearance"],
  },
  {
    id: "repo-vedm-laminate-authority",
    claimText:
      "VEL-PLY-2026 Rev 5.4.1 is the current approved-reference / Toray-facing frame-laminate source. Rev 5.4.2 remains development/reconciliation and is not approved.",
    claimClass: "decision",
    authority: "controlled-reference",
    domain: "engineering",
    title: "VEDM Current Configuration Status",
    sourceRevision: "Rev 0.8 configuration view",
    repository: VEDM_REPO,
    sourceCommit: VEDM_COMMIT,
    sourcePath: "CURRENT_CONFIGURATION_STATUS.md",
    sourceDate: "2026-09-20",
    knowledgeTier: "controlled-repository",
    keywords: ["ply", "laminate", "toray", "rev 5.4.1", "rev 5.4.2", "frame laminate", "prepreg", "material"],
  },
  {
    id: "repo-vedm-open-release-gates",
    claimText:
      "Decisive engineering gates still open are native mesh-converged composite FEA, MATERIAL-01 qualified interlaminar/process allowables, XL tolerance/deformed-clearance closure, real-prepreg drape/tooling review, prototype/NDT/physical validation and formal release approval.",
    claimClass: "blocker",
    authority: "controlled-reference",
    domain: "engineering",
    title: "VEDM Current Configuration Status",
    sourceRevision: "Rev 0.8 configuration view",
    repository: VEDM_REPO,
    sourceCommit: VEDM_COMMIT,
    sourcePath: "CURRENT_CONFIGURATION_STATUS.md",
    sourceDate: "2026-09-20",
    knowledgeTier: "controlled-repository",
    keywords: ["release", "fea", "mesh convergence", "material-01", "allowables", "xl", "drape", "tooling", "prototype", "ndt", "physical validation"],
  },
  {
    id: "repo-vedm-engineering-router",
    claimText:
      "The VEDM VIBPE engineering router requires authority resolution before evaluation and routes geometry/fit, composites, FEA, CFD, manufacturing, quality, standards and configuration questions through KP-01 to KP-16 plus governed calculator/analysis registries. Solver output is not approval, and predictive output remains advisory until VVUQ and human approval.",
    claimClass: "decision",
    authority: "controlled-reference",
    domain: "engineering",
    title: "VIBPE Engineering Configuration",
    sourceRevision: "schema 0.7",
    repository: VEDM_REPO,
    sourceCommit: VEDM_COMMIT,
    sourcePath: "VIBPE_Copilot/vibpe.config.json",
    sourceDate: "2026-09-20",
    knowledgeTier: "controlled-repository",
    keywords: ["kp-01", "kp-16", "fea", "cfd", "composites", "geometry", "manufacturing", "quality", "standards", "vvuq", "solver", "analysis"],
  },
  {
    id: "repo-vedm-calculator-material-basis",
    claimText:
      "CAL-CMP-001 Rev 1.1 Candidate has verified core CLT mathematics but remains not released; current use is gated by controlled material cards. DATA-CMP-001 Rev 0.3 is the primary Toray basis, while unresolved 2500/3900 placeholders must not be completed using generic T700/T800 assumptions.",
    claimClass: "verified_fact",
    authority: "controlled-reference",
    domain: "engineering",
    title: "VIBPE Engineering Calculator Router",
    sourceRevision: "current router",
    repository: VEDM_REPO,
    sourceCommit: VEDM_COMMIT,
    sourcePath: "VIBPE_Copilot/CALCULATOR_REGISTER.md",
    sourceDate: "2026-09-20",
    knowledgeTier: "controlled-repository",
    keywords: ["clt", "abd", "calculator", "cal-cmp-001", "data-cmp-001", "toray", "2500", "3900", "t700", "t800", "material card"],
  },
  {
    id: "repo-adv-finance-closure",
    claimText:
      "ADV VIBPE finance closure preserves one accounting truth chain: operational event → governed accounting event → posted double-entry journal → General Ledger → Trial Balance → financial statements. Plans, forecasts, scenarios and VIBPE recommendations never become accounting actuals by themselves.",
    claimClass: "decision",
    authority: "advisory",
    domain: "finance",
    title: "VYNDI Finance Closure Layer",
    sourceRevision: "ADV main snapshot",
    repository: ADV_REPO,
    sourceCommit: ADV_COMMIT,
    sourcePath: "docs/FINANCE-CLOSURE-LAYER.md",
    sourceDate: "2026-09-20",
    knowledgeTier: "development-reference",
    keywords: ["finance", "accounting", "general ledger", "trial balance", "profit and loss", "balance sheet", "cash flow", "fund flow", "cost accounting", "actuals"],
  },
  {
    id: "repo-adv-statutory-finance",
    claimText:
      "ADV statutory-finance control separates GST-bearing customer and supplier flows, bank reconciliation, period close and CA evidence packs. It explicitly does not claim automated statutory filing or professional tax/legal certification.",
    claimClass: "verified_fact",
    authority: "advisory",
    domain: "finance",
    title: "VYNDI Statutory Finance Controls",
    sourceRevision: "ADV main snapshot",
    repository: ADV_REPO,
    sourceCommit: ADV_COMMIT,
    sourcePath: "docs/STATUTORY-FINANCE-CONTROLS.md",
    sourceDate: "2026-09-20",
    knowledgeTier: "development-reference",
    keywords: ["gst", "itc", "bank reconciliation", "period close", "ca evidence", "statutory", "supplier invoice", "customer invoice"],
  },
  {
    id: "repo-adv-copilot-architecture",
    claimText:
      "ADV VIBPE Co-Pilot architecture separates four truth classes: governed internal truth, scenario assumption, external reference and model inference. External references and model inference must never overwrite approved BOM, inventory, cost, demand, supplier, finance or production authority.",
    claimClass: "decision",
    authority: "advisory",
    domain: "governance",
    title: "VIBPE Co-Pilot 2.0 Architecture",
    sourceRevision: "ADV main snapshot",
    repository: ADV_REPO,
    sourceCommit: ADV_COMMIT,
    sourcePath: "docs/VIBPE-COPILOT-2-ARCHITECTURE.md",
    sourceDate: "2026-09-20",
    knowledgeTier: "development-reference",
    keywords: ["truth class", "governed truth", "scenario", "external reference", "model inference", "copilot", "authority", "doctrine"],
  },
  {
    id: "repo-adv-v1-freeze",
    claimText:
      "ADV records a VYNDI V1 functional freeze after governed transaction-chain coverage, followed by enterprise hardening: branch protection, observability, backup/restore, load qualification, IAM/SoD, statutory controls, governed integrations and exact-SHA production certification.",
    claimClass: "verified_fact",
    authority: "advisory",
    domain: "governance",
    title: "VYNDI V1 Functional Design Freeze",
    sourceRevision: "ADV main snapshot",
    repository: ADV_REPO,
    sourceCommit: ADV_COMMIT,
    sourcePath: "docs/VYNDI-V1-FUNCTIONAL-DESIGN-FREEZE.md",
    sourceDate: "2026-09-20",
    knowledgeTier: "development-reference",
    keywords: ["v1 freeze", "h1", "h2", "h3", "h4", "h5", "backup", "iam", "sod", "load", "release", "certification"],
  },
  {
    id: "repo-vyndi-optimizer-operation",
    claimText:
      "Current VYNDI OS governed optimization executes HiGHS only against an exact immutable advanced-planning packet. The operator must build/refresh the packet, satisfy the preparation gate, then explicitly press “Run governed HiGHS optimization”. Chat never starts the solver automatically, and optimizer output cannot create purchase orders, production orders, inventory movements, funding actions or sales commitments.",
    claimClass: "verified_fact",
    authority: "controlled-reference",
    domain: "optimization",
    title: "VYNDI Advanced Planning Optimizer",
    sourceRevision: "VYNDI User Manual Rev 1.4 / runtime",
    repository: VYNDI_REPO,
    sourceCommit: VYNDI_COMMIT,
    sourcePath: "src/routes/command/ibpe-operating-workspace_.optimizer.tsx",
    sourceDate: "2026-09-24",
    knowledgeTier: "current-operational",
    keywords: ["optimizer", "optimiser", "highs", "milp", "advanced planning", "packet", "run", "execute", "cash governance", "funding"],
  },
  {
    id: "repo-vyndi-procurement-planning",
    claimText:
      "Current Procurement Planning reconciles the 36-month family plan with exact confirmed-order demand, physical FIFO stock, reservations, MSL and authorised open POs. Procurement valuation is governed separately and catalogue/reference prices do not become purchase cost unless a controlled price is approved.",
    claimClass: "verified_fact",
    authority: "controlled-reference",
    domain: "operations",
    title: "VYNDI Procurement Planning",
    sourceRevision: "current runtime",
    repository: VYNDI_REPO,
    sourceCommit: VYNDI_COMMIT,
    sourcePath: "src/routes/command/procurement-planning.tsx",
    sourceDate: "2026-09-24",
    knowledgeTier: "current-operational",
    keywords: ["procurement planning", "fifo", "msl", "purchase order", "po", "confirmed order", "valuation", "supplier price", "planning price"],
  },
  {
    id: "repo-vyndi-optimizer-readiness",
    claimText:
      "Current optimizer execution is blocked when no complete immutable advanced-planning packet exists or when packet preparation gates fail. When ready, VIBPE directs the operator to the governed optimizer route for explicit human execution against exact packet and parent-IBPE lineage.",
    claimClass: "verified_fact",
    authority: "controlled-reference",
    domain: "optimization",
    title: "VIBPE Governed Optimizer Co-Pilot",
    sourceRevision: "current runtime",
    repository: VYNDI_REPO,
    sourceCommit: VYNDI_COMMIT,
    sourcePath: "src/lib/vibpe-optimizer-copilot.ts",
    sourceDate: "2026-09-24",
    knowledgeTier: "current-operational",
    keywords: ["optimizer", "readiness", "blocked", "packet", "parent ibpe", "lineage", "highs", "execution", "route"],
  },
  {
    id: "repo-vyndi-user-manual-1-4",
    claimText:
      "VYNDI User Manual Rev 1.4 records the complete ERP optimization operating guide covering architecture, governed inputs/objectives, Procurement Planning, Scenario Studio, Advanced Planning Authority/HiGHS, cash/funding governance, rerun rules and VIBPE Co-Pilot optimization operations.",
    claimClass: "material_change",
    authority: "controlled-reference",
    domain: "operations",
    title: "VYNDI User Manual Rev 1.4",
    sourceRevision: "Rev 1.4",
    repository: VYNDI_REPO,
    sourceCommit: VYNDI_COMMIT,
    sourcePath: "src/routes/command/user-manual.tsx",
    sourceDate: "2026-09-24",
    knowledgeTier: "current-operational",
    keywords: ["user manual", "rev 1.4", "erp optimizer", "scenario studio", "procurement planning", "authority", "rerun", "copilot"],
  },
];

export function repositoryKnowledgeUrl(record: VibpeRepositoryKnowledgeRecord) {
  return `https://github.com/${record.repository}/blob/${record.sourceCommit}/${record.sourcePath}`;
}
