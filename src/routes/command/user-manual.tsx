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
    purpose: "Controlled operating manual for authorised VYNDI OS users. Document VYNDI-UM-001 · Revision 1.1 · baseline 16 September 2026 · VIBPE Co-Pilot 2.0.",
    controls: [
      "Classification: Controlled Internal Operating Document.",
      "Intended users: Management, Commercial, Operations, Engineering, QA, Finance, Compliance and Admin.",
      "Review trigger: material UI, workflow, approval, role, VIBPE or RBAC change.",
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
      "The verdict is derived from runtime, migration, packet lineage, persisted solver execution, cash governance, actor evidence and append-only audit evidence.",
    ],
    expected: [
      "GREEN: all configured VIBPE optimizer production-closure gates are evidenced.",
      "BLOCKED / non-GREEN: use the failing gate evidence as the remediation checklist and repeat the upstream governed sequence.",
    ],
    warnings: ["Do not describe the VIBPE optimizer as fully production-proven while any release-closure gate remains blocked."],
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
      "Operator should demonstrate login, role awareness, workspace navigation, order search, Job Card search, shortage review, Master Inventory, PO draft completion, approval vs issuance, GRN, quarantine, FIFO, Traveller, Quality Release, dispatch lineage, invoice, collection, VIBPE workflow operation, traceability and print.",
      "Controlled screenshot register S01–S17 covers Login, Command, Action Inbox, VIBPE, Demand & Orders, Inventory, Purchase, Receiving, Job Card, Material Requisition, Traveller, Quality, Operations lineage, Financial Cockpit, Receivables, Traceability/Print and Users & Roles.",
    ],
  },
  {
    id: "22",
    chapter: "E",
    title: "Controlled Document Maintenance",
    purpose: "Keep the manual synchronized with the controlled system rather than allowing documentation drift.",
    controls: ["Revise when navigation, page names, transaction buttons, approval flow, role permission, Job Card lifecycle, procurement, receiving, Quality release, dispatch, finance lineage, VIBPE, traceability/printing or governance materially changes."],
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
          <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-accent">{section.id} · VYNDI-UM-001 · Rev 1.1</p>
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
    <main className="space-y-5" data-user-manual="vyndi-um-001-rev-1-1">
      <header className="rounded-2xl border border-border bg-gradient-to-br from-surface via-bg-elevated to-bg p-5 md:p-7 print:border-0 print:bg-white print:text-black">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-green">Controlled dossier · VYNDI-UM-001</p>
            <h1 className="mt-2 font-display text-4xl text-accent md:text-5xl print:text-black">User & Operator Manual</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted print:text-black">Revision 1.1 · VYNDI Operating System · VIBPE Co-Pilot 2.0 · baseline 16 September 2026</p>
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

      <footer className="border-t border-border pt-4 text-center text-[10px] uppercase tracking-[0.14em] text-subtle print:text-black">VYNDI-UM-001 · Revision 1.1 · Controlled User & Operator Manual</footer>
    </main>
  );
}
