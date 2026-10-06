import { createFileRoute } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, Printer, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/command/user-manual")({ component: UserManual });

type ManualSection = {
  id: string;
  chapter: "A" | "B" | "C" | "D" | "E";
  title: string;
  route?: string;
  purpose: string;
  steps?: readonly string[];
  controls?: readonly string[];
  expected?: readonly string[];
  warnings?: readonly string[];
  notes?: readonly string[];
};

const CHAPTERS = [
  { id: "A", title: "Dossier Control & Orientation" },
  { id: "B", title: "Core Operating Workflows" },
  { id: "C", title: "Role Procedures & VIBPE" },
  { id: "D", title: "Traceability, Exceptions & Governance" },
  { id: "E", title: "Training, Example & Maintenance" },
] as const;

const SECTIONS: readonly ManualSection[] = [
  {
    id: "00",
    chapter: "A",
    title: "Cover & Document Control",
    purpose: "Controlled operating manual for authorised VYNDI OS users. Document VYNDI-UM-001 · Revision 1.5 · baseline 7 October 2026 · VIBPE Co-Pilot 2.0.",
    controls: [
      "Classification: Controlled Internal Operating Document.",
      "Intended users: Management, Commercial, Operations, Engineering, QA, Finance, Compliance and Admin.",
      "Review trigger: material UI, workflow, approval, role, VIBPE, RBAC, production platform or deployment-lineage change.",
      "Revision 1.2 records the GitHub organisation/repository migration to vayu-shastr/vyndios, Cloudflare production rebuild, verified source-lineage stamping, Hyperdrive runtime and Smart Placement.",
      "Revision 1.3 adds the complete ERP optimization operating guide: architecture, governed inputs and objectives, Procurement Planning UI, Scenario Studio UI, Advanced Planning Authority/HiGHS interface, cash/funding governance, rerun rules and VIBPE Co-Pilot optimization operations.",
      "Revision 1.4 adds VIBPE cross-repository knowledge: commit-pinned VEDM engineering authority, ADV finance/governance reference knowledge, current VYNDI optimizer/ERP operations, source-lineage evidence cards and the Repository Knowledge Snapshots register.",
      "Revision 1.5 adds Guided Work Mode: optional route-aware Learn Mode and Work Mode, RBAC-filtered next-step guidance, contextual Ask VYNDI hand-off and an explicit advisory-only authority boundary.",
    ],
  },
  {
    id: "00.1",
    chapter: "A",
    title: "Production Platform & Deployment Lineage",
    purpose: "Identify the authoritative production platform, repository source and deployment-lineage controls used to prove which VYNDI OS source is actually running.",
    controls: [
      "Authoritative Git repository: private repository shyamsundhar1982/vyndios; production branch: main.",
      "Authoritative production runtime: Cloudflare Worker tiger-field-flora-finch. The legacy Worker name is infrastructure identity only and does not change the VYNDI OS product name.",
      "Cloudflare runtime uses Hyperdrive for production PostgreSQL connectivity and Smart Placement for database-aware Worker placement.",
      "Workers Builds clones shyamsundhar1982/vyndios, runs npm run build:bundle, then deploys with npx wrangler deploy.",
      "Cloudflare WORKERS_CI_COMMIT_SHA is mapped into VYNDI_SOURCE_SHA during the build so governed runtime lineage is derived from the deployed commit rather than manually asserted.",
    ],
    expected: [
      "For a healthy production deployment, the Cloudflare build commit and runtime VYNDI_SOURCE_SHA refer to the same GitHub main commit.",
      "Governed Release Readiness should preserve exact deployed-source lineage through governed IBPE, the advanced-planning packet, optimizer execution and append-only audit evidence.",
      "A GREEN release-closure verdict proves configured technical/governance gates; it is separate from the live business-health score and operating exceptions.",
    ],
    warnings: [
      "Do not manually edit VYNDI_SOURCE_SHA to make lineage appear current. Trigger a real Workers Build from the intended GitHub commit.",
      "Do not rename or replace the production Worker as part of routine repository maintenance without a controlled migration and post-deployment verification.",
    ],
  },
  {
    id: "01",
    chapter: "A",
    title: "Purpose & Operating Philosophy",
    purpose: "VYNDI is one governed chain of business truth, not a collection of unrelated pages.",
    steps: [
      "Plan → Demand → Engineering/BOM → Inventory → Procurement → Receiving → Production → Traveller → Quality → Dispatch → Invoice → Collection.",
      "Source requirement → controlled transaction → evidence → approval where required → downstream consequence → audit trail.",
      "Command Centre, VIBPE, Finance, Governance, Audit and Administration support the transaction chain.",
    ],
  },
  {
    id: "02",
    chapter: "A",
    title: "First 30 Minutes with VYNDI",
    route: "/command",
    purpose: "Minimum orientation sequence for a new authorised user.",
    steps: [
      "Sign in with your individual VYNDI account.",
      "Open Command Centre and review current business condition.",
      "Open Action Inbox and Control Tower for exceptions requiring attention.",
      "Confirm your effective system role and page-level authority.",
      "Follow the governed workflow instead of jumping between unrelated pages.",
      "Use governed identifiers such as SO, JBC, PO, GRN, Traveller, serial and invoice for traceability.",
    ],
    warnings: ["A shared Command-password session may unlock a workspace but does not replace individual transaction identity."],
  },
  {
    id: "03",
    chapter: "A",
    title: "Navigation & Workspace Map",
    purpose: "Canonical VYNDI workspaces and the responsibility of each operating area.",
    controls: [
      "Command: Command Centre, Action Inbox, Control Tower, VIBPE and User Manual.",
      "Plan & Commercial: Integrated Operating Plan, Demand & Orders, Scenarios, Go-to-Market, Market Survey.",
      "Product & Engineering: Product, Engineering, BOM Control, BOM Cost.",
      "Supply & Operations: Overview, Inventory, Requirements, Purchase, Receiving, Build, Quality.",
      "People & Office: operating administration.",
      "Finance: Consolidated Overview, Cash & Bank, Payables, Receivables, Sales Ledger, Accounting Workbench, Financial Statements, Integrated Operating Plan, Budget vs Forecast vs Actual.",
      "Governance & Assurance: Approvals, Risk, Legal & IP, EPR, QA Verification, Audit & Actions, CA Audit.",
      "Admin: Users & Roles, Master Data, Classification.",
    ],
  },
  {
    id: "03.1",
    chapter: "A",
    title: "Guided Work Mode",
    purpose: "Optional in-context guidance for learning VYNDI and progressing work through the correct governed workspace without changing user authority.",
    steps: [
      "Select Guide from the lower-left of the Command shell.",
      "Use Learn Mode to understand the current department purpose, why the control exists and the normal procedure.",
      "Use Work Mode to see only next-step destinations permitted by your current RBAC role.",
      "Select Open step to navigate to the governed transaction or control surface.",
      "Select Ask VYNDI to open the existing VIBPE Co-Pilot with a contextual question for advisory explanation.",
    ],
    controls: [
      "Guided Work is route-aware and maps the current page to Management, Commercial, Planning, Engineering, Procurement, Inventory, Production, Quality, Finance, Administration or Governance guidance.",
      "Next-step links are filtered through the same canAccessRoute RBAC authority used by the Command shell.",
      "Learn/Work preference and open/closed preference are local UI preferences only; they do not alter governed business state.",
    ],
    warnings: [
      "Guidance never replaces RBAC, maker/checker, evidence or explicit human approval.",
      "Ask VYNDI remains advisory/read-only. Execute and approve controlled actions only in the owning governed workspace.",
    ],
  },
  {
    id: "04",
    chapter: "A",
    title: "Roles & Access Control",
    purpose: "VYNDI separates system roles from organisational job functions.",
    controls: [
      "admin — view, edit, approve, administer.",
      "management — broad view and edit.",
      "board — view only.",
      "finance — finance-domain view/edit/approve.",
      "operations — operations-domain view/edit/approve.",
      "engineering — engineering-domain view/edit/approve.",
      "qa — QA/manufacturing view/edit/approve.",
      "compliance — compliance/legal/risk view/edit/approve.",
      "viewer — read only.",
    ],
    warnings: ["Sales, Stores, Procurement and Production are operating functions, not separate current VYNDI login roles."],
  },
  {
    id: "05",
    chapter: "B",
    title: "Commercial / Demand & Orders",
    route: "/command/sales",
    purpose: "Create and revise controlled demand and commercial orders before downstream Production synchronization.",
    steps: [
      "Open Plan & Commercial → Demand & Orders.",
      "Enter month, model/variant, units, channel and status.",
      "Review optional component configuration.",
      "Select Add demand / order.",
      "Verify the persisted Commercial revision receipt.",
      "For confirmed demand, verify Production job-card synchronization.",
    ],
    controls: ["Current statuses: lead, confirmed, delivered, cancelled."],
    warnings: ["A lead is pipeline demand, not a production commitment or recognised collection."],
  },
  {
    id: "06",
    chapter: "B",
    title: "Product & BOM Control",
    route: "/command/bom-control",
    purpose: "Establish the controlled product identity and released material definition used by procurement and production.",
    steps: [
      "Create the new BOM revision as a controlled master and submit/approve it.",
      "Add every required component/SKU and quantity to that revision. New SKUs must already be approved in Inventory Master.",
      "Enter the engineering release reason / ECR reference and select Release revision. VYNDI activates the complete revision and supersedes the prior active revision for the same model scope.",
      "Review Bottom-up BOM cost and missing-cost exceptions, then open Procurement impact.",
      "Review Existing Job Card impact. Current/future planning follows the new BOM; already released or in-progress Job Cards retain their frozen BOM revision and mapping snapshot.",
      "Rerun governed VIBPE after a material BOM change before relying on updated procurement/funding recommendations.",
    ],
    controls: [
      "Only one released BOM revision may be active for a model/variant scope.",
      "BOM release requires an approved BOM master and approved Inventory Master records for every mapped SKU.",
      "Procurement and bottom-up COGS read the active released BOM dynamically.",
    ],
    warnings: [
      "Do not substitute a component merely because it appears physically compatible. Use approved Engineering/BOM authority.",
      "Do not silently resynchronize an existing Job Card to a later BOM revision. A frozen build requires controlled production-change review.",
    ],
  },
  {
    id: "07",
    chapter: "B",
    title: "Master Inventory / Stores",
    route: "/command/inventory",
    purpose: "Maintain one auditable stock view covering quantity, MSL, demand coverage, health and forecast.",
    steps: [
      "Use Receive against PO for normal supplier deliveries.",
      "Normal flow: PO → Receiving → Inspection → GRN → FIFO Inventory.",
      "Use Item / manual receipt only for master-data setup, openings, authorised non-PO adjustments or evidenced corrections.",
    ],
    warnings: ["Do not use manual inventory entry as a shortcut around PO receiving and incoming inspection."],
  },
  {
    id: "08",
    chapter: "B",
    title: "Procurement Requirements & Purchase Execution",
    route: "/command/purchase-execution",
    purpose: "Convert governed shortages and authorised needs into controlled supplier commitments.",
    steps: [
      "Expand Production shortage drafts and select the required shortage line.",
      "Assign an approved supplier.",
      "Confirm unit price, expected receipt and payment terms.",
      "Enter Quote / RFQ evidence.",
      "Select Submit for approval.",
      "After approval, issue the PO through the governed lifecycle.",
    ],
    controls: ["Manual controlled PO is for authorised needs not already represented by a Production shortage draft."],
    warnings: ["Draft PO ≠ supplier commitment. Approval and issuance remain separate states."],
  },
  {
    id: "09",
    chapter: "B",
    title: "Receiving & Inspection / GRN",
    route: "/command/receiving",
    purpose: "Record physical receipt and incoming inspection at the inventory boundary.",
    steps: [
      "Select the issued Purchase Order.",
      "Enter GRN number and received date.",
      "Select Accepted, Quarantine or Rejected.",
      "Enter received/accepted/rejected quantities and evidence.",
      "Select Post controlled GRN.",
      "For quarantine, enter disposition evidence then Accept to stock or Reject material.",
    ],
    controls: ["Accepted material becomes a FIFO inventory layer. Quarantined and rejected material remain outside available stock until authorised disposition."],
  },
  {
    id: "10",
    chapter: "B",
    title: "Production / Job Cards / Traveller",
    route: "/command/production",
    purpose: "Synchronise Commercial commitment to controlled build execution, batch approval and serial genealogy.",
    steps: [
      "Review confirmed Commercial orders and current Job Card revisions.",
      "Reconcile any order that is not synchronized before execution.",
      "For a released Job Card, use Approve bike / batch when authorised.",
      "Verify batch identity, Travellers and any generated shortage PO drafts.",
    ],
    controls: ["The Traveller is the manufacturing genealogy record for the physical unit."],
    warnings: ["Production approval can create shortage PO drafts; it does not approve or issue supplier commitments."],
  },
  {
    id: "11",
    chapter: "B",
    title: "Material Requisition & Issue",
    route: "/command/production",
    purpose: "Issue controlled materials to the correct Job Card and Traveller with reservation and FIFO evidence.",
    steps: [
      "Open Material Requisition & Issue inside Production.",
      "Verify Job Card, order, SKU, required quantity, reservation status and Traveller/serial.",
      "Reserve and issue the correct FIFO stock where applicable.",
      "Use the controlled print action when a formal issue record is required.",
    ],
    warnings: ["Never alter inventory merely to make Production appear material-ready."],
  },
  {
    id: "12",
    chapter: "B",
    title: "Quality / NCR / CAPA / Release",
    route: "/command/quality",
    purpose: "Control inspection evidence, non-conformance, corrective action and serialized release status.",
    controls: ["Inspection Register", "NCR Register", "CAPA", "Serialized Quality Release Register"],
    steps: [
      "Review incoming, in-process and final inspection lineage.",
      "Resolve NCR/CAPA through authorised disposition and effectiveness evidence.",
      "Verify current serialized Quality Release before shipment eligibility.",
    ],
    warnings: ["Production completion or Job Card approval is not the same as Quality Release."],
  },
  {
    id: "13",
    chapter: "B",
    title: "Dispatch & Operations Overview",
    route: "/command/operations",
    purpose: "View order-to-cash lineage and ensure shipment remains Operations-owned and Quality-gated.",
    steps: [
      "Review committed lineage, shortages, inventory alerts, Quality releases, open NCR and posted dispatch.",
      "Verify Order → Job Card → Traveller → Quality Release → Shipment before dispatch.",
    ],
    warnings: ["Dispatch must not exceed current eligible serialized Quality-release capacity."],
  },
  {
    id: "14",
    chapter: "B",
    title: "Finance / Receivables / Collections",
    route: "/command/receivables",
    purpose: "Maintain governed order-to-cash accounting from posted shipment through invoice and bank-backed collection.",
    steps: [
      "Issue invoice: select posted shipment, enter Invoice ID and evidence, then Issue invoice.",
      "Post collection: select open invoice, enter Collection ID, month, amount and bank reference, then Post collection.",
    ],
    warnings: ["Lead ≠ Order ≠ Dispatch ≠ Invoice ≠ Collection."],
  },
  {
    id: "15",
    chapter: "C",
    title: "Role-Based Daily Procedures",
    purpose: "Recommended daily sequence by business function.",
    controls: [
      "Management: Command → Action Inbox → Control Tower → Exceptions → Operations → Finance → VIBPE.",
      "Commercial: Demand & Orders → new demand/revision → persistence receipt → Production synchronization.",
      "Stores: Inventory → Receiving → GRN → quarantine disposition → requisition → FIFO issue.",
      "Procurement: Requirements → shortage drafts → supplier/price/evidence → approval → issue → receipt follow-up.",
      "Production: orders → Job Cards → batch approval → Traveller → material issue → build → Quality handoff.",
      "Quality: inspection → NCR/CAPA → final evidence → serialized release.",
      "Finance: Consolidated Overview → transactions → Accounting & Statements → Budget vs Forecast vs Actual → liquidity.",
      "Admin: users → roles → master data → classification; never use admin authority to bypass business gates.",
    ],
  },
  {
    id: "16",
    chapter: "C",
    title: "How to Operate VIBPE — Workflow Overview",
    route: "/command/ibpe-operating-workspace",
    purpose: "Operate VIBPE as a controlled six-stage decision-support sequence rather than treating the pages as independent dashboards.",
    steps: [
      "1. Operating Workspace — understand the current business condition, exceptions and unverified areas; capture or route governed updates when needed.",
      "2. Planning Authority — establish evidence-backed capacity, routing and supplier-lane authority.",
      "3. Governed Optimizer — freeze an immutable planning packet and run the HiGHS solver only when the preparation gate is READY.",
      "4. Outputs & Evidence — review and print the consolidated read-only evidence pack and exact run lineage.",
      "5. VIBPE Assurance — inspect critical/warning exceptions, backend authority gaps and runtime UI proof; capture an assurance snapshot.",
      "6. Release Readiness — read the final closure verdict; every release gate must be evidenced for GREEN.",
    ],
    controls: [
      "Normal operator direction: Workspace → Authority → Optimizer → Outputs → Assurance → Release.",
      "If any downstream page is BLOCKED, follow the evidence back to the owning authority, correct the underlying record, then rebuild/refresh the governed packet.",
      "VIBPE is advisory and governed. It does not replace Commercial, Engineering, Procurement, Production, Quality or Finance transaction authority.",
    ],
    expected: ["The six pages together provide a traceable chain from operating evidence through planning authority, solver evidence, assurance and release closure."],
    warnings: ["Do not skip directly to Release Readiness and interpret a red/blocked result as a software fault. A blocked gate normally means required evidence or authority is missing."],
  },
  {
    id: "16.1",
    chapter: "C",
    title: "VIBPE 01 — Operating Workspace",
    route: "/command/ibpe-operating-workspace",
    purpose: "Use the Operating Workspace as the management starting point: identify exceptions, inspect evidence ownership and safely route a business update without silently rewriting canonical business truth.",
    steps: [
      "Open Today's Control Room. Review Governed exceptions, Unverified areas, Open orders and Open job cards before making a planning decision.",
      "Review every ATTENTION or UNVERIFIED section shown below the KPIs. Use Open authority → to move to the canonical page that owns the underlying business record.",
      "Read the Founder Briefing and Management Report to understand which domains need action now and which evidence is missing.",
      "When new information has arrived outside VYNDI, enter a substantive statement in Business Update. Example: Supplier quotation RFQ-24-018 confirms revised lead time of 45 days.",
      "Select 1. Preview interpretation. Read the returned interpretation and any ambiguity message. Nothing has changed in protected business truth at this stage.",
      "If the interpretation matches the evidence, select 2. Authorise proposal. This records human confirmation, but protected records still have not changed.",
      "Select 3. Apply governed adapter only after the preview and authority are correct. If an approved canonical adapter exists, VYNDI applies through that adapter and records the audit event; otherwise the change remains blocked.",
      "Use Capture governed snapshot before or after an important management decision when you need an immutable evidence point for later comparison.",
      "Use Print detailed report when a management pack or audit copy is required.",
    ],
    controls: [
      "OK means evidence is present and no current exception was projected for that section.",
      "ATTENTION means the section contains governed exceptions requiring action.",
      "UNVERIFIED means evidence is absent or insufficient; VYNDI deliberately does not infer a healthy state.",
      "Business Update sequence is Preview → Authorise → Apply governed adapter.",
    ],
    expected: [
      "After a governed adapter succeeds, the status message identifies the adapter, entity and recorded audit event.",
      "After snapshot capture, the page returns a snapshot ID that can be used as an evidence reference.",
      "When an authority-owned issue is corrected, return to the Workspace and reassess the section before moving into advanced planning.",
    ],
    warnings: [
      "Do not authorise a proposal when the preview is ambiguous or does not match the source evidence.",
      "Do not assume Authorise proposal changes the business record. Application occurs only through a registered governed adapter.",
    ],
  },
  {
    id: "16.2",
    chapter: "C",
    title: "VIBPE 02 — Planning Authority",
    route: "/command/ibpe-operating-workspace/authority",
    purpose: "Close planning-authority gaps in the required order: Capacity → persisted Routing → Supplier lanes → rebuild the governed packet.",
    steps: [
      "Check the three Authority sequence cards first. Do not start with the optimizer until Capacity, Routing and Supplier lanes show READY.",
      "Capacity: if REVIEW REQUIRED, inspect each active work-centre row, including available hours/month, efficiency, standard hours/unit and Source. Confirm that the controlled values are correct.",
      "Select Approve current capacity standards only when the existing numeric standards are supported. This action approves the controlled values; it does not edit them.",
      "Routing: once Capacity is READY, select Create routing drafts from approved capacity if planned products lack approved routing. Review the created product revision and operation count.",
      "For each valid draft routing, select Approve routing. Repeat until every planned product has approved persisted routing authority.",
      "Supplier lanes: if DATA REQUIRED, review the missing governed SKU count. Use Procurement Control / Requirements to complete supplier evidence rather than inventing values on the Authority page.",
      "For supplier-lane readiness, ensure each governed BOM SKU is covered by an active approved supplier with lead-time evidence, MOQ/order multiple, alternate rank, landed-cost source, reliability evidence, policy source and finite planning-horizon capacity.",
      "When Capacity, Routing and Supplier lanes are all READY, open the Optimizer and select Refresh governed advanced-planning packet so the solver uses the newly frozen authority evidence.",
    ],
    controls: [
      "Capacity approval preserves existing controlled numeric values.",
      "Routing drafts are deterministically derived from approved capacity standards and still require separate human approval.",
      "Supplier-lane facts are never inferred or auto-generated.",
      "Cash guardrails remain independent; Planning Authority cannot override liquidity governance.",
    ],
    expected: [
      "Capacity card: READY and approved count equals active count.",
      "Routing card: READY and covered planned products equals total planned products.",
      "Supplier lanes card: READY and governed BOM SKU coverage is complete.",
      "Only after all three are ready should the operator rebuild/refresh the advanced-planning packet.",
    ],
    warnings: [
      "Do not approve a capacity or routing record merely to turn the card green. Validate its source evidence first.",
      "Do not create supplier assumptions on this page to bypass missing procurement evidence.",
    ],
  },
  {
    id: "16.3",
    chapter: "C",
    title: "VIBPE 03 — Governed Optimizer",
    route: "/command/ibpe-operating-workspace/optimizer",
    purpose: "Freeze the current governed planning evidence into an immutable packet and run the HiGHS optimizer only when the execution gate is READY.",
    steps: [
      "Open Governed preparation gate. If no packet exists, select Build governed advanced-planning packet. This freezes lineage, model and authority evidence from the latest complete governed IBPE snapshot; it does not run the solver.",
      "If authority, supplier, demand, routing or other governed planning evidence changed since the current packet, select Refresh governed advanced-planning packet before optimizing.",
      "Read every preparation issue shown under the gate. If Execution gate is BLOCKED, resolve the listed issue at its owning authority and return to refresh the packet.",
      "When the packet exists and Execution gate shows READY, select Run governed HiGHS optimization.",
      "Read the execution status message and, where required, open Execution receipt for the persisted run identifiers and detailed response.",
      "Review Latest persisted run: Mathematical status, Cash governance, Planning disposition, Funding evidence basis, Authoritative for funding decision, first funding/cash-gap period, peak exposure and Accepted for execution.",
      "If Planning disposition is funding-required, distinguish between authoritative governed funding evidence and provisional test/benchmark supplier economics before taking any management action.",
      "After a successful run, proceed to Outputs & Evidence to review the consolidated evidence pack rather than acting directly from one optimizer number.",
    ],
    controls: [
      "The solver runs against the exact selected immutable packet; changing live business data does not silently mutate that packet.",
      "Optimizer output is advisory evidence only. The page cannot create POs, production orders, inventory movements, funding actions or sales commitments.",
      "A mathematically feasible plan can still be blocked by cash governance or evidence quality.",
      "Accepted for execution is part of optimizer evidence, not a substitute for downstream transaction approvals.",
    ],
    expected: [
      "A governed run persists an Optimization run ID linked to the selected Advanced packet.",
      "READY + successful execution produces a persisted solver result and cash-governance classification.",
      "BLOCKED means at least one preparation/authority condition must be resolved before another governed run is meaningful.",
    ],
    warnings: [
      "Do not treat provisional scenario capital exposure as an authoritative fundraising requirement when supplier economics are test/benchmark based.",
      "Do not use the optimizer as an automatic procurement or funding engine; it has no such transaction authority.",
    ],
  },
  {
    id: "16.4",
    chapter: "C",
    title: "VIBPE 04 — Outputs & Evidence",
    route: "/command/ibpe-operating-workspace/outputs",
    purpose: "Review the complete read-only planning evidence pack after optimization and produce a controlled management or audit report.",
    steps: [
      "Start with Executive readiness. Read the four cards in order: Planning authority, Optimizer gate, Assurance exceptions and Release verdict.",
      "Review Governed planning lineage and record the exact Latest governed IBPE run, Advanced packet, Optimization run and Audit event identifiers. These IDs establish the evidence chain.",
      "Review Latest optimization output for mathematical status, cash governance, Accepted status, objective value and creation time.",
      "Review Authority evidence. If Capacity, Routing or Supplier lanes are not READY, use Authority workbench / Procurement Control / Cash authority links to correct the owning evidence rather than editing this report.",
      "Review Release closure. Every listed release gate must show PASS for a GREEN final verdict.",
      "Open Machine-readable evidence summary when you need a copyable structured record for audit, testing or technical reconciliation.",
      "Select Print governed report to produce the human-readable evidence pack for review or record retention.",
    ],
    controls: [
      "This page is consolidated read-only output. It creates no transaction authority.",
      "The evidence summary explicitly states advisoryOnly=true and links authority, packet, optimizer, assurance and release state.",
      "A high-quality report must preserve exact run IDs rather than only copying headline KPI values.",
    ],
    expected: [
      "The report should let a reviewer answer: What authority was used? Which packet was solved? Which run produced the result? What exceptions remain? Which closure gates are blocked?",
      "If any readiness card is BLOCKED, return to the owning upstream page; do not attempt to repair the condition from Outputs & Evidence.",
    ],
    warnings: ["Do not interpret a printed Outputs report as approval to execute purchases, production, funding or customer commitments."],
  },
  {
    id: "16.5",
    chapter: "C",
    title: "VIBPE 05 — Assurance",
    route: "/command/ibpe-operating-workspace/assurance",
    purpose: "Prove that governed backend authority, workflows, gates, exception detection and runtime UI capabilities are actually evidenced; unobserved evidence is not treated as a pass.",
    steps: [
      "Read Assurance Posture first: Critical exceptions, Warning exceptions, Backend surface gaps and UI proof outstanding.",
      "Open Live Exceptions. If the page is showing only the highest-priority subset, select Load complete register when you need the full exception population.",
      "For each critical or warning exception, note Domain, Exception type, Entity, Gate and Correlation ID. Correct the underlying canonical authority/workflow rather than suppressing the exception.",
      "Review Authority Surface Register. FULL means backend evidence coverage exists; PARTIAL/GAP means the authority surface is incomplete and requires remediation.",
      "Review Runtime UI Assurance. PASS requires observed passing evidence. UNOBSERVED is deliberately not promoted to green.",
      "Select Load capability register when you need the detailed UI capability, route and expected-result rows for diagnosis or acceptance testing.",
      "Review Governed Gate & Workflow Coverage to confirm the evidence model covers the active business gates and workflows; Assurance is not an alternate transaction engine.",
      "Select Capture assurance snapshot when you need immutable evidence of the current assurance posture, especially before a release-readiness review or after remediation.",
    ],
    controls: [
      "Backend authority and UI proof are assessed separately.",
      "A proven database/backend surface does not automatically prove that the user-facing route works.",
      "An unobserved UI capability remains outstanding even when no explicit failure was detected.",
      "Assurance snapshots preserve the exception counts and current evidence state for later audit/comparison.",
    ],
    expected: [
      "Before release review, critical exceptions should be zero and material backend/UI evidence gaps should be resolved or explicitly understood.",
      "A captured snapshot returns a Snapshot ID plus critical, warning and total exception counts.",
    ],
    warnings: [
      "Do not mark an unobserved capability as passed merely because no user has reported a problem.",
      "Do not delete or hide assurance exceptions to improve the score; correct the evidence or owning workflow.",
    ],
  },
  {
    id: "16.6",
    chapter: "C",
    title: "VIBPE 06 — Release Readiness",
    route: "/command/ibpe-operating-workspace/release",
    purpose: "Read the final evidence-based optimizer production-closure verdict. This page does not perform a release transaction; it tells you whether every required closure gate is proven.",
    steps: [
      "Read Release verdict first. GREEN means every governed production-closure gate currently has evidence. A non-GREEN verdict means at least one gate is BLOCKED.",
      "Review Closure gates one by one. For every BLOCKED gate, read its Evidence text to identify the missing runtime, migration, packet, solver, cash-governance, actor or audit condition.",
      "Review Production runtime to confirm transport source, required migration status, persistence-function presence and optimizer-run evidence.",
      "Record the Release evidence identifiers: Advanced packet, Optimization run and Audit event. Missing identifiers indicate incomplete closure lineage.",
      "If a gate is blocked, use the Optimizer, VIBPE Assurance or Operating Workspace links to return to the relevant evidence source, correct the underlying condition, then revisit Release Readiness.",
      "Use GREEN as proof that the VIBPE optimizer release-closure criteria are evidenced; continue to respect the separate transaction approvals required by Procurement, Production, Quality, Finance and other canonical workspaces.",
    ],
    controls: [
      "Every closure gate must PASS for GREEN; no gate is inferred.",
      "Release Readiness is a verdict/reporting surface, not a button that releases purchases, production units, funds or customer commitments.",
      "The verdict is derived from runtime, migration, exact deployed-source and packet lineage, persisted solver execution, cash governance, actor evidence and append-only audit evidence.",
      "For source-lineage PASS, verify that the deployed Cloudflare source SHA is the source carried by the governed IBPE/advanced-planning evidence chain; stale or manually asserted SHA values are not acceptable evidence.",
    ],
    expected: [
      "GREEN: all configured VIBPE optimizer production-closure gates are evidenced.",
      "BLOCKED / non-GREEN: use the failing gate evidence as the remediation checklist and repeat the upstream governed sequence.",
    ],
    warnings: ["Do not describe the VIBPE optimizer as fully production-proven while any release-closure gate remains blocked."],
  },
  {
    id: "16.7",
    chapter: "C",
    title: "ERP Optimization Architecture — What the Engine Optimizes",
    purpose: "Explain the complete VYNDI optimization stack before an operator uses any recommendation. ERP optimization is a governed decision-support chain that reconciles demand, materials, inventory, supplier lanes, capacity, routing, procurement economics and cash; it is not an automatic transaction engine.",
    steps: [
      "Start from governed source truth: approved plan, actual/committed demand, released BOM and exact Job Card requirements, inventory, reservations, committed/open receipts, approved capacity, approved routing, approved supplier lanes and governed finance/cash evidence.",
      "Run governed IBPE to reconcile the operating picture and persist the authoritative snapshot used by downstream planning.",
      "Close Advanced Planning Authority gaps for Capacity, Routing and Supplier lanes.",
      "Build or refresh the immutable advanced-planning packet. The packet freezes the exact source lineage, planning model and authority evidence for one optimization decision.",
      "Run the governed HiGHS optimizer only when the execution gate is READY.",
      "Read mathematical feasibility together with cash governance, evidence quality and business-health exceptions. One green mathematical result is never sufficient on its own.",
      "Use Outputs & Evidence, Assurance and Release Readiness to prove the exact packet → run → actor → audit → deployed-source lineage before describing the run as release-closed.",
    ],
    controls: [
      "Current governed model: VYNDI-ADVANCED-PLANNING-0.1 with a 36-period planning horizon.",
      "Demand model: committed and forecast demand remain distinct. Committed demand carries higher governed priority and is protected more strongly than forecast demand.",
      "Material model: released BOM quantity-per-unit and scrap, on-hand quantity, reservations/safety stock and committed receipts form the material constraint set.",
      "Capacity model: finite work-centre/resource hours, efficiency, routing run hours, setup/yield and resource eligibility constrain production.",
      "Supplier-lane model: only approved lanes may be used; lead time, MOQ, order multiple, landed cost, reliability, validity and finite period capacity are governed constraints.",
      "Current governed objective weights are: unmet committed demand 100; unmet forecast demand 30; lateness 50; resource overload 100; supplier overload 100; procurement cost 5; working capital 3; schedule change 2.",
      "Those objective weights are controlled model policy, not operator sliders. Change them only through an approved model/release change.",
      "Solver outputs can include demand served/unmet, lateness, production quantities by period, procurement supplier/SKU/order/receipt quantities, resource assignments, binding constraints, diagnostics and objective contributions.",
      "The optimizer contract supports LP/MILP classes and the production interface executes the governed HiGHS adapter.",
    ],
    expected: [
      "The optimizer should prefer satisfying committed demand and respecting hard resource/supplier constraints before optimizing lower-weight economic objectives.",
      "A valid optimization result remains advisoryOnly=true, mayCreateTransactions=false and humanApprovalRequiredForBusinessAction=true.",
    ],
    warnings: [
      "Do not interpret an objective value by itself as business performance. Always read its constraint and cash context.",
      "Do not change master data merely to force a feasible result. Correct source evidence only when the business fact itself changed.",
      "Do not bypass authority gaps by creating invented supplier, routing, cost or capacity assumptions.",
    ],
  },
  {
    id: "16.8",
    chapter: "C",
    title: "ERP Material & Procurement Optimization — UI and Operation",
    route: "/command/procurement-planning",
    purpose: "Operate the Procurement Planning interface as the material-reconciliation and procurement-decision layer that feeds governed IBPE and advanced optimization.",
    steps: [
      "Open Supply & Operations → Material Requirements / Procurement Planning.",
      "Read the top KPI row first: Approved-plan procurement, Committed demand, Net SKU requirement, Control exceptions and Planning horizon.",
      "If Needs attention appears, resolve planning BOM mapping issues or confirmed orders that are not correctly projected to current released Job Cards before trusting the material promise.",
      "Open Procurement Cost Authority. Review Active BOM SKUs, Governed costs, Unresolved costs and Reference-only counts.",
      "For each SKU, read Current authority and Governed INR. The authority hierarchy is FIFO actual → approved purchase order → approved supplier price → approved planning procurement price → Missing.",
      "To establish a new controlled price, choose New authority = Planning or Supplier. For Supplier, select an approved supplier. Enter INR/unit and Quote / RFQ / approved basis in Evidence.",
      "Select Save draft. A draft is not yet eligible for governed IBPE valuation. A different authorised user should then review and select Approve draft.",
      "After price approval, confirm the SKU shows governed cost coverage. Catalogue/reference prices remain excluded until converted into controlled approved authority.",
      "Open Reconciled SKU requirements. Read each row left-to-right: Month, SKU, Plan, Committed, Governing, Physical, Reserved, ATP, MSL, Open PO, Projected close, Net buy, Basis and Action.",
      "For a positive Net buy, use RFQ, APPROVAL or PO to record the appropriate procurement-stage action. These buttons record controlled planning/action status; use Execute purchase for the full supplier-commitment workflow.",
      "Use the 36-month approved-plan context disclosure to see requirement month, planning month, product mix, modeled procurement and tranche context.",
      "After material/cost authority materially changes, rerun governed IBPE before relying on a new procurement or funding recommendation.",
    ],
    controls: [
      "Planned SKU requirement comes from the approved 36-month plan multiplied by one approved planning-standard BOM per family.",
      "Committed SKU requirement comes from exact confirmed/released production demand. The larger of planned versus committed requirement governs each period so confirmed demand is not double-counted on top of forecast demand.",
      "Current monthly net-buy logic: projected opening stock = prior projected stock + open PO; net buy = max(governing requirement + MSL − projected opening stock, 0); projected closing stock = projected opening + net buy − governing requirement.",
      "Physical, Reserved and ATP remain visible reconciliation signals. Reservations reduce ATP without physically moving stock.",
      "MSL is protected as safety stock in the requirement calculation.",
      "Procurement cost authority is separate from catalogue/reference data. Missing controlled cost means procurement/funding valuation is commercially incomplete.",
      "Finance target COGS is a top-down commercial assumption; bottom-up BOM procurement cost is an independent model and variance is intentionally visible.",
      "Current procurement-cost entry accepts INR. Foreign-currency supplier quotations require governed FX conversion before controlled entry.",
      "Planning early does not itself move finance cash timing; approved PO/receipt/payment timing controls the actual cash consequence.",
    ],
    expected: [
      "Control exceptions should be zero or explicitly understood before a material promise is treated as reliable.",
      "All active planning-BOM and exact committed requirement SKUs needed for valuation should have governed cost authority.",
      "A positive Net buy should have an owned procurement action and eventually trace into the governed PO/receiving workflow.",
    ],
    warnings: [
      "RFQ / APPROVAL / PO on the requirements grid is not permission to bypass Purchase Execution approval and issuance.",
      "Do not approve a supplier or planning price without source evidence.",
      "Do not use catalogue/reference price as if it were a governed procurement cost.",
    ],
  },
  {
    id: "16.9",
    chapter: "C",
    title: "ERP Scenario Studio — What-If Optimization UI",
    route: "/command/scenarios",
    purpose: "Use Scenario Studio to test controlled what-if assumptions against the latest governed IBPE snapshot without changing the approved plan, actuals, contractual commitments or operating ledgers.",
    steps: [
      "Open Plan & Commercial → Scenarios / IBPE Scenario Studio.",
      "Choose a Fast scenario preset or keep Custom scenario. Presets include Growth +25%, Supply shock, Capacity lift, Cash protect, Funding bridge and Severe stress.",
      "Enter a Scenario name. Use Reset whenever you need to return every lever to the governed-baseline multiplier.",
      "Set Scenario drivers: Demand outlook, Available capacity, Procurement cost, Supplier lead time, Receipt delay and Funding bridge.",
      "UI ranges are: Demand 25%–200%; Available capacity 50%–200%; Procurement cost 60%–180%; Supplier lead time 50%–250%; Receipt delay 0–12 months; Funding bridge ₹0–₹10,000L with injection month M1–M36.",
      "Select Run scenario. The deterministic engine derives the scenario from the latest complete governed IBPE snapshot; it does not overwrite that snapshot.",
      "Read the Decision packet KPIs: Health score, Expected units, Recommended procurement, Min free liquidity, Incremental funding need and Findings. Every KPI shows a delta versus the governed baseline.",
      "Verify Governed lineage: approved plan revision, input hash, source SHA and parent governed run ID.",
      "Inspect Liquidity trajectory to compare baseline versus scenario after recommended procurement.",
      "Inspect Priority findings for the exception, severity, problem and recommended controlled action.",
      "Inspect Material & purchase actions for Month, SKU, Demand basis, Plan/exact requirement, Shortage, Recommend buy and Cost.",
      "When more than one scenario has been run, use Scenario comparison memory to compare Health, Units delta, Procurement delta, Liquidity delta and Funding need.",
      "Use the VIBPE Co-Pilot scenario context to ask why a number changed, which shortage drives the result, or which controlled lever improves feasibility.",
    ],
    controls: [
      "Scenario demand multipliers flex residual forecast/pipeline demand; actual and committed quantities are preserved.",
      "Capacity multiplier changes analytical available capacity only.",
      "Procurement-cost multiplier changes analytical material unit costs only.",
      "Lead-time multiplier changes analytical supplier/material lead time; Receipt delay shifts modeled receipts and drops receipts that move outside M36.",
      "Funding bridge adds a forecast scenario cash inflow; it does not create real financing or a bank transaction.",
      "Scenario output is advisoryOnly=true and preserves lineage to the governed snapshot used as its baseline.",
      "Scenario history shown on the page is comparison memory for the current session; it is not an alternate source of transactional truth.",
    ],
    expected: [
      "A scenario should make trade-offs visible before management commits an operating change.",
      "The operator should be able to explain which changed lever caused the change in health, procurement, shortage, liquidity or funding need.",
    ],
    warnings: [
      "Do not confuse Scenario Studio with the governed HiGHS production optimizer. Scenario Studio flexes analytical assumptions; the governed optimizer solves an immutable authority-backed planning packet.",
      "Do not treat a scenario funding bridge as approved funding.",
      "Do not copy a scenario recommendation into a PO, production order or customer promise without the corresponding canonical approval workflow.",
    ],
  },
  {
    id: "16.10",
    chapter: "C",
    title: "Advanced Planning Authority & HiGHS — Complete UI Interface",
    route: "/command/ibpe-operating-workspace/optimizer",
    purpose: "Operate the authority workbench and governed HiGHS interface using the exact screen states, buttons and evidence fields presented by VYNDI.",
    steps: [
      "Authority screen: open /command/ibpe-operating-workspace/authority. At Authority sequence, read 1 Capacity, 2 Routing and 3 Supplier lanes.",
      "Capacity card states are READY or REVIEW REQUIRED. Open Capacity authority and review Status, Work centre, Available h/mo, Efficiency, Std h/unit and Source. Use Approve current capacity standards only after validating the controlled source values.",
      "Routing card states are READY or REVIEW REQUIRED. If required, select Create routing drafts from approved capacity or Refresh routing drafts. Review each product revision and operation count, then use Approve routing on each valid draft.",
      "Supplier lanes card states are READY or DATA REQUIRED. Review Approved active suppliers, Approved supplier prices and Approved supplier lanes. Missing SKU coverage must be resolved from Procurement Control / Requirements; supplier-lane facts are never inferred.",
      "When all authority cards are READY, use Return to Optimizer.",
      "Optimizer screen: at Governed preparation gate, verify Advanced packet, Parent IBPE run, Packet/model and Execution gate.",
      "If no packet exists, select Build governed advanced-planning packet. If source/authority evidence changed, select Refresh governed advanced-planning packet. Packet preparation freezes evidence but does not run the solver.",
      "Read every preparation issue. Execution gate must be READY before the solver button becomes valid.",
      "Under Run governed optimizer, select Run governed HiGHS optimization. The button runs against the exact frozen packet selected on the page.",
      "Read the status message immediately after execution. Open Execution receipt when detailed persisted identifiers/response evidence is required.",
      "Under Latest persisted run, read Run, Mathematical status, Cash governance, Planning disposition, Funding evidence basis, Authoritative for funding decision, first funding/cash-gap value and period, peak funding/exposure value and period, Baseline reserve funding need, Accepted for execution, Objective and Created time.",
      "Proceed to Outputs & Evidence, then Assurance, then Release Readiness. The optimizer page alone is not the final release verdict.",
    ],
    controls: [
      "Authority sequence is Capacity → persisted Routing → Supplier lanes → rebuild/refresh packet.",
      "Mathematical status can be optimal, feasible, infeasible, indeterminate or error.",
      "A feasible mathematical solution is validated against governed model identity, objective weights, demand outcomes, production decisions, supplier-lane identity/approval, lead time, MOQ, order multiple, resource eligibility and other model constraints.",
      "Accepted for execution is optimizer evidence only; it never substitutes for Procurement, Production, Quality, Finance or Commercial approval.",
      "Execution is human initiated and produces immutable advisory evidence linked to packet ID and request/run identifiers.",
    ],
    expected: [
      "READY preparation gate + successful HiGHS execution should create a persisted optimization run linked to the immutable packet.",
      "If a hard constraint cannot be satisfied, the operator should use the diagnostic/binding-constraint evidence to correct the owning business authority or consciously revise the governed plan.",
    ],
    warnings: [
      "Never run repeatedly against a stale packet after a material source or authority change.",
      "Never approve capacity/routing simply to make the screen green.",
      "Never treat a solver proposal through an unapproved supplier lane as valid; the validator rejects it.",
    ],
  },
  {
    id: "16.11",
    chapter: "C",
    title: "Cash & Funding Governance — Reading Optimizer Results",
    purpose: "Interpret the cash overlay that decides whether a mathematically feasible plan is execution-ready, funding-dependent or unsupported by complete cash evidence.",
    steps: [
      "After HiGHS returns an optimal/feasible accepted mathematical run, VYNDI evaluates the proposed procurement against governed cash guardrails and payment timing.",
      "Read Cash governance and Planning disposition together. Planning disposition can be execution-ready, funding-required, cash-evidence-incomplete or not-evaluated.",
      "If funding-required, read First funding need / First modeled cash gap, its period, Peak additional funding / Peak scenario capital exposure and peak period.",
      "Read Baseline reserve funding need to distinguish an underlying reserve shortfall from incremental exposure created by the proposed optimized procurement.",
      "Read Funding evidence basis. commercially-governed means supplier economics are supported by governed commercial evidence; provisional-test-or-benchmark means at least one approved lane still derives economics from test, benchmark or assumption evidence.",
      "Read Authoritative for funding decision. A provisional evidence basis must display no and the values are scenario exposure, not an authoritative fundraising requirement.",
      "If cash-evidence-incomplete, repair the cash horizon/evidence before accepting the run; VYNDI requires continuous governed cash periods for the analysis horizon.",
      "If funding-required with commercially governed evidence, treat the result as a conditional planning requirement and obtain real funding authority/evidence before any dependent business execution.",
    ],
    controls: [
      "Cash governance is required for optimizer acceptance; mathematical feasibility cannot override it.",
      "Payment lag by SKU affects when proposed procurement consumes cash.",
      "The governed liquidity reserve must be preserved across the evaluated horizon.",
      "When cash evidence is incomplete/invalid, acceptance remains blocked rather than inferring a safe result.",
      "Funding requirement reason is reserve-preserving liquidity gap; execution remains blocked until funding or another governed cash action is evidenced.",
    ],
    expected: [
      "execution-ready: mathematical and cash evidence support the planning proposal, subject to normal transaction approvals.",
      "funding-required: mathematically feasible but reserve-preserving liquidity is insufficient under current governed evidence.",
      "cash-evidence-incomplete: the system cannot responsibly classify execution because required cash evidence is missing/invalid.",
    ],
    warnings: [
      "Funding-required is not authority to raise or spend funds.",
      "Provisional scenario exposure must not be quoted externally as a company funding requirement.",
      "Do not hide a liquidity breach by editing assumptions without corresponding governed business evidence.",
    ],
  },
  {
    id: "16.12",
    chapter: "C",
    title: "Optimizer Rerun Rules — What to Refresh and When",
    purpose: "Prevent stale decisions by defining which upstream changes require a governed IBPE rerun, an advanced-packet refresh, a new HiGHS run or only an advisory scenario rerun.",
    controls: [
      "Run governed IBPE again when approved plan/demand, confirmed order revision, released Job Card requirement, released BOM/material mapping, inventory/receipts, governed procurement cost, finance/cash evidence or another IBPE source-truth input materially changes.",
      "Refresh the governed advanced-planning packet after a new governed IBPE run and whenever approved capacity, persisted routing or approved supplier-lane authority changes.",
      "Run HiGHS again after every packet refresh. Never carry a prior solver result forward to a newly frozen packet.",
      "After a source-code production deployment changes VYNDI_SOURCE_SHA, rerun the governed IBPE → refresh packet → HiGHS → Release Readiness sequence when exact release lineage is required to be GREEN.",
      "Scenario Studio changes do not require changing business truth. Rerun the scenario whenever a what-if lever changes; create a new governed operating decision only through the canonical source workflow.",
      "A UI-only read/print operation does not require a solver rerun unless the deployed-source lineage itself changed and release closure is being re-certified.",
    ],
    steps: [
      "Identify what changed and which canonical authority owns it.",
      "Correct/approve the source record first.",
      "If the change affects IBPE source truth, Run governed IBPE.",
      "If the change affects packet authority/source evidence, Refresh governed advanced-planning packet.",
      "Run governed HiGHS optimization.",
      "Review Outputs & Evidence and Assurance.",
      "Confirm Release Readiness and record exact packet/run/audit/source identifiers for controlled decisions.",
    ],
    warnings: [
      "Do not rerun merely until a preferred answer appears. Every rerun should correspond to changed governed evidence or an explicitly identified analytical scenario.",
      "Do not compare run values without checking whether their source SHA, parent IBPE run and packet IDs differ.",
    ],
  },
  {
    id: "16.13",
    chapter: "C",
    title: "VIBPE Co-Pilot — Optimization Questions and Navigation",
    purpose: "Use natural-language analysis to interrogate governed demand, materials, procurement, capacity, funding and scenario evidence while preserving transaction authority.",
    steps: [
      "Ask baseline questions such as: What is the current governed plan? or Summarize the latest governed IBPE condition.",
      "Ask planning-horizon questions such as: Plan the next 12 months or What changes over the next 6 months?",
      "Ask demand questions such as: Which months have committed demand above plan?",
      "Ask materials questions such as: Which SKU causes the current shortage? or Show ATP/MSL risk.",
      "Ask procurement questions such as: What should we buy and when? or Which supplier/lead-time evidence is blocking optimization?",
      "Ask capacity questions such as: Which work centre is constraining production? or What happens if capacity increases 20%?",
      "Ask funding questions such as: When does free liquidity breach reserve? or What is the governed funding-dependent period?",
      "Ask root-cause questions such as: Why did health fall? or What drives the M8 procurement spike?",
      "Ask scenario questions such as: What if demand rises 25%?, Reduce procurement cost by 10%, Delay receipts 2 months, or Add ₹50L funding in M6.",
      "Ask comparison/optimization questions such as: Compare that with baseline, Which option reduces funding need?, or Find the lowest-funding feasible direction.",
      "Use navigation requests such as: Take me to Procurement Planning or Open the Optimizer.",
      "For protected business updates, continue to use Preview interpretation → Authorise proposal → Apply governed adapter; conversation alone does not rewrite canonical records.",
    ],
    controls: [
      "Supported intent families include baseline, planning-horizon, scenario, comparison, optimisation, root-cause, demand, materials, procurement, capacity, funding, follow-up, navigation and assessment.",
      "Product-specific scenario references can target Longitude, Latitude or Altitude demand while preserving other product lines.",
      "Co-Pilot analysis should cite/derive from governed runtime evidence where available and must not silently overwrite approved BOM, inventory, cost, demand, supplier, finance or production authority.",
    ],
    warnings: [
      "Do not phrase a Co-Pilot recommendation as an approved transaction.",
      "When Co-Pilot identifies missing evidence, open the owning canonical workspace and resolve it there.",
    ],
  },
  {
    id: "16.14",
    chapter: "C",
    title: "VIBPE Cross-Repository Knowledge & Authority",
    route: "/command/knowledge",
    purpose: "Use VIBPE knowledge from Vāyú engineering, ADV VIBPE and current VYNDI OS while preserving the authority boundary of each source.",
    steps: [
      "Open Command → Knowledge and review Repository knowledge snapshots before relying on a cross-repository answer for an engineering, finance, governance or optimizer decision.",
      "Each repository record shows its authority class, domain, source repository, exact commit SHA and source path. Use Open source when you need to inspect the pinned evidence directly.",
      "For current bicycle engineering authority, VIBPE resolves the VEDM current configuration before older knowledge-pack wording. The pinned configuration declares VEDM-301 Rev 5.3.9 Candidate E-K75 as the controlling frame-geometry authority; Rev 5.4 FK75 remains preferred front-end development freeze and is not released.",
      "For finance/accounting knowledge, ADV records are development/reference knowledge unless the same control has been promoted into current VYNDI OS runtime authority.",
      "For ERP optimization, current VYNDI OS runtime and User Manual Rev 1.4 take precedence over older ADV snapshots. Build/refresh the governed IBPE packet, freeze the advanced-planning packet, clear preparation gates and execute HiGHS only through the explicit Optimizer control.",
      "When source repositories change materially, update the curated snapshot to the new reviewed commit before describing the new repository state as current inside Co-Pilot.",
    ],
    controls: [
      "Controlled repository reference — may represent authority inside the owning engineering/control repository, but importing the snapshot into VYNDI is read-only and does not create a new approval or transaction.",
      "Current operational — current VYNDI OS runtime/manual evidence and optimizer workflow.",
      "Development reference — useful ADV or engineering-method knowledge that cannot silently overwrite current VYNDI/ERP authority.",
      "Unresolved — evidence may inform investigation but cannot satisfy a release, transaction or master-data gate.",
      "Current snapshot baselines: VEDM 2f8cd66ecca7; ADV VIBPE 3ca30a789127; VYNDI OS d0cae69f7e7a. These identifiers are provenance, not a substitute for checking a newer reviewed source when the repository changes.",
    ],
    warnings: [
      "Do not treat a newer filename, date or development branch as authority unless the owning repository control record says so.",
      "Do not let a cross-repository answer overwrite ERP master data, accounting actuals, production transactions or an engineering release.",
      "Do not use stale repository snapshots after a material source change; refresh the snapshot and rerun the relevant VIBPE regression gate.",
    ],
  },
  {
    id: "17",
    chapter: "D",
    title: "Traceability & Controlled Print",
    purpose: "Reconstruct the controlled business and manufacturing chain from customer requirement through cash collection.",
    steps: [
      "Trace Customer → Sales Order → Revision → Configuration → BOM → Inventory Requirement → Procurement → PO → GRN → Inventory → Job Card → Material Issue → Traveller → Quality Release → Dispatch → Invoice → Collection.",
      "Open the lineage/traceability record and verify expected upstream and downstream links.",
      "Use the controlled Print action or save the controlled print view as PDF where an electronic record is required.",
    ],
    warnings: ["Do not use an uncontrolled screenshot where VYNDI provides a formal printable transaction record."],
  },
  {
    id: "18",
    chapter: "D",
    title: "Exceptions & Troubleshooting",
    purpose: "Resolve the root operating condition instead of hiding the exception.",
    steps: ["Identify → understand cause → assign owner → decide action → obtain authority → execute → capture evidence → verify."],
    controls: ["Typical exceptions: unsynchronised order, missing Job Card, shortage, MSL alert, supplier missing, PO pending approval, PO awaiting receipt, quarantine, open NCR, Quality release missing, dispatch blocked, uninvoiced shipment, outstanding receivable, liquidity below reserve."],
    warnings: ["Never delete an exception merely to make a dashboard appear clean."],
  },
  {
    id: "19",
    chapter: "D",
    title: "Golden Rules & Prohibited Actions",
    purpose: "Operating disciplines that preserve VYNDI as a governed source of business truth.",
    controls: [
      "Enter business truth once.",
      "Planning is not commitment.",
      "Recommendation is not approval.",
      "Draft PO is not supplier commitment.",
      "Physical receipt is not available inventory until controlled receipt is completed.",
      "Job Card approval is not Quality Release.",
      "Every physical unit should maintain genealogy.",
      "Every material movement should have lineage.",
      "Every significant decision should have evidence.",
      "Every exception should have an owner and disposition.",
      "Finance should follow controlled operating transactions.",
      "The system must reflect actual business reality.",
    ],
    warnings: ["Do not share credentials, bypass Receiving, release quarantine without evidence, use unauthorised substitutions, duplicate Job Cards to bypass reconciliation, dispatch without Quality evidence, or use admin access to bypass approval."],
  },
  {
    id: "20",
    chapter: "E",
    title: "Complete End-to-End Example",
    purpose: "Example of one customer order moving through the complete governed lifecycle.",
    steps: [
      "Commercial: create customer order.",
      "Configuration: select model/variant.",
      "Engineering: confirm released BOM.",
      "Inventory: determine material availability.",
      "Production: synchronise Job Card and approve authorised batch.",
      "Procurement: complete shortage drafts, approve and issue supplier commitments.",
      "Receiving: post controlled GRNs; accepted material becomes FIFO stock.",
      "Material Issue: reserve and issue to Production.",
      "Traveller: maintain serial genealogy.",
      "Production and Quality: complete build, inspections, NCR/CAPA and serialized release.",
      "Dispatch: post shipment.",
      "Finance: issue invoice and post bank-backed collection.",
      "Traceability: verify the entire lineage.",
    ],
  },
  {
    id: "21",
    chapter: "E",
    title: "Training & Screenshot Register",
    purpose: "Operator competency checklist and controlled illustration register for future manual revisions.",
    controls: [
      "Operator should demonstrate login, role awareness, workspace navigation, order search, Job Card search, shortage review, Master Inventory, PO draft completion, approval vs issuance, GRN, quarantine, FIFO, Traveller, Quality Release, dispatch lineage, invoice, collection, VIBPE workflow operation, ERP optimization architecture, Procurement Planning, Scenario Studio, Advanced Planning Authority, HiGHS execution, cash/funding interpretation, rerun rules, traceability and print.",
      "Controlled screenshot register S01–S17 covers Login, Command, Action Inbox, VIBPE, Demand & Orders, Inventory, Purchase, Receiving, Job Card, Material Requisition, Traveller, Quality, Operations lineage, Financial Cockpit, Receivables, Traceability/Print and Users & Roles.",
    ],
  },
  {
    id: "22",
    chapter: "E",
    title: "Controlled Document Maintenance",
    purpose: "Keep the manual synchronized with the controlled system rather than allowing documentation drift.",
    controls: ["Revise when navigation, page names, transaction buttons, approval flow, role permission, Job Card lifecycle, procurement, receiving, Quality release, dispatch, finance lineage, VIBPE, optimizer model/objective/constraint policy, Scenario Studio controls, cash-governance logic, traceability/printing, governance, repository ownership/name, production platform, database transport or deployment-lineage controls materially change."],
    notes: ["Final operator principle: What happened? Why? What proves it? What does it affect? What happens next? Who has authority? Was it completed? Can the chain be reconstructed?"],
  },
];

function ListBlock({ title, items, tone = "default" }: { title: string; items?: readonly string[]; tone?: "default" | "warn" | "note" | "expected" }) {
  if (!items?.length) return null;
  return (
    <section className={cn(
      "rounded-xl border p-4",
      tone === "warn"
        ? "border-warn/35 bg-warn/5"
        : tone === "note"
          ? "border-accent/30 bg-accent/5"
          : tone === "expected"
            ? "border-ok/30 bg-ok/5"
            : "border-border bg-bg/45",
    )}>
      <h3 className="text-xs font-bold uppercase tracking-[0.14em] text-subtle">{title}</h3>
      <ul className="mt-3 space-y-2 text-sm leading-6 text-muted">
        {items.map((item) => <li key={item} className="flex gap-2"><span className="mt-2 size-1.5 shrink-0 rounded-full bg-accent"/><span>{item}</span></li>)}
      </ul>
    </section>
  );
}

function SectionPage({ section }: { section: ManualSection }) {
  return (
    <article className="rounded-2xl border border-border bg-surface/60 p-5 shadow-sm md:p-8 print:border-0 print:bg-white print:text-black print:shadow-none">
      <div className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-accent">{section.id} · VYNDI-UM-001 · Rev 1.4</p>
          <h2 className="mt-2 font-display text-3xl text-fg md:text-4xl print:text-black">{section.title}</h2>
          {section.route ? <p className="mt-2 font-mono text-xs text-cyan-300 print:text-black">{section.route}</p> : null}
        </div>
        <span className="w-fit rounded-full border border-border px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted">Chapter {section.chapter}</span>
      </div>
      <p className="mt-6 max-w-4xl text-sm leading-7 text-muted print:text-black">{section.purpose}</p>
      <div className="mt-6 grid gap-4 xl:grid-cols-2">
        <ListBlock title="Procedure / sequence" items={section.steps} />
        <ListBlock title="Controls / reference" items={section.controls} />
        <ListBlock title="Expected result / next gate" items={section.expected} tone="expected" />
        <ListBlock title="Operator notes" items={section.notes} tone="note" />
        <ListBlock title="Warnings / governing rules" items={section.warnings} tone="warn" />
      </div>
    </article>
  );
}

function UserManual() {
  const [activeId, setActiveId] = useState("00");
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);

  const activeIndex = Math.max(SECTIONS.findIndex((section) => section.id === activeId), 0);
  const needle = query.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!needle) return SECTIONS;
    return SECTIONS.filter((section) => JSON.stringify(section).toLowerCase().includes(needle));
  }, [needle]);
  const visibleSections = showAll || needle ? matches : [SECTIONS[activeIndex]];

  function move(delta: number) {
    const next = Math.max(0, Math.min(SECTIONS.length - 1, activeIndex + delta));
    setShowAll(false);
    setQuery("");
    setActiveId(SECTIONS[next].id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <main className="space-y-5" data-user-manual="vyndi-um-001-rev-1-4">
      <header className="rounded-2xl border border-border bg-gradient-to-br from-surface via-bg-elevated to-bg p-5 md:p-7 print:border-0 print:bg-white print:text-black">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-green">Controlled dossier · VYNDI-UM-001</p>
            <h1 className="mt-2 font-display text-4xl text-accent md:text-5xl print:text-black">User & Operator Manual</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted print:text-black">Revision 1.4 · VYNDI Operating System · VIBPE Co-Pilot 2.0 · baseline 24 September 2026</p>
          </div>
          <div className="flex flex-wrap gap-2 print:hidden">
            <button type="button" onClick={() => { setQuery(""); setShowAll((value) => !value); }} className="rounded-lg border border-border px-3 py-2 text-xs font-semibold text-fg hover:border-accent">{showAll ? "Single section" : "Show all"}</button>
            <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-xs font-bold text-bg"><Printer className="size-4"/>Print dossier</button>
          </div>
        </div>
      </header>

      <div className="grid gap-5 xl:grid-cols-[310px_minmax(0,1fr)]">
        <aside className="space-y-3 xl:sticky xl:top-4 xl:self-start print:hidden">
          <label className="relative block">
            <span className="sr-only">Search user manual</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"/>
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search the manual…" className="control w-full pl-9" />
          </label>
          <nav className="max-h-[70vh] overflow-y-auto rounded-xl border border-border bg-surface/45 p-2" aria-label="User manual sections">
            {CHAPTERS.map((chapter) => {
              const chapterSections = SECTIONS.filter((section) => section.chapter === chapter.id).filter((section) => !needle || matches.includes(section));
              if (!chapterSections.length) return null;
              return (
                <details key={chapter.id} open className="border-b border-border/70 py-1 last:border-0">
                  <summary className="cursor-pointer list-none px-2 py-2 text-xs font-bold text-fg [&::-webkit-details-marker]:hidden"><span className="mr-2 font-mono text-accent">{chapter.id}</span>{chapter.title}</summary>
                  <div className="space-y-1 pb-2 pl-2">
                    {chapterSections.map((section) => (
                      <button key={section.id} type="button" onClick={() => { setQuery(""); setShowAll(false); setActiveId(section.id); window.scrollTo({ top: 0, behavior: "smooth" }); }} className={cn("grid w-full grid-cols-[42px_1fr] gap-2 rounded-lg px-2 py-2 text-left text-xs", activeId === section.id && !showAll && !needle ? "bg-bg text-fg" : "text-muted hover:bg-bg/70 hover:text-fg")}>
                        <span className="font-mono text-accent">{section.id}</span><span>{section.title}</span>
                      </button>
                    ))}
                  </div>
                </details>
              );
            })}
            {needle && !matches.length ? <p className="px-3 py-6 text-sm text-muted">No manual section matches “{query}”.</p> : null}
          </nav>
        </aside>

        <section className="min-w-0 space-y-5">
          {visibleSections.map((section) => <SectionPage key={section.id} section={section} />)}
          {!showAll && !needle ? (
            <div className="flex items-center justify-between gap-3 print:hidden">
              <button type="button" disabled={activeIndex === 0} onClick={() => move(-1)} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-muted disabled:opacity-35"><ChevronLeft className="size-4"/>Previous</button>
              <span className="text-xs text-subtle">{activeIndex + 1} / {SECTIONS.length}</span>
              <button type="button" disabled={activeIndex === SECTIONS.length - 1} onClick={() => move(1)} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-muted disabled:opacity-35">Next<ChevronRight className="size-4"/></button>
            </div>
          ) : null}
        </section>
      </div>

      <footer className="border-t border-border pt-4 text-center text-[10px] uppercase tracking-[0.14em] text-subtle print:text-black">VYNDI-UM-001 · Revision 1.4 · Controlled User & Operator Manual</footer>
    </main>
  );
}
