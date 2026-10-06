import type { Sql } from "@/lib/db";
import { compileVedmAuthorityGraph, createVedmR3aSeed } from "@/lib/vedm-authority-graph";
import { classifyVedmIssueDomain, deriveVedmRisk } from "@/lib/vyndi-risk-model";
import { buildProgramNetwork, type ProgramTaskInput } from "@/lib/program-planning-model";
import { buildReadinessAssessment } from "@/lib/readiness-model";
import { analyzeEngineeringImpact } from "@/lib/impact-propagation-model";
import { buildProgramForecast, type ForecastTask } from "@/lib/forecast-model";
import { buildDecisionIntelligenceFromSql } from "@/lib/decision-intelligence-data";
import { buildAssetMaintenanceIntelligence } from "@/lib/asset-maintenance-model";

type ActiveActionRow = {
  id: string;
  kind: string;
  title: string;
  status: string;
  owner: string | null;
  due_on: string | null;
};

type ExceptionRow = {
  exception_key: string;
  exception_type: string;
  severity: string;
  domain: string;
  entity_type: string;
  entity_id: string;
  gate_id: string | null;
};

type WorkflowOrderRow = {
  sales_order_id: string;
  variant_name: string;
  job_card_id: string;
  job_card_status: string;
  open_shortage_units: string | number;
  draft_po_count: string | number;
  committed_po_count: string | number;
  received_po_count: string | number;
  traveller_count: string | number;
  quality_release_count: string | number;
  shipment_count: string | number;
  invoice_count: string | number;
  collection_count: string | number;
};

type HealthRunRow = {
  approved_plan_revision: string | number;
  input_hash: string;
  business_health_score: string | number;
  expected_units: string | number;
  critical_count: string | number;
  high_count: string | number;
  medium_count: string | number;
  shortage_sku_months: string | number;
  minimum_liquidity: string | number;
  funding_need: string | number;
  first_breach: string | number | null;
  active_bom_skus: string | number;
  resolved_cost_skus: string | number;
  missing_cost_skus: string;
};

const n = (value: unknown) => Number(value ?? 0);
const clean = (value: unknown) => String(value ?? "").trim();

export function isTraceabilityExceptionQuestion(question: string) {
  const q = question.toLowerCase();
  return /\b(job\s*cards?|orders?|demand)\b/.test(q)
    && (/traceab|lineage|originat|trace.*back/.test(q)
      || /revision/.test(q) && /changed|stale|release/.test(q));
}

export function isGovernanceOperatingStatusQuestion(question: string) {
  const q = question.toLowerCase();
  const asksControlTower = /control\s+tower/.test(q)
    && /blocker|blocked|owner|workspace|next action|status|cross-functional/.test(q);
  const asksControlState = /open\s+actions?|exceptions?|blocked\s+gates?|overdue|incomplete\s+workflows?|workflows?\s+are\s+incomplete|blocking\s+each|what\s+is\s+blocking/.test(q);
  return asksControlTower || (asksControlState && /action|exception|gate|overdue|workflow|block/.test(q));
}

export function isOverallRagHealthQuestion(question: string) {
  const q = question.toLowerCase();
  return /overall\s+health|current\s+health|health\s+of\s+vyndi|green.*amber.*red|red.*amber.*green|rag\s+(?:status|health)/.test(q);
}

export function isRiskIntelligenceQuestion(question: string) {
  const q = question.toLowerCase();
  return /risk\s+register|engineering\s+risk|evidence\s+risk|configuration\s+risk|fmea|rpn|highest\s+risk|top\s+risk|risk\s+exposure|why.*risk/.test(q);
}

export function isProgramPlanningQuestion(question: string) {
  const q = question.toLowerCase();
  return /critical\s+path|program\s+plan|programme\s+plan|gate\s+dependenc|blocked\s+task|work\s+package|what.*delay.*(?:program|programme|release)|what.*block.*(?:program|programme|release)/.test(q);
}

export function isReadinessIntelligenceQuestion(question: string) {
  const q = question.toLowerCase();
  return /product\s+readiness|program\s+readiness|programme\s+readiness|evidence\s+confidence|readiness\s+by\s+domain|\bvpri\b/.test(q);
}

export function isEngineeringPdmQuestion(question: string) {
  const q = question.toLowerCase();
  return /engineering\s+pdm|controlled\s+document|document\s+revision|document\s+checksum|sha-?256|document.*where[-\s]used|where[-\s]used.*document|configuration\s+manifest|released\s+manifest|superseded\s+document/.test(q);
}

export function isEngineeringChangeControlQuestion(question: string) {
  const q = question.toLowerCase();
  return /\beco\b|\becn\b|engineering\s+change\s+order|engineering\s+change\s+notice|change\s+effectivity|engineering.*where[-\s]used|where[-\s]used.*(?:engineering|bom|sku)|ecr.*(?:implementation|effectivity|eco|ecn)/.test(q);
}

export function isEngineeringImpactQuestion(question: string) {
  const q = question.toLowerCase();
  return /impact\s+analysis|downstream\s+impact|what\s+happens\s+if|what.*(?:affected|invalidated|stale)|which.*(?:evidence|gate).*affected/.test(q);
}

export function isProgramForecastQuestion(question: string) {
  const q = question.toLowerCase();
  return /schedule\s+forecast|program\s+forecast|programme\s+forecast|cost\s+forecast|\bp50\b|\bp80\b|\bp95\b/.test(q);
}

export function isForecastLearningQuestion(question: string) {
  const q = question.toLowerCase();
  return /forecast\s+(?:accuracy|learning|performance)|\bwape\b|forecast\s+bias|plan\s+attainment|forecast\s+attainment|forecast\s+value\s+added|\bfva\b/.test(q);
}

export function isEarnedValueQuestion(question: string) {
  const q = question.toLowerCase();
  return /earned\s+value|\bevm\b|cost\s+performance\s+index|schedule\s+performance\s+index|\bcpi\b|\bspi\b|planned\s+value|actual\s+cost|estimate\s+at\s+completion|\beac\b|\betc\b|\bvac\b|\btcpi\b/.test(q);
}

export function isEnterpriseDigitalThreadQuestion(question: string) {
  const q = question.toLowerCase();
  return /enterprise\s+digital\s+thread|digital\s+thread|full\s+lineage|cross[-\s]domain\s+trace|what\s+is\s+affected\s+if|which.*(?:serial|job|shipment|invoice|risk).*affected|trace.*(?:supplier|po|grn|material|serial|traveller|shipment|invoice)/.test(q);
}

export function isAssetMaintenanceQuestion(question: string) {
  const q = question.toLowerCase();
  return /asset\s+maintenance|equipment\s+maintenance|maintenance\s+work\s+orders?|preventive\s+maintenance|corrective\s+maintenance|overdue\s+maintenance|calibration\s+due|\bmtbf\b|\bmttr\b|equipment\s+availability|\boee\b/.test(q);
}

export function isEngineeringScenarioQuestion(question: string) {
  const q = question.toLowerCase();
  return /engineering\s+scenario|latest\s+engineering\s+scenario|scenario\s+(?:impact|delta).*engineering|engineering.*scenario\s+(?:impact|delta)/.test(q);
}

export function isMonteCarloQuestion(question: string) {
  const q = question.toLowerCase();
  return /monte\s+carlo|critical\s+path\s+frequency|probabilistic\s+schedule|schedule\s+uncertainty\s+simulation/.test(q);
}

export function isManufacturingQualityIntelligenceQuestion(question: string) {
  const q = question.toLowerCase();
  return /quality\s+forecast|defect\s+probab|yield\s+(?:forecast|estimate)|process\s+capability|\bcpk\b|\bcp\b|manufacturing\s+quality\s+intelligence/.test(q);
}

export function isSupplierPerformanceQuestion(question: string) {
  const q = question.toLowerCase();
  return /supplier\s+performance|supplier\s+scorecard|\botif\b|supplier\s+ppm|supplier\s+(?:ncr|capa)|supplier\s+responsiveness|supplier\s+traceability|supplier\s+cost\s+variance/.test(q);
}

export function isSupplierRiskIntelligenceQuestion(question: string) {
  const q = question.toLowerCase();
  return /supplier\s+risk|single[-\s]source|supplier\s+reliability|late[-\s]delivery\s+probab|lead[-\s]time\s+drift|incoming\s+supplier\s+quality/.test(q);
}

export function isDecisionIntelligenceQuestion(question: string) {
  const q = question.toLowerCase();
  return /decision\s+options?|safest\s+option|recovery\s+options?|what\s+should\s+we\s+do|best\s+risk[-\s]adjusted\s+path|recommended\s+path|decision\s+intelligence/.test(q);
}

async function traceabilityExceptionAnswer(sql: Sql) {
  const rows = await sql.query<Record<string, unknown>>(`
    select c.id as job_card_id,
           c.sales_order_id,
           c.sales_order_revision,
           c.status as job_card_status,
           c.product_label,
           o.id as matched_order_id,
           o.revision as matched_order_revision,
           o.status as order_status
      from epr_production_job_cards c
      left join vyndi_sales_orders o
        on o.id=c.sales_order_id
     order by c.created_at,c.id
  `);

  const incomplete = rows.filter((row) => !clean(row.sales_order_id) || !clean(row.matched_order_id)
    || n(row.sales_order_revision) !== n(row.matched_order_revision));
  if (!incomplete.length) {
    return [
      `Traceability exception check: PASS — 0 of ${rows.length} job cards lack their originating governed order link.`,
      "Every current job card resolves to its originating sales-order ID and sales-order revision, matching the current order revision. A later revision makes prior execution lineage stale: hold affected execution for controlled review, not automatic re-authorisation.",
      "Controlled next action: review originating confirmed demand/order lineage before execution. Scope: originating demand/order lineage only. Downstream Traveller, Quality, Dispatch, Invoice and Collection completion are evaluated separately as workflow progression."
    ].join("\n\n");
  }

  const details = incomplete.slice(0, 12).map((row) => {
    const reason = !clean(row.sales_order_id) ? "missing sales-order ID"
      : !clean(row.matched_order_id) ? `sales order ${clean(row.sales_order_id)} not found`
        : `stale revision R${n(row.sales_order_revision)}; current sales order is R${n(row.matched_order_revision)}`;
    return `${clean(row.job_card_id)} (${clean(row.product_label) || "product not labelled"}) — ${reason}`;
  });
  return [
    `Traceability exception check: FAIL — ${incomplete.length} of ${rows.length} job cards lack complete originating order lineage.`,
    details.join("; "),
    "Controlled next action: hold affected execution and review/correct the job-card → current sales-order ID/revision lineage before relying on downstream genealogy or audit evidence. VIBPE is advisory only; re-authorisation remains in the owning workspace."
  ].join("\n\n");
}

async function activeActions(sql: Sql) {
  return sql.query<ActiveActionRow>(`
    select action_id as id,'operating'::text as kind,action_id as title,status,owner,due_on
      from vyndi_operating_actions
     where status not in ('done','closed','cancelled')
    union all
    select id,'ibpe-management'::text as kind,title,status,owner,due_date as due_on
      from vyndi_ibpe_management_actions
     where status not in ('done','closed','cancelled')
     order by kind,id
  `);
}

async function assuranceExceptions(sql: Sql) {
  return sql.query<ExceptionRow>(`
    select exception_key,exception_type,severity,domain,entity_type,entity_id,gate_id
      from vyndi_vibpe_assurance_exceptions_all
     order by case severity when 'critical' then 0 when 'warning' then 1 when 'high' then 2 when 'medium' then 3 else 4 end,
              domain,exception_key
     limit 100
  `);
}

async function workflowOrders(sql: Sql) {
  return sql.query<WorkflowOrderRow>(`
    select o.id as sales_order_id,
           coalesce(o.variant_name,o.variant_id) as variant_name,
           c.id as job_card_id,
           c.status as job_card_status,
           coalesce(req.open_shortage_units,0) as open_shortage_units,
           coalesce(po.draft_po_count,0) as draft_po_count,
           coalesce(po.committed_po_count,0) as committed_po_count,
           coalesce(po.received_po_count,0) as received_po_count,
           coalesce(tr.traveller_count,0) as traveller_count,
           coalesce(qr.quality_release_count,0) as quality_release_count,
           coalesce(sh.shipment_count,0) as shipment_count,
           coalesce(inv.invoice_count,0) as invoice_count,
           coalesce(col.collection_count,0) as collection_count
      from vyndi_sales_orders o
      left join lateral (
        select * from epr_production_job_cards jc
         where jc.sales_order_id=o.id and jc.sales_order_revision=o.revision
         order by jc.updated_at desc,jc.created_at desc,jc.id desc limit 1
      ) c on true
      left join lateral (
        select coalesce(sum(r.shortage_quantity) filter (
                 where r.sku is not null and coalesce(r.issue_status,'') <> 'issued'
               ),0) as open_shortage_units
          from vyndi_live_job_card_requirements r
         where r.job_card_id=c.id
      ) req on true
      left join lateral (
        select count(*) filter (where p.status='draft') as draft_po_count,
               count(*) filter (where p.status in ('approved','issued','part_received')) as committed_po_count,
               count(*) filter (where p.status='received') as received_po_count
          from vyndi_purchase_orders p
         where p.job_card_id=c.id and p.status<>'cancelled'
      ) po on true
      left join lateral (
        select count(*) filter (where t.status<>'rejected') as traveller_count
          from epr_travellers t where t.job_card_id=c.id
      ) tr on true
      left join lateral (
        select count(*) filter (where q.superseded_at is null) as quality_release_count
          from vyndi_quality_releases q where q.job_card_id=c.id
      ) qr on true
      left join lateral (
        select count(*) filter (where s.status='posted') as shipment_count
          from vyndi_shipments s where s.sales_order_id=o.id
      ) sh on true
      left join lateral (
        select count(*) filter (where i.status='issued') as invoice_count
          from vyndi_invoices i where i.sales_order_id=o.id
      ) inv on true
      left join lateral (
        select count(*) filter (where c2.status='posted') as collection_count
          from vyndi_collections c2
          join vyndi_invoices i2 on i2.id=c2.invoice_id
         where i2.sales_order_id=o.id and i2.status='issued'
      ) col on true
     where o.status in ('confirmed','delivered')
     order by o.plan_month,o.id
  `);
}

function blockerForOrder(row: WorkflowOrderRow) {
  const shortage = n(row.open_shortage_units);
  const draftPos = n(row.draft_po_count);
  const committedPos = n(row.committed_po_count);
  if (!clean(row.job_card_id)) return "job card not created";
  if (shortage > 0) return `${shortage.toFixed(1)} material units short; ${draftPos} draft PO${draftPos === 1 ? "" : "s"}, ${committedPos} approved/issued/part-received PO${committedPos === 1 ? "" : "s"}`;
  if (n(row.traveller_count) === 0) return "material gate cleared but Traveller/build record not started";
  if (n(row.quality_release_count) === 0) return "Traveller exists but no current Quality Release";
  if (n(row.shipment_count) === 0) return "Quality released but no posted Dispatch/Shipment";
  if (n(row.invoice_count) === 0) return "Dispatch exists but no issued customer Invoice";
  if (n(row.collection_count) === 0) return "Invoice issued but no posted Collection";
  return "complete through collection";
}


function controlTowerOwner(row: WorkflowOrderRow) {
  const shortage = n(row.open_shortage_units);
  if (!clean(row.job_card_id)) {
    return {
      owner: "Production",
      workspace: "/command/production",
      action: "Create or synchronize the governed Job Card from the current confirmed sales-order revision.",
    };
  }
  if (shortage > 0) {
    return {
      owner: "Procurement",
      workspace: "/command/procurement-planning",
      action: "Resolve the exact committed material gap through governed stock, approved substitution or authorised supply.",
    };
  }
  if (n(row.traveller_count) === 0) {
    return {
      owner: "Production",
      workspace: "/command/production",
      action: "Start the governed Traveller/build record only after material readiness remains clear.",
    };
  }
  if (n(row.quality_release_count) === 0) {
    return {
      owner: "Quality",
      workspace: "/command/quality",
      action: "Complete inspection/NCR-CAPA disposition and post the governed Quality Release.",
    };
  }
  if (n(row.shipment_count) === 0) {
    return {
      owner: "Supply & Operations",
      workspace: "/command/operations",
      action: "Complete the governed dispatch/shipment step from released product evidence.",
    };
  }
  if (n(row.invoice_count) === 0) {
    return {
      owner: "Finance",
      workspace: "/command/sales-ledger",
      action: "Issue the governed customer invoice from the posted dispatch lineage.",
    };
  }
  if (n(row.collection_count) === 0) {
    return {
      owner: "Finance",
      workspace: "/command/receivables",
      action: "Post and reconcile collection against the issued customer invoice.",
    };
  }
  return {
    owner: "Command",
    workspace: "/command/control-tower",
    action: "No open order-thread blocker remains; continue monitoring the governed thread.",
  };
}

async function governanceOperatingStatusAnswer(sql: Sql, question = "") {
  const [actions, exceptions, orders, gateRows, p2pRows, peopleRows] = await Promise.all([
    activeActions(sql),
    assuranceExceptions(sql),
    workflowOrders(sql),
    sql.query<Record<string, unknown>>(`
      select
        (select count(*) from vyndi_vibpe_gate_registry where active) as registered_gates,
        (select count(distinct e.gate_id) from vyndi_vibpe_assurance_exceptions_all e where e.gate_id is not null) as exception_gates,
        (select count(*) from vyndi_report_production_release_gate) as production_gate_rows,
        (select count(*) from vyndi_report_production_release_gate where gate_status<>'RELEASED') as production_gate_blocked
    `),
    sql.query<Record<string, unknown>>(`
      select
        count(*) filter (where status='draft') as draft_po_count,
        count(*) filter (where status in ('approved','issued','part_received')) as committed_po_count,
        count(*) filter (where status='received') as received_po_count,
        (select count(*) from vyndi_supplier_invoices) as supplier_invoice_count,
        (select count(*) from vyndi_supplier_payments) as supplier_payment_count
      from vyndi_purchase_orders
      where status<>'cancelled'
    `),
    sql.query<Record<string, unknown>>(`
      select count(*) as total_items,
             count(*) filter (where lifecycle_status='draft') as draft_items,
             count(*) filter (where lifecycle_status<>'draft') as non_draft_items
        from vyndi_people_office_cost_items
    `),
  ]);

  const today = new Date().toISOString().slice(0, 10);
  const overdue = actions.filter((item) => item.due_on && item.due_on < today);
  const missingDue = actions.filter((item) => !item.due_on);
  const missingOwner = actions.filter((item) => !clean(item.owner));
  const gate = gateRows[0] ?? {};
  const p2p = p2pRows[0] ?? {};
  const people = peopleRows[0] ?? {};

  const totalShortage = orders.reduce((sum, row) => sum + n(row.open_shortage_units), 0);
  const orderBlockers = orders
    .filter((row) => blockerForOrder(row) !== "complete through collection")
    .map((row) => `${clean(row.variant_name)} (${clean(row.job_card_id) || clean(row.sales_order_id)}): ${blockerForOrder(row)}`);

  const controlTower = /control\s+tower/.test(question.toLowerCase());
  if (controlTower) {
    const blockers = orders
      .filter((row) => blockerForOrder(row) !== "complete through collection")
      .slice(0, 12)
      .map((row, index) => {
        const owner = controlTowerOwner(row);
        return `${index + 1}. ${clean(row.variant_name)} (${clean(row.job_card_id) || clean(row.sales_order_id)}): ${blockerForOrder(row)}. Owner / workspace: ${owner.owner} · ${owner.workspace}. Next action: ${owner.action}`;
      });

    const governanceBlocker = exceptions.length
      ? `Governance / workspace: Governance & Assurance · /command/governance. Next action: disposition ${exceptions.length} active assurance exception${exceptions.length === 1 ? "" : "s"} and clear the affected gate evidence.`
      : "";
    const actionHygiene = missingOwner.length || missingDue.length || overdue.length
      ? `Action Inbox / workspace: Command · /command/decision-inbox. Next action: resolve ${missingOwner.length} owner gap(s), ${missingDue.length} due-date gap(s) and ${overdue.length} overdue action(s).`
      : "";

    return [
      `CONTROL TOWER · ${blockers.length + (governanceBlocker ? 1 : 0) + (actionHygiene ? 1 : 0)} current governed blocker group(s).`,
      blockers.length ? `Control Tower blockers:\n${blockers.join("\n")}` : "Control Tower blockers: no incomplete confirmed/delivered order thread is currently represented.",
      governanceBlocker,
      actionHygiene,
      "Authority boundary: VIBPE identifies the owner and governed workspace; it does not execute, approve, release, issue, post or close the controlled action.",
    ].filter(Boolean).join("\n\n");
  }

  const lines = [
    `Governance operating status: ${actions.length} open action${actions.length === 1 ? "" : "s"}; ${exceptions.length} active VIBPE assurance exception${exceptions.length === 1 ? "" : "s"}; ${n(gate.exception_gates)} registered gate${n(gate.exception_gates) === 1 ? "" : "s"} blocked by assurance exceptions; ${n(gate.production_gate_blocked)} production-release gate row${n(gate.production_gate_blocked) === 1 ? "" : "s"} blocked.`,
    `Action hygiene: ${overdue.length} recorded overdue; ${missingDue.length} open action${missingDue.length === 1 ? "" : "s"} have no due date; ${missingOwner.length} have no owner. Open actions: ${actions.length ? actions.map((item) => `${item.id} [${item.kind}/${item.status}]${item.owner ? ` owner ${item.owner}` : " owner missing"}${item.due_on ? ` due ${item.due_on}` : " due date missing"}`).join("; ") : "none"}.`,
  ];

  if (exceptions.length) {
    lines.push(`Active assurance exceptions: ${exceptions.slice(0, 8).map((item) => `${item.severity} ${item.domain} — ${item.exception_type} (${item.entity_type}:${item.entity_id}${item.gate_id ? `, gate ${item.gate_id}` : ""})`).join("; ")}.`);
  } else {
    lines.push(`Assurance gates: ${n(gate.registered_gates)} active gates are registered and no current assurance exception is attached to a gate. Production-release report rows are ${n(gate.production_gate_rows) - n(gate.production_gate_blocked)}/${n(gate.production_gate_rows)} RELEASED.`);
  }

  lines.push(
    `Incomplete workflow — order-to-cash: ${orders.length} active confirmed/delivered order thread${orders.length === 1 ? "" : "s"}; current open material shortage ${totalShortage.toFixed(1)} units. ${orderBlockers.join(" | ")}.`,
    `Incomplete workflow — procure-to-pay: ${n(p2p.draft_po_count)} draft POs, ${n(p2p.committed_po_count)} approved/issued/part-received POs, ${n(p2p.received_po_count)} received POs, ${n(p2p.supplier_invoice_count)} supplier invoices and ${n(p2p.supplier_payment_count)} supplier payments. The immediate blocker is that draft replenishment has not become authorised supplier commitment.`,
  );

  if (n(people.draft_items) > 0) {
    lines.push(`Incomplete workflow — People & Office → Finance: ${n(people.draft_items)}/${n(people.total_items)} cost items remain draft, so they are not yet an approved finance feed.`);
  }

  lines.push("Evidence: live Action Inbox/operating-action state, VIBPE assurance exception/gate registries, production-release gates, canonical order/job-card/material/PO lineage, supplier invoice/payment ledgers and People & Office lifecycle state.");
  return lines.join("\n\n");
}

async function overallRagHealthAnswer(sql: Sql) {
  const [runs, traceRows, assuranceRows, actionRows, productionRows, executionRows, peopleRows] = await Promise.all([
    sql.query<HealthRunRow>(`
      select approved_plan_revision,input_hash,
             result_json->'summary'->>'businessHealthScore' as business_health_score,
             result_json->'summary'->>'expectedUnits' as expected_units,
             result_json->'summary'->'findingCounts'->>'critical' as critical_count,
             result_json->'summary'->'findingCounts'->>'high' as high_count,
             result_json->'summary'->'findingCounts'->>'medium' as medium_count,
             result_json->'summary'->>'fulfillmentShortageSkuMonths' as shortage_sku_months,
             result_json->'summary'->>'minimumFreeLiquidityAfterRecommendationsLakh' as minimum_liquidity,
             result_json->'funding'->>'incrementalFundingNeedLakh' as funding_need,
             result_json->'funding'->>'firstLiquidityBreachAfterRecommendationsPeriod' as first_breach,
             validation_json->>'activePlanningBomSkus' as active_bom_skus,
             validation_json->>'activePlanningBomResolvedCostSkus' as resolved_cost_skus,
             validation_json->>'missingControlledCostSkus' as missing_cost_skus
        from vyndi_ibpe_runs
       where status='complete'
       order by created_at desc limit 1
    `),
    sql.query<Record<string, unknown>>(`
      select count(*) as total_job_cards,
             count(*) filter (where o.id is null) as broken_origin_links
        from epr_production_job_cards c
        left join vyndi_sales_orders o on o.id=c.sales_order_id and o.revision=c.sales_order_revision
    `),
    sql.query<Record<string, unknown>>(`select count(*) as exception_count,count(distinct gate_id) filter (where gate_id is not null) as blocked_gate_count from vyndi_vibpe_assurance_exceptions_all`),
    sql.query<Record<string, unknown>>(`
      select count(*) as active_actions,
             count(*) filter (where due_on is null) as missing_due,
             count(*) filter (where owner is null or btrim(owner)='') as missing_owner
        from vyndi_operating_actions
       where status not in ('done','closed','cancelled')
    `),
    sql.query<Record<string, unknown>>(`select count(*) as gate_rows,count(*) filter (where gate_status='RELEASED') as released_rows from vyndi_report_production_release_gate`),
    sql.query<Record<string, unknown>>(`
      select
        (select coalesce(sum(shortage_quantity),0) from vyndi_live_job_card_requirements where sku is not null and coalesce(issue_status,'')<>'issued') as current_shortage_units,
        (select count(*) from vyndi_purchase_orders where status='draft') as draft_po_count,
        (select count(*) from vyndi_purchase_orders where status in ('approved','issued','part_received')) as committed_po_count,
        (select count(*) from vyndi_quality_releases where superseded_at is null) as quality_releases,
        (select count(*) from vyndi_shipments where status='posted') as shipments,
        (select count(*) from vyndi_invoices where status='issued') as invoices,
        (select count(*) from vyndi_collections where status='posted') as collections,
        (select count(*) from (
          with jc as (
            select sku,
                   sum(case when coalesce(issue_status,'') <> 'issued' then required_quantity else 0 end)::numeric as open_required,
                   sum(case when coalesce(issue_status,'') <> 'issued' then reserved_quantity else 0 end)::numeric as open_reserved,
                   sum(case when coalesce(issue_status,'') <> 'issued' then shortage_quantity else 0 end)::numeric as open_shortage
              from vyndi_live_job_card_requirements
             where sku is not null
             group by sku
          ), pr as (
            select sku,
                   sum(committed_requirement)::numeric as committed_requirement,
                   sum(reserved_quantity)::numeric as procurement_reserved,
                   sum(net_committed_shortage)::numeric as net_committed_shortage
              from vyndi_committed_procurement_requirements
             group by sku
          ), rn as (
            select sku,committed_reserved_qty from vyndi_report_procurement_net_requirement
          )
          select coalesce(jc.sku,pr.sku,rn.sku) as sku
            from jc
            full join pr on pr.sku=jc.sku
            full join rn on rn.sku=coalesce(jc.sku,pr.sku)
           where abs(coalesce(jc.open_required,0)-coalesce(pr.committed_requirement,0))>0.0001
              or abs(coalesce(jc.open_reserved,0)-coalesce(pr.procurement_reserved,0))>0.0001
              or abs(coalesce(jc.open_reserved,0)-coalesce(rn.committed_reserved_qty,0))>0.0001
              or abs(coalesce(jc.open_shortage,0)-coalesce(pr.net_committed_shortage,0))>0.0001
        ) reconciliation_mismatches) as reconciliation_mismatch_skus
    `),
    sql.query<Record<string, unknown>>(`select count(*) as total_items,count(*) filter (where lifecycle_status='draft') as draft_items from vyndi_people_office_cost_items`),
  ]);

  const run = runs[0];
  if (!run) return "Overall health is unavailable because no completed governed IBPE run exists.";
  const trace = traceRows[0] ?? {};
  const assurance = assuranceRows[0] ?? {};
  const actions = actionRows[0] ?? {};
  const production = productionRows[0] ?? {};
  const execution = executionRows[0] ?? {};
  const people = peopleRows[0] ?? {};
  const missingCosts = clean(run.missing_cost_skus).split(",").filter(Boolean).length;
  const reconciliationMismatchSkus = n(execution.reconciliation_mismatch_skus);

  const overall = n(run.critical_count) > 0 || n(run.minimum_liquidity) < 0 || n(execution.current_shortage_units) > 0 || reconciliationMismatchSkus > 0
    ? "RED"
    : n(run.high_count) > 0 ? "AMBER" : "GREEN";

  const green = [
    `${n(trace.total_job_cards) - n(trace.broken_origin_links)}/${n(trace.total_job_cards)} job cards resolve to their exact originating order revision`,
    `VIBPE assurance has ${n(assurance.exception_count)} active exceptions and ${n(assurance.blocked_gate_count)} exception-blocked registered gates`,
    `production-release rows are ${n(production.released_rows)}/${n(production.gate_rows)} RELEASED`,
  ];
  if (reconciliationMismatchSkus === 0) green.push("inventory reservation / committed procurement / open production-material demand reconciliation has 0 SKU mismatches");

  const red = [
    `minimum free liquidity after recommendations is ₹${n(run.minimum_liquidity).toFixed(3)}L`,
    `incremental funding need is ₹${n(run.funding_need).toFixed(3)}L with first breach ${run.first_breach ? `M${n(run.first_breach)}` : "not present"}`,
    `current open job-card material shortage is ${n(execution.current_shortage_units).toFixed(1)} units and the 36-month IBPE horizon carries ${n(run.shortage_sku_months)} shortage SKU-months`,
    `procurement cost authority covers ${n(run.resolved_cost_skus)}/${n(run.active_bom_skus)} active planning-BOM SKUs, with ${missingCosts} planned/exact committed cost exceptions in scope`,
  ];
  if (reconciliationMismatchSkus > 0) red.push(`operational demand/reservation/procurement reconciliation has ${reconciliationMismatchSkus} SKU mismatch${reconciliationMismatchSkus === 1 ? "" : "es"}`);

  return [
    `Current overall VYNDI health: ${overall}. Governed IBPE R${n(run.approved_plan_revision)} is ${n(run.business_health_score).toFixed(0)}/100 across ${n(run.expected_units).toFixed(0)} expected units.`,
    `GREEN — verified controls: ${green.join("; ")}.`,
    `AMBER — execution/governance hygiene: ${n(actions.active_actions)} operating actions remain in progress; ${n(actions.missing_due)} lack due dates and ${n(actions.missing_owner)} lack owners. ${n(execution.draft_po_count)} POs remain draft with ${n(execution.committed_po_count)} approved/issued/part-received. ${n(people.draft_items)}/${n(people.total_items)} People & Office cost items remain draft. Downstream Quality/Dispatch/Invoice/Collection counts are ${n(execution.quality_releases)}/${n(execution.shipments)}/${n(execution.invoices)}/${n(execution.collections)}.`,
    `RED — current blockers: ${red.join("; ")}.`,
    `Finding load: ${n(run.critical_count)} critical, ${n(run.high_count)} high and ${n(run.medium_count)} medium. Current high-level root causes are funding/liquidity, committed-supply coverage, procurement timing/cost authority and demand-vs-plan variance.`,
    `Evidence: governed IBPE input ${run.input_hash.slice(0, 8)} plus live action, assurance, traceability, production-release, material, procurement and downstream transaction ledgers.`
  ].join("\n\n");
}

async function programPlanningAnswer(sql: Sql) {
  const tasks = await sql.query<Record<string, unknown>>(`
    select id,title,domain,work_package,owner,status,duration_days,planned_start,planned_finish,
           actual_start,actual_finish,gate_id,required_evidence,risk_ids,confidence,
           technical_maturity,source_reference
      from vyndi_program_tasks
     where program_id='VYNDI-MASTER-PROGRAM'
     order by id
  `);
  const dependencies = await sql.query<Record<string, unknown>>(`
    select predecessor_id,successor_id,lag_days
      from vyndi_program_dependencies
     where program_id='VYNDI-MASTER-PROGRAM'
     order by predecessor_id,successor_id
  `);
  if (!tasks.length) {
    return "Program planning is enabled, but no governed program tasks have been entered yet. Add explicit tasks, durations and dependencies in Integrated Operating Plan before VIBPE calculates a critical path.";
  }

  const network = buildProgramNetwork(
    tasks.map((row) => ({
      id: clean(row.id),
      title: clean(row.title),
      durationDays: n(row.duration_days),
      status: clean(row.status) as ProgramTaskInput["status"],
    })),
    dependencies.map((row) => ({
      predecessorId: clean(row.predecessor_id),
      successorId: clean(row.successor_id),
      lagDays: n(row.lag_days),
    })),
  );

  if (!network.valid) {
    return `Program network is not authoritative because its dependency graph is invalid: ${network.issues.map((issue) => issue.message).join(" ")}`;
  }

  const critical = network.criticalPath.map((id) => {
    const row = tasks.find((task) => clean(task.id) === id);
    const schedule = network.taskById[id];
    return `${id} ${clean(row?.title)} [${clean(row?.status)}] — ${n(row?.duration_days)}d, slack ${schedule?.slackDays ?? 0}d`;
  });
  const blocked = tasks
    .filter((row) => clean(row.status) === "blocked")
    .map((row) => `${clean(row.id)} ${clean(row.title)}${clean(row.gate_id) ? ` (gate ${clean(row.gate_id)})` : ""}`);
  const unowned = tasks.filter((row) => !clean(row.owner)).map((row) => clean(row.id));
  const evidenceGates = tasks
    .filter((row) => clean(row.gate_id))
    .map((row) => `${clean(row.id)} → ${clean(row.gate_id)} [${clean(row.status)}]`);

  return [
    `Governed program network: ${tasks.length} tasks, ${dependencies.length} dependencies, deterministic critical duration ${network.projectDurationDays ?? 0} days.`,
    `Critical path: ${critical.length ? critical.join(" → ") : "none"}.`,
    `Blocked tasks: ${blocked.length ? blocked.join("; ") : "none"}.`,
    `Evidence gates: ${evidenceGates.length ? evidenceGates.join("; ") : "none linked"}.`,
    `Ownership gaps: ${unowned.length ? unowned.join(", ") : "none"}.`,
    "Control rule: this is deterministic CPM from explicit persisted durations and dependencies. VIBPE does not infer P50/P80/P95 dates here; probabilistic forecasting requires the later governed Forecast Engine."
  ].join("\n\n");
}

async function supplierPerformanceAnswer(sql: Sql) {
  const rows=await sql.query<Record<string,unknown>>(
    `select id,result_json,source_reference,created_at
       from vyndi_supplier_performance_runs
      order by created_at desc,id desc limit 1`,
  );
  const row=rows[0];
  if(!row){
    return "No governed Supplier Performance snapshot has been captured. Use Procurement → Supplier Performance & Quality Scorecard to review canonical PO/GRN/QMS/invoice/response evidence and capture a scorecard snapshot before VIBPE reports supplier performance.";
  }
  const result=row.result_json as {
    summary:{
      supplierCount:number;suppliersWithOtifEvidence:number;suppliersWithQualityEvidence:number;
      suppliersWithCostEvidence:number;suppliersWithTraceabilityEvidence:number;suppliersWithResponseEvidence:number;
      openNcrCount:number;openCapaCount:number;overdueCapaCount:number;
    };
    suppliers:Array<{
      supplierId:string;supplierName:string;completedOrderCount:number;otifPct:number|null;rejectPpm:number|null;
      acceptanceYieldPct:number|null;openNcrCount:number;openCapaCount:number;overdueCapaCount:number;
      capaEffectivenessEvidencePct:number|null;costVariancePct:number|null;traceabilityCompletenessPct:number|null;
      meanResponseHours:number|null;medianResponseHours:number|null;evidenceCoveragePct:number;attention:string[];
    }>;
  };
  const top=result.suppliers.slice(0,8).map((item)=>
    `${item.supplierName} (${item.supplierId}) — OTIF ${item.otifPct==null?"WITHHELD":item.otifPct+"%"}; PPM ${item.rejectPpm==null?"WITHHELD":Math.round(item.rejectPpm)}; yield ${item.acceptanceYieldPct==null?"WITHHELD":item.acceptanceYieldPct+"%"}; open NCR/CAPA ${item.openNcrCount}/${item.openCapaCount}; cost variance ${item.costVariancePct==null?"WITHHELD":item.costVariancePct+"%"}; traceability ${item.traceabilityCompletenessPct==null?"WITHHELD":item.traceabilityCompletenessPct+"%"}; mean response ${item.meanResponseHours==null?"WITHHELD":item.meanResponseHours+"h"}; evidence ${item.evidenceCoveragePct}%.`
  );
  return [
    `Latest governed Supplier Performance scorecard: ${clean(row.id)} · ${result.summary.supplierCount} active supplier(s).`,
    `Evidence coverage by dimension: OTIF ${result.summary.suppliersWithOtifEvidence}; incoming quality ${result.summary.suppliersWithQualityEvidence}; invoice cost ${result.summary.suppliersWithCostEvidence}; traceability ${result.summary.suppliersWithTraceabilityEvidence}; responsiveness ${result.summary.suppliersWithResponseEvidence}.`,
    `Corrective-action burden: ${result.summary.openNcrCount} open supplier-linked NCR; ${result.summary.openCapaCount} open CAPA; ${result.summary.overdueCapaCount} overdue CAPA.`,
    top.length?`Supplier detail: ${top.join(" | ")}`:"No active supplier performance rows are represented.",
    `Evidence: ${clean(row.source_reference)} · captured ${clean(row.created_at)}.`,
    "Boundary: VYNDI does not collapse these dimensions into an invented weighted supplier score. Supplier Risk remains a separate probabilistic/lane-risk authority; this scorecard reports observed supplier-level operating performance."
  ].join("\n\n");
}

async function supplierRiskIntelligenceAnswer(sql: Sql) {
  const rows=await sql.query<Record<string,unknown>>(
    `select id,result_json,source_reference,created_at
       from vyndi_supplier_risk_runs
      order by created_at desc,id desc limit 1`,
  );
  const row=rows[0];
  if(!row){
    return "No governed Supplier Risk snapshot has been captured. Use Procurement → Supplier Risk Intelligence to review approved lane authority plus actual PO/GRN evidence and capture a snapshot before VIBPE reports supplier-risk forecasting.";
  }
  const result=row.result_json as {
    summary:{
      activeApprovedLaneRevisions:number;coveredSkus:number;singleSourceSkuCount:number;singleSourceSkus:string[];
      deliveryForecastRatedLanes:number;incomingQualityRatedLanes:number;actualLeadTimeRatedLanes:number;
    };
    laneRisks:Array<{
      supplierId:string;sku:string;alternateRank:number;currency:string;completedDeliveryEvents:number;
      risk:{
        singleSource:boolean;approvedLaneCount:number;governedReliabilityPct:number|null;qualityRating:number|null;deliveryRating:number|null;
        deliveryForecast:{available:boolean;expectedLatePct:number|null;lower90Pct:number|null;upper90Pct:number|null;eventCount:number;reason:string};
        actualLeadTime:{available:boolean;meanDays:number|null;p80Days:number|null;meanDriftDays:number|null;reason:string};
        incomingQuality:{available:boolean;expectedDefectPct:number|null;lower90Pct:number|null;upper90Pct:number|null;sampleSize:number;reason:string};
      };
    }>;
  };
  const top=result.laneRisks.slice(0,6).map((item)=>{
    const source=item.risk.singleSource?"SINGLE SOURCE":`${item.risk.approvedLaneCount} approved sources`;
    const late=item.risk.deliveryForecast.available
      ? `late probability ${item.risk.deliveryForecast.expectedLatePct}%`
      : "late probability WITHHELD";
    const drift=item.risk.actualLeadTime.available
      ? `mean lead-time drift ${item.risk.actualLeadTime.meanDriftDays==null?"unrated":`${item.risk.actualLeadTime.meanDriftDays>=0?"+":""}${item.risk.actualLeadTime.meanDriftDays}d`}`
      : "lead-time drift WITHHELD";
    const reject=item.risk.incomingQuality.available
      ? `incoming reject probability ${item.risk.incomingQuality.expectedDefectPct}%`
      : "incoming quality probability WITHHELD";
    return `${item.sku} / ${item.supplierId} — ${source}; governed reliability ${item.risk.governedReliabilityPct??"unrated"}%; ${late}; ${drift}; ${reject}.`;
  });
  return [
    `Latest governed Supplier Risk: ${clean(row.id)} · ${result.summary.coveredSkus} covered SKU(s) · ${result.summary.activeApprovedLaneRevisions} current approved lane revision(s).`,
    `Single-source exposure: ${result.summary.singleSourceSkuCount} SKU(s)${result.summary.singleSourceSkus.length?` — ${result.summary.singleSourceSkus.join(", ")}`:""}. This is a configuration fact, not a probability.`,
    `Evidence coverage: delivery forecast rated on ${result.summary.deliveryForecastRatedLanes} lane(s); actual lead-time drift rated on ${result.summary.actualLeadTimeRatedLanes}; incoming quality rated on ${result.summary.incomingQualityRatedLanes}.`,
    top.length?`Highest current lane exposures: ${top.join(" | ")}`:"No current approved supplier lanes are represented.",
    `Evidence: ${clean(row.source_reference)} · captured ${clean(row.created_at)}.`,
    "Boundary: supplier ratings/reliability, empirical delivery, incoming rejection, alternate-source coverage and currency remain separate evidence dimensions. Geographic/geopolitical risk is not inferred without controlled evidence."
  ].join("\n\n");
}

async function manufacturingQualityIntelligenceAnswer(sql: Sql) {
  const rows=await sql.query<Record<string,unknown>>(
    `select id,result_json,source_reference,created_at
       from vyndi_quality_intelligence_runs
      order by created_at desc,id desc limit 1`,
  );
  const row=rows[0];
  if(!row){
    return "No governed Quality Intelligence snapshot has been captured. Use Quality → Manufacturing & Quality Intelligence to review canonical inspection evidence and capture a snapshot before VIBPE reports defect/yield or Cp/Cpk intelligence.";
  }
  const result=row.result_json as {
    stageForecasts:Array<{
      stage:string;sampleSize:number;defectQuantity:number;
      forecast:{available:boolean;expectedDefectPct:number|null;lower90Pct:number|null;upper90Pct:number|null;expectedYieldPct:number|null;reason:string};
    }>;
    capabilities:Array<{
      characteristicCode:string;characteristicName:string;
      capability:{available:boolean;sampleSize:number;cp:number|null;cpk:number|null;reason:string};
    }>;
    qualityControl:{ncrOpen:number;ncrOpenCritical:number;ncrOpenMajor:number;capaOpen:number;releasedSerials:number;blockedSerials:number};
    manufacturingActuals:{completedJobs:number;completedQuantity:number;scrapInr:number;reworkInr:number;scrapReworkCostPct:number|null};
  };
  const final=result.stageForecasts.find((item)=>item.stage==="final");
  const capability=result.capabilities.filter((item)=>item.capability.available);
  const weakest=[...capability].sort((a,b)=>(a.capability.cpk??Infinity)-(b.capability.cpk??Infinity))[0];
  return [
    `Latest governed Quality Intelligence: ${clean(row.id)} · source ${clean(row.source_reference)}.`,
    final?.forecast.available
      ? `Final inspection predictive defect probability ${final.forecast.expectedDefectPct}% (90% interval ${final.forecast.lower90Pct}%–${final.forecast.upper90Pct}%); yield estimate ${final.forecast.expectedYieldPct}% from ${final.sampleSize} inspected unit(s).`
      : `Final inspection defect/yield forecast: WITHHELD — ${final?.forecast.reason??"no final inspection sample"}.`,
    weakest
      ? `Lowest rated capability: ${weakest.characteristicCode} · Cpk ${weakest.capability.cpk} · Cp ${weakest.capability.cp} · n=${weakest.capability.sampleSize}.`
      : "Process capability: WITHHELD — no characteristic currently has sufficient consistent measurement/specification evidence.",
    `Quality control: ${result.qualityControl.ncrOpen} open NCR (${result.qualityControl.ncrOpenCritical} critical, ${result.qualityControl.ncrOpenMajor} major); ${result.qualityControl.capaOpen} open CAPA; released/blocked serials ${result.qualityControl.releasedSerials}/${result.qualityControl.blockedSerials}.`,
    `Manufacturing actuals: ${result.manufacturingActuals.completedJobs} completed job(s), ${result.manufacturingActuals.completedQuantity} unit(s), observed scrap+rework cost ₹${(result.manufacturingActuals.scrapInr+result.manufacturingActuals.reworkInr).toFixed(0)}${result.manufacturingActuals.scrapReworkCostPct==null?"":` (${result.manufacturingActuals.scrapReworkCostPct}% of captured actual cost)`}.`,
    "Boundary: observed scrap/rework cost is not a future scrap-rate prediction. Defect/yield and Cp/Cpk are reported only from captured canonical evidence meeting their minimum evidence gates."
  ].join("\n\n");
}

async function monteCarloAnswer(sql: Sql) {
  const rows=await sql.query<Record<string,unknown>>(
    `select id,method,iterations,seed,result_json,source_reference,created_at
       from vyndi_monte_carlo_runs
      where program_id='VYNDI-MASTER-PROGRAM'
      order by created_at desc,id desc limit 1`,
  );
  const row=rows[0];
  if(!row){
    return "No governed Monte Carlo run has been captured yet. Complete schedule O/M/P inputs in Planning and capture a seeded Monte Carlo run before VIBPE reports probabilistic schedule evidence.";
  }
  const result=row.result_json as {
    schedule:{
      p50Days:number|null;p80Days:number|null;p95Days:number|null;
      criticalPathFrequency:Array<{path:string[];frequencyPct:number;count:number}>;
    };
    cost:{available:boolean;p50Lakh:number|null;p80Lakh:number|null;p95Lakh:number|null};
    limitations:string[];
  };
  const path=result.schedule.criticalPathFrequency[0];
  return [
    `Latest governed Monte Carlo: ${clean(row.id)} · ${n(row.iterations)} iterations · seed ${n(row.seed)} · ${clean(row.method)}.`,
    `Schedule: P50 ${result.schedule.p50Days??"WITHHELD"}d · P80 ${result.schedule.p80Days??"WITHHELD"}d · P95 ${result.schedule.p95Days??"WITHHELD"}d.`,
    `Dominant sampled critical path: ${path?`${path.path.join(" → ")} (${path.frequencyPct}%)`:"unavailable"}.`,
    `Cost: ${result.cost.available?`P50 ₹${result.cost.p50Lakh}L · P80 ₹${result.cost.p80Lakh}L · P95 ₹${result.cost.p95Lakh}L`:"WITHHELD"}.`,
    `Evidence: ${clean(row.source_reference)} · captured ${clean(row.created_at)}. This is a saved simulation, not a new run performed by chat.`,
    `Model assumptions and limitations: ${(result.limitations ?? []).join(" ") || "Not retained; review the captured simulation inputs before interpreting percentiles."}`,
    "Controlled next action: review optimistic/most-likely/pessimistic task inputs and dependencies in /command/planning; capture a new seeded run if the schedule has changed. Simulated percentiles are not observed delivery performance.",
    "Boundary: this Monte Carlo uses governed program task uncertainty and resamples the critical path. It is not a physical material/FEA/fatigue response model; those probabilities remain withheld until explicit governed response functions exist."
  ].join("\n\n");
}

async function engineeringScenarioAnswer(sql: Sql) {
  const rows=await sql.query<Record<string,unknown>>(
    `select id,scenario_name,source_node_id,target_task_id,source_commit,
            assumption_json,baseline_json,scenario_json,impact_json,
            linked_program_tasks,linked_risks,source_reference,created_at
       from vyndi_engineering_scenario_runs
      order by created_at desc,id desc limit 1`,
  );
  const row=rows[0];
  if(!row){
    return "No governed Engineering Scenario has been captured yet. Use Scenario Analysis → Engineering Scenario Engine to select a controlled source node and capture advisory scenario evidence.";
  }
  const baseline=row.baseline_json as ReturnType<typeof buildProgramForecast>;
  const scenario=row.scenario_json as ReturnType<typeof buildProgramForecast>;
  const impact=row.impact_json as ReturnType<typeof analyzeEngineeringImpact>;
  const scheduleDelta=
    baseline.schedule.available&&scenario.schedule.available&&
    baseline.schedule.p50Days!=null&&scenario.schedule.p50Days!=null
      ? Math.round((scenario.schedule.p50Days-baseline.schedule.p50Days)*10)/10
      : null;
  const costDelta=
    baseline.cost.available&&scenario.cost.available&&
    baseline.cost.p50Lakh!=null&&scenario.cost.p50Lakh!=null
      ? Math.round((scenario.cost.p50Lakh-baseline.cost.p50Lakh)*10)/10
      : null;
  const tasks=Array.isArray(row.linked_program_tasks)?row.linked_program_tasks as Record<string,unknown>[]:[];
  const risks=Array.isArray(row.linked_risks)?row.linked_risks as Record<string,unknown>[]:[];

  return [
    `Latest Engineering Scenario: ${clean(row.scenario_name)} — source node ${clean(row.source_node_id)}${clean(row.target_task_id)?`, target task ${clean(row.target_task_id)}`:""}.`,
    `Technical propagation: ${impact.affectedNodes.length} affected graph node(s), ${impact.evidenceSuspectCount} evidence item(s) suspect, ${impact.releaseGateReviewCount} release gate(s) requiring review.`,
    `Schedule P50 delta: ${scheduleDelta==null?"WITHHELD":`${scheduleDelta>=0?"+":""}${scheduleDelta} days`}. Cost P50 delta: ${costDelta==null?"WITHHELD":`${costDelta>=0?"+":""}₹${costDelta}L`}.`,
    `Linked program tasks: ${tasks.length?tasks.map((item)=>clean(item.id)).join(", "):"none"}. Linked active risks: ${risks.length?risks.map((item)=>clean(item.id)).join(", "):"none"}.`,
    `Evidence: ${clean(row.id)} · VEDM ${clean(row.source_commit).slice(0,8)} · source ${clean(row.source_reference)}.`,
    "Control rule: this is advisory scenario evidence. It does not mutate approved planning, engineering configuration, risk acceptance, budgets or transaction ledgers."
  ].join("\n\n");
}

async function programForecastAnswer(sql: Sql) {
  const latest=await sql.query<Record<string,unknown>>(
    `select id,method,result_json,source_reference,created_at
       from vyndi_program_forecast_runs
      where program_id='VYNDI-MASTER-PROGRAM'
      order by created_at desc,id desc limit 1`,
  );
  if(latest[0]){
    const result=latest[0].result_json as ReturnType<typeof buildProgramForecast>;
    const schedule=result.schedule.available
      ? `P50 ${result.schedule.p50Days}d · P80 ${result.schedule.p80Days}d · P95 ${result.schedule.p95Days}d; expected critical path ${result.schedule.criticalPath.join(" → ")}.`
      : `WITHHELD — schedule coverage ${result.schedule.coveragePct}% (${result.schedule.reason})`;
    const cost=result.cost.available
      ? `P50 ₹${result.cost.p50Lakh}L · P80 ₹${result.cost.p80Lakh}L · P95 ₹${result.cost.p95Lakh}L.`
      : `WITHHELD — cost coverage ${result.cost.coveragePct}% (${result.cost.reason})`;
    return [
      `Latest governed Program Forecast: ${clean(latest[0].id)} · ${clean(latest[0].method)} · source ${clean(latest[0].source_reference)}.`,
      `Schedule: ${schedule}`,
      `Cost: ${cost}`,
      "Method boundary: PERT-normal approximation only. Critical-path switching and task/cost correlation are not modeled; these quantiles are planning evidence, not promised dates or approved budgets. Monte Carlo remains a later governed engine."
    ].join("\n\n");
  }

  const [tasks,deps]=await Promise.all([
    sql.query<Record<string,unknown>>(
      `select id,optimistic_days,most_likely_days,pessimistic_days,cost_forecast_required,
              cost_optimistic_lakh,cost_most_likely_lakh,cost_pessimistic_lakh
         from vyndi_program_tasks where program_id='VYNDI-MASTER-PROGRAM' order by id`,
    ),
    sql.query<Record<string,unknown>>(
      `select predecessor_id,successor_id,lag_days
         from vyndi_program_dependencies where program_id='VYNDI-MASTER-PROGRAM'
         order by predecessor_id,successor_id`,
    ),
  ]);
  const live=buildProgramForecast({
    tasks:tasks.map((row)=>({
      id:clean(row.id),
      optimisticDays:row.optimistic_days==null?null:n(row.optimistic_days),
      mostLikelyDays:row.most_likely_days==null?null:n(row.most_likely_days),
      pessimisticDays:row.pessimistic_days==null?null:n(row.pessimistic_days),
      costForecastRequired:Boolean(row.cost_forecast_required),
      costOptimisticLakh:row.cost_optimistic_lakh==null?null:n(row.cost_optimistic_lakh),
      costMostLikelyLakh:row.cost_most_likely_lakh==null?null:n(row.cost_most_likely_lakh),
      costPessimisticLakh:row.cost_pessimistic_lakh==null?null:n(row.cost_pessimistic_lakh),
    })) as ForecastTask[],
    dependencies:deps.map((row)=>({
      predecessorId:clean(row.predecessor_id),
      successorId:clean(row.successor_id),
      lagDays:n(row.lag_days),
    })),
  });
  return `No governed Program Forecast run has been captured. Current input coverage is schedule ${live.schedule.coveragePct}% and cost ${live.cost.coveragePct}%. VIBPE withholds P50/P80/P95 until an authorised forecast snapshot is captured from Planning.`;
}

async function engineeringPdmAnswer(sql: Sql, question: string) {
  const { buildEngineeringPdmStateFromSql }=await import("@/lib/engineering-pdm-authority");
  const state=await buildEngineeringPdmStateFromSql(sql);
  const q=question.toLowerCase();
  const selected=state.revisions.find((row)=>
    q.includes(row.id.toLowerCase()) ||
    q.includes(row.documentNumber.toLowerCase()) ||
    q.includes(row.contentSha256.toLowerCase())
  );

  if(!selected){
    const released=state.revisions.filter((row)=>row.status==="released").slice(0,10);
    return [
      "Engineering PDM: "+state.summary.documentCount+" controlled document master(s), "+state.summary.revisionCount+" revision(s), "+state.summary.releasedRevisionCount+" current released revision(s), "+state.summary.supersededRevisionCount+" superseded revision(s), "+state.summary.manifestCount+" released configuration manifest(s).",
      released.length
        ? "Current released revisions: "+released.map((row)=>row.documentNumber+" "+row.revisionCode+" · SHA-256 "+row.contentSha256).join(" | ")
        : "No released controlled document revision exists yet.",
      state.manifests.length
        ? "Latest configuration manifest: "+state.manifests[0]!.id+" · baseline "+state.manifests[0]!.baselineId+" · "+state.manifests[0]!.documentCount+" document(s) · fingerprint "+state.manifests[0]!.configurationFingerprint+"."
        : "No released configuration manifest is frozen yet.",
      "Name a document number, revision ID or SHA-256 for exact lifecycle and where-used detail.",
      "Authority boundary: VYNDI governs document identity, revision, checksum and relationships; binary storage remains at the recorded source URI."
    ].join("\n\n");
  }

  const whereUsed=selected.whereUsed.length
    ? selected.whereUsed.map((item)=>item.relation+" · "+item.targetType+" · "+item.targetId).join(" | ")
    : "none represented";
  return [
    "Controlled document "+selected.documentNumber+" revision "+selected.revisionCode+" ["+selected.status+"] · revision ID "+selected.id+".",
    "SHA-256: "+selected.contentSha256+". File: "+selected.fileName+" · "+selected.mediaType+" · "+selected.fileSizeBytes+" bytes.",
    "Source URI: "+selected.sourceUri+". Evidence reference: "+selected.sourceRef+".",
    "Where-used: "+whereUsed+".",
    selected.supersedesRevisionId ? "Supersedes: "+selected.supersedesRevisionId+"." : "Supersedes: none represented.",
    selected.supersededByRevisionId ? "Superseded by: "+selected.supersededByRevisionId+"." : "Superseded by: none represented.",
    "Authority boundary: VIBPE is read-only. It does not approve/release a revision, alter SHA-256 evidence, change where-used links or freeze a configuration manifest."
  ].join("\n\n");
}

async function engineeringChangeControlAnswer(sql: Sql, question: string) {
  const { buildEngineeringChangeControlFromSql }=await import("@/lib/engineering-change-control-authority");
  const state=await buildEngineeringChangeControlFromSql(sql);
  const q=question.toLowerCase();
  const selected=state.changeOrders.find((eco)=>{
    if(q.includes(eco.id.toLowerCase())||q.includes(eco.ecrId.toLowerCase())) return true;
    if(eco.notice&&(q.includes(eco.notice.id.toLowerCase())||q.includes(eco.notice.noticeNumber.toLowerCase()))) return true;
    return eco.whereUsed.mappings.some((row)=>q.includes(clean(row.sku).toLowerCase()));
  });

  if(!selected){
    const open=state.changeOrders.filter((eco)=>!["released","rejected"].includes(eco.status)).slice(0,8);
    return [
      "PLM change control: "+state.summary.ecoCount+" ECO(s), "+state.summary.openEcoCount+" open, "+state.summary.releasedEcnCount+" released ECN(s), "+state.summary.effectivityRuleCount+" governed effectivity rule(s).",
      open.length
        ? "Open ECOs: "+open.map((eco)=>eco.id+" ["+eco.status+"] · "+eco.ecrId+" → "+eco.targetRevisionCode).join(" | ")
        : "No open ECO currently requires lifecycle action.",
      "Where-used evidence currently references "+state.summary.impactedJobCardCount+" distinct non-cancelled Job Card(s) across represented ECR affected SKUs.",
      "Name an ECO, ECN, ECR or affected SKU for exact effectivity, baseline comparison and where-used detail.",
      "Authority boundary: ECR owns the requested change; ECO owns implementation/effectivity; ECN is the immutable implementation release. Baseline and BOM release remain separate authorities."
    ].join("\n\n");
  }

  const effectivity=selected.effectivity.length
    ? selected.effectivity.map((rule)=>rule.type==="date"
        ? rule.type+" "+String(rule.effectiveFrom)+" → "+String(rule.effectiveTo??"open")
        : rule.type+" "+String(rule.valueFrom??"")+" → "+String(rule.valueTo??"exact")).join("; ")
    : "WITHHELD — no governed effectivity rule";
  const comparison=selected.comparison;
  const diff=comparison
    ? "Baseline comparison: "+comparison.changedFields.length+" field change(s); BOM added "+comparison.addedBomLines.length+", removed "+comparison.removedBomLines.length+", quantity/unit changed "+comparison.changedBomLines.length+"."
    : "Baseline comparison is unavailable because both source and target baseline evidence are not represented.";
  const whereUsed=selected.whereUsed;
  return [
    "Engineering change "+selected.id+" ["+selected.status+"] implements "+selected.ecrId+" for "+selected.familyCode+(selected.variantId?" / "+selected.variantId:"")+" → target revision "+selected.targetRevisionCode+".",
    "Effectivity: "+effectivity+".",
    diff,
    "Where-used: "+whereUsed.mappings.length+" BOM mapping reference(s), "+whereUsed.jobCards.length+" frozen/current Job Card mapping reference(s), "+whereUsed.purchaseOrders.length+" non-cancelled Purchase Order reference(s).",
    whereUsed.jobCards.length
      ? "Affected Job Cards: "+whereUsed.jobCards.slice(0,12).map((row)=>clean(row.job_card_id)+" ["+clean(row.job_card_status)+"] · "+clean(row.sku)+" · BOM "+(clean(row.bom_revision)||"unrecorded")).join(" | ")
      : "No non-cancelled Job Card currently consumes the ECR affected SKUs.",
    selected.notice
      ? "ECN: "+selected.notice.noticeNumber+" released "+selected.notice.releasedAt+" · evidence "+selected.notice.sourceReference+"."
      : "ECN: not released.",
    "Authority boundary: VIBPE reports governed PLM evidence only. It does not approve an ECO, change effectivity, release a baseline/BOM, or issue an ECN."
  ].join("\n\n");
}

async function engineeringImpactAnswer(sql: Sql, question: string) {
  const graph=compileVedmAuthorityGraph(createVedmR3aSeed(),new Date().toISOString().slice(0,10));
  const q=question.toLowerCase();
  const source=[...graph.nodeById.keys()]
    .sort((a,b)=>b.length-a.length)
    .find((id)=>q.includes(id.toLowerCase()));
  if(!source){
    return "Engineering impact analysis is available, but the question does not identify a controlled Engineering Graph node ID. Name the source node (for example a VEDM authority/evidence/object ID) or use Engineering → Impact Analysis to select it. VIBPE will not guess the changed configuration.";
  }
  const impact=analyzeEngineeringImpact(graph,source);
  if(!impact.valid) return impact.issues.join(" ");

  const impactedIds=new Set([source,...impact.affectedNodes.map((node)=>node.id)]);
  const [tasks,risks]=await Promise.all([
    sql.query<Record<string,unknown>>(
      `select id,title,status,required_inputs,required_evidence from vyndi_program_tasks
        where program_id='VYNDI-MASTER-PROGRAM' order by id`,
    ),
    sql.query<Record<string,unknown>>(
      `select id,risk,status,affected_objects,exposure_score from vyndi_risk_intelligence
        where status<>'closed' order by exposure_score desc nulls last,id`,
    ),
  ]);
  const arr=(value:unknown)=>Array.isArray(value)?value.map(String):[];
  const taskImpact=tasks.filter((row)=>[
    ...arr(row.required_inputs),...arr(row.required_evidence),
  ].some((id)=>impactedIds.has(id)));
  const riskImpact=risks.filter((row)=>arr(row.affected_objects).some((id)=>impactedIds.has(id)));

  return [
    `Engineering impact source: ${source} — ${impact.sourceNode?.title ?? "controlled node"}.`,
    `Graph propagation: ${impact.affectedNodes.length} downstream node(s); ${impact.engineeringObjectIds.length} engineering object(s) require review/refresh; ${impact.evidenceSuspectCount} evidence item(s) become suspect; ${impact.releaseGateReviewCount} release gate(s) require review.`,
    `Affected evidence: ${impact.evidenceIds.length?impact.evidenceIds.join(", "):"none represented"}.`,
    `Affected release gates: ${impact.releaseGateIds.length?impact.releaseGateIds.join(", "):"none represented"}.`,
    `Linked program tasks: ${taskImpact.length?taskImpact.map((row)=>`${clean(row.id)} [${clean(row.status)}]`).join(", "):"none"}.`,
    `Linked active risks: ${riskImpact.length?riskImpact.map((row)=>`${clean(row.id)} exposure ${row.exposure_score??"unrated"}/9`).join(", "):"none"}.`,
    "Control rule: this is advisory impact assessment only. It marks review obligations; it does not approve a change, supersede evidence, or release engineering authority."
  ].join("\n\n");
}

async function readinessIntelligenceAnswer(sql: Sql) {
  const [tasks, evidence, risks] = await Promise.all([
    sql.query<Record<string, unknown>>(
      `select id,domain,status from vyndi_program_tasks
        where program_id='VYNDI-MASTER-PROGRAM' order by id`,
    ),
    sql.query<Record<string, unknown>>(
      `select id,domain,evidence_state,confidence,required from vyndi_readiness_evidence
        where program_id='VYNDI-MASTER-PROGRAM' order by domain,id`,
    ),
    sql.query<Record<string, unknown>>(
      `select id,exposure_score,status from vyndi_risk_intelligence
        where status<>'closed' order by exposure_score desc,id`,
    ),
  ]);

  const graph = compileVedmAuthorityGraph(createVedmR3aSeed(), new Date().toISOString().slice(0,10));
  const requiredEvidenceIds = new Set(
    [...graph.nodeById.values()]
      .filter((node) => node.kind === "release_gate")
      .flatMap((node) => node.requiredEvidenceIds ?? []),
  );
  const vedmEvidence = [...graph.nodeById.values()]
    .filter((node) => node.kind === "evidence" && requiredEvidenceIds.has(node.id))
    .map((node) => ({
      id: node.id,
      domain: node.domain,
      state: node.evidenceState === "sufficient" ? "sufficient" as const
        : node.evidenceState === "not_applicable" ? "not_applicable" as const
          : "insufficient" as const,
      confidence: null,
      required: true,
    }));
  const configurationBlockers = graph.issues.filter(
    (issue) => classifyVedmIssueDomain(issue.code) === "configuration" && issue.severity !== "warning",
  ).length;

  const assessment = buildReadinessAssessment({
    tasks: tasks.map((row) => ({
      id: clean(row.id),
      domain: clean(row.domain) || "program",
      status: clean(row.status),
      readinessRequired: true,
    })),
    evidence: [
      ...evidence.map((row) => ({
        id: clean(row.id),
        domain: clean(row.domain),
        state: clean(row.evidence_state) as "sufficient"|"insufficient"|"unrated"|"not_applicable",
        confidence: row.confidence == null ? null : n(row.confidence),
        required: Boolean(row.required),
      })),
      ...vedmEvidence,
    ],
    activeRisks: risks.map((row) => ({
      id: clean(row.id),
      exposureScore: row.exposure_score == null ? null : n(row.exposure_score),
      status: clean(row.status),
    })),
    configurationBlockers,
  });

  const pct = (value: number | null) => value == null ? "unrated" : `${value.toFixed(1)}%`;
  const domains = Object.entries(assessment.domainReadiness)
    .map(([domain, item]) => `${domain} ${pct(item.readinessPct)} (${item.dispositionedTasks}/${item.requiredTasks})`);

  return [
    `Program readiness: ${pct(assessment.taskReadinessPct)} — ${assessment.dispositionedTaskCount}/${assessment.requiredTaskCount} governed tasks dispositioned.`,
    `Evidence completeness: ${pct(assessment.evidenceCompletenessPct)} — ${assessment.sufficientEvidenceCount}/${assessment.applicableEvidenceCount} required evidence items sufficient.`,
    `Evidence confidence: ${pct(assessment.evidenceConfidencePct)} with rated coverage ${pct(assessment.evidenceConfidenceCoveragePct)}. Missing confidence is left unrated, not inferred.`,
    `Risk: ${assessment.activeRiskCount} active canonical risks; highest governed exposure ${assessment.highestRiskExposureScore ?? "unrated"}/9; configuration blockers ${assessment.configurationBlockers}.`,
    `Domain readiness: ${domains.length ? domains.join("; ") : "no governed program tasks entered"}.`,
    `Composite VPRI: WITHHELD. ${assessment.overallReadinessReason}`,
  ].join("\n\n");
}

async function forecastLearningAnswer(sql: Sql) {
  const { buildForecastLearningFromSql }=await import("@/lib/forecast-learning-authority");
  const result=await buildForecastLearningFromSql(sql);
  const metric=(value:number|null)=>value==null?"WITHHELD":value.toFixed(2)+"%";
  if(!result.available){
    return [
      "Forecast Learning: WITHHELD.",
      result.reason,
      "Eligible closed periods: "+result.closedPeriods+" · product-period samples: "+result.samples+".",
      "VYNDI does not score hindsight forecasts: only immutable vintages captured before the target calendar period started can enter WAPE, bias, attainment or Forecast Value Added.",
      "Authority boundary: learning is advisory. It does not rewrite the approved operating plan, Commercial orders, Production, Procurement, Inventory or Finance actuals."
    ].join("\n\n");
  }
  return [
    "Forecast Learning from "+result.closedPeriods+" governed closed period(s): WAPE "+metric(result.wapePct)+" · bias "+metric(result.biasPct)+".",
    "Attainment: approved plan "+metric(result.planAttainmentPct)+" · governed forecast "+metric(result.forecastAttainmentPct)+".",
    "Forecast Value Added: "+result.fvaUnits.toFixed(2)+" unit-error improvement · "+metric(result.fvaPct)+". Positive FVA means the governed forecast reduced absolute error versus the approved-plan baseline.",
    "Volume evidence: plan "+result.planUnits.toFixed(2)+" · forecast "+result.forecastUnits.toFixed(2)+" · actual "+result.actualUnits.toFixed(2)+" units.",
    "Method boundary: WAPE uses actual units as denominator; positive bias means over-forecast. Only pre-period vintages and latest governed close revisions are eligible.",
    "Authority boundary: forecast learning is advisory and never auto-adjusts approved plans or transaction truth."
  ].join("\n\n");
}

async function enterpriseDigitalThreadAnswer(sql: Sql, question: string) {
  const { buildEnterpriseDigitalThreadFromSql }=await import("@/lib/enterprise-digital-thread-authority");
  const result=await buildEnterpriseDigitalThreadFromSql(sql,question);
  if(!result.matched){
    return "No governed enterprise digital-thread lineage matched that reference. Use a Serial, Traveller, Job Card, PO, GRN, supplier, shipment, invoice, equipment or other controlled identifier.";
  }
  const roots=result.rootNodeIds.length?result.rootNodeIds.join(", "):"job-card lineage";
  const affected=result.impact.affectedNodeIds.slice(0,20);
  const gapText=result.gaps.length?result.gaps.map((gap)=>gap.message).join(" "):"No represented graph gap was detected for the matched canonical records.";
  return [
    "Enterprise Digital Thread matched "+roots+".",
    "Coverage: "+result.summary.jobCards+" Job Card(s) · "+result.summary.travellers+" serial/Traveller(s) · "+result.summary.suppliers+" supplier(s) · "+result.summary.goodsReceipts+" GRN(s) · "+result.summary.qualityReleases+" Quality Release(s) · "+result.summary.shipments+" shipment(s) · "+result.summary.risks+" linked open risk(s).",
    "Affected downstream nodes from the matched root: "+(affected.length?affected.join(", "):"none represented")+".",
    "Governed gap: "+gapText,
    result.summary.serialShipmentExact
      ? "Serial → shipment identity: EXACT — every posted shipment in this matched lineage is backed by active serialized dispatch allocation evidence."
      : "Serial → shipment identity: INCOMPLETE/LEGACY — VYNDI does not infer missing serial identity from released quantity evidence.",
    "Authority boundary: this is read-only cross-domain lineage and impact evidence. It does not mutate Procurement, Inventory, Production, Quality, Finance, Risk or Engineering authority."
  ].join("\n\n");
}

async function assetMaintenanceAnswer(sql: Sql) {
  const [assets, workOrders, operatingRows] = await Promise.all([
    sql.query<Record<string, unknown>>(
      "select id,asset_tag,equipment_type,status,criticality,maintenance_due_at,calibration_required,calibration_due_at from epr_equipment order by asset_tag"
    ),
    sql.query<Record<string, unknown>>(
      "select id,equipment_id,work_order_type,status,started_at,completed_at,downtime_started_at,downtime_ended_at from vyndi_maintenance_work_orders order by opened_at desc,id desc"
    ),
    sql.query<{equipment_id:string;hours:number|string}>(
      "select equipment_id,coalesce(sum(extract(epoch from (completed_at-started_at))/3600.0),0) as hours from epr_operation_controls where equipment_id is not null and started_at is not null and completed_at is not null group by equipment_id order by equipment_id"
    ),
  ]);
  const result=buildAssetMaintenanceIntelligence({
    asOf:new Date().toISOString(),
    assets:assets.map((row)=>({
      id:clean(row.id),
      assetTag:clean(row.asset_tag),
      equipmentType:clean(row.equipment_type),
      status:clean(row.status) as "available"|"in_use"|"maintenance"|"quarantined"|"retired",
      criticality:(clean(row.criticality)||"medium") as "low"|"medium"|"high"|"critical",
      maintenanceDueAt:row.maintenance_due_at==null?null:clean(row.maintenance_due_at),
      calibrationRequired:Boolean(row.calibration_required),
      calibrationDueAt:row.calibration_due_at==null?null:clean(row.calibration_due_at),
    })),
    operatingHours:operatingRows.map((row)=>({equipmentId:row.equipment_id,hours:n(row.hours)})),
    workOrders:workOrders.map((row)=>({
      id:clean(row.id),
      equipmentId:clean(row.equipment_id),
      type:clean(row.work_order_type) as "preventive"|"corrective"|"inspection"|"calibration",
      status:clean(row.status) as "draft"|"scheduled"|"in_progress"|"completed"|"cancelled",
      startedAt:row.started_at==null?null:clean(row.started_at),
      completedAt:row.completed_at==null?null:clean(row.completed_at),
      downtimeStartedAt:row.downtime_started_at==null?null:clean(row.downtime_started_at),
      downtimeEndedAt:row.downtime_ended_at==null?null:clean(row.downtime_ended_at),
    })),
  });
  const metric=(value:number|null,suffix="")=>value==null?"WITHHELD":value.toFixed(1)+suffix;
  return [
    "Asset & Maintenance Intelligence: "+result.totalAssets+" active asset(s) · "+result.releaseBlockedAssetCount+" execution-blocked · "+result.openWorkOrderCount+" open maintenance work order(s).",
    "Reliability: MTBF "+metric(result.mtbfHours," h")+" · MTTR "+metric(result.mttrHours," h")+" · observed availability "+metric(result.observedAvailabilityPct,"%")+" · captured downtime "+result.downtimeHours.toFixed(1)+" h.",
    "Due controls: overdue maintenance "+(result.overdueMaintenanceAssetIds.join(", ")||"none")+" · overdue calibration "+(result.overdueCalibrationAssetIds.join(", ")||"none")+" · missing calibration due date "+(result.missingCalibrationDueAssetIds.join(", ")||"none")+".",
    "OEE WITHHELD. VYNDI does not publish OEE until governed planned-production-time, performance-loss and quality-loss evidence exist at the same production grain.",
    "Authority boundary: epr_equipment remains the canonical equipment identity. Maintenance intelligence does not bypass calibration, maintenance-due, equipment-status or return-to-service gates."
  ].join("\n\n");
}

async function earnedValueAnswer(sql: Sql) {
  const rows = await sql.query<Record<string, unknown>>(
    "select id,as_of_date::text,method,result_json,source_reference,created_at " +
    "from vyndi_earned_value_runs where program_id='VYNDI-MASTER-PROGRAM' " +
    "order by as_of_date desc,created_at desc,id desc limit 1"
  );
  const row = rows[0];
  if (!row) {
    return "No governed Earned Value snapshot has been captured. Open Integrated Operating Plan → Earned Value Intelligence, complete progress and actual-cost evidence, and capture an immutable EVM snapshot before VIBPE reports CPI/SPI or completion-cost forecasts.";
  }
  const result = (row.result_json ?? {}) as Record<string, unknown>;
  const show = (value: unknown, digits = 3) => value == null ? "WITHHELD" : n(value).toFixed(digits);
  const moneyValue = (value: unknown) => value == null ? "WITHHELD" : "₹" + n(value).toFixed(2) + "L";
  return [
    "Earned Value as of " + clean(row.as_of_date) + ": BAC " + moneyValue(result.bacLakh) + " · PV " + moneyValue(result.pvLakh) + " · EV " + moneyValue(result.evLakh) + " · AC " + moneyValue(result.acLakh) + ".",
    "Performance: SPI " + show(result.spi) + " · CPI " + show(result.cpi) + " · schedule variance " + moneyValue(result.svLakh) + " · cost variance " + moneyValue(result.cvLakh) + ".",
    "Completion outlook: EAC " + moneyValue(result.eacLakh) + " · ETC " + moneyValue(result.etcLakh) + " · VAC " + moneyValue(result.vacLakh) + " · TCPI(BAC) " + show(result.tcpiBac) + ".",
    "Evidence coverage: physical progress " + show(result.progressCoveragePct, 1) + "% · actual cost " + show(result.actualCostCoveragePct, 1) + "%. Source " + clean(row.source_reference) + " · run " + clean(row.id) + ".",
    "Authority boundary: Earned Value is advisory program-control evidence. EV is derived from governed task completion/progress; VIBPE does not approve budgets, payments, schedule changes, engineering release or transactions."
  ].join("\n\n");
}

async function decisionIntelligenceAnswer(sql: Sql) {
  const {result}=await buildDecisionIntelligenceFromSql(sql);
  const primary=result.options.find((option)=>option.id===result.primaryAdvisoryOptionId)??result.options[0];
  const lines=result.options.slice(0,6).map((option,index)=>[
    `Option ${index+1}: ${option.title} [${option.decisionClass}]`,
    `Why: ${option.rationale}`,
    `Actions: ${option.actions.join("; ")}`,
    `Consequences / limits: ${option.consequences.join("; ")}`,
    `Authority: ${option.authorityRequired}`,
    option.evidenceReferences.length?`Evidence: ${option.evidenceReferences.join("; ")}`:"Evidence: no additional captured reference required for this comparison option.",
  ].join("\n"));

  return [
    `VIBPE Decision Intelligence: ${result.options.length} advisory option(s). Primary advisory option: ${primary?.title??"none"}.`,
    ...lines,
    `Ranking method: ${result.rankingMethod}. This is governance-priority ordering, not an invented utility score.`,
    "Authority boundary: VIBPE does not approve, transact, release engineering, accept risk, commit funding, issue purchase orders or modify the governed baseline. A human owning authority must decide and execute any controlled action."
  ].join("\n\n");
}

async function riskIntelligenceAnswer(sql: Sql) {
  const risks = await sql.query<Record<string, unknown>>(`
    select id,risk,domain,likelihood,impact,status,mitigation,owner,due_on,
           exposure_score,fmea_rpn,severity,occurrence,detection,evidence_confidence,
           dependency_impact,affected_objects,evidence_links,provenance_class,source_reference
      from vyndi_risk_intelligence
     where status<>'closed'
     order by exposure_score desc nulls last,fmea_rpn desc nulls last,id
     limit 20
  `);
  const graph = compileVedmAuthorityGraph(createVedmR3aSeed(), new Date().toISOString().slice(0, 10));
  const derived = graph.issues.map(deriveVedmRisk);

  const canonical = risks.slice(0, 8).map((row) => {
    const confidence = row.evidence_confidence == null ? "unrated" : `${Math.round(Number(row.evidence_confidence) * 100)}%`;
    const rpn = row.fmea_rpn == null ? "FMEA not rated" : `RPN ${Number(row.fmea_rpn)}`;
    const affected = Array.isArray(row.affected_objects) && row.affected_objects.length
      ? ` affected ${row.affected_objects.map(String).join(", ")}`
      : "";
    return `${clean(row.id)} [${clean(row.domain) || "operational"}] ${clean(row.likelihood)}×${clean(row.impact)} exposure ${n(row.exposure_score)}; ${rpn}; evidence confidence ${confidence}; ${clean(row.risk)}.${affected}`;
  });

  const derivedLines = derived.slice(0, 8).map((risk) =>
    `${risk.id} [${risk.domain}] ${risk.impact} impact; probability not inferred; ${risk.message}`
  );

  return [
    `VYNDI Risk status: ${risks.length} active canonical risk${risks.length === 1 ? "" : "s"}; ${derived.length} current VEDM-derived evidence/configuration signal${derived.length === 1 ? "" : "s"}.`,
    canonical.length ? `Highest governed risks: ${canonical.join(" | ")}` : "No active canonical risks are recorded.",
    derivedLines.length ? `VEDM-derived signals: ${derivedLines.join(" | ")}` : "No current VEDM authority/evidence issue is derived.",
    "Control rule: likelihood/impact and FMEA inputs come only from governed entries. VYNDI does not invent probability; evidence confidence and provenance remain separate from risk exposure. Lifecycle acceptance/closure stays with authorised humans."
  ].join("\n\n");
}

export async function tryGovernanceDataAnswer(sql: Sql, question: string) {
  if (isTraceabilityExceptionQuestion(question)) return traceabilityExceptionAnswer(sql);
  if (isGovernanceOperatingStatusQuestion(question)) return governanceOperatingStatusAnswer(sql, question);
  if (isOverallRagHealthQuestion(question)) return overallRagHealthAnswer(sql);
  if (isForecastLearningQuestion(question)) return forecastLearningAnswer(sql);
  if (isEnterpriseDigitalThreadQuestion(question)) return enterpriseDigitalThreadAnswer(sql, question);
  if (isAssetMaintenanceQuestion(question)) return assetMaintenanceAnswer(sql);
  if (isEarnedValueQuestion(question)) return earnedValueAnswer(sql);
  if (isDecisionIntelligenceQuestion(question)) return decisionIntelligenceAnswer(sql);
  if (isSupplierPerformanceQuestion(question)) return supplierPerformanceAnswer(sql);
  if (isSupplierRiskIntelligenceQuestion(question)) return supplierRiskIntelligenceAnswer(sql);
  if (isRiskIntelligenceQuestion(question)) return riskIntelligenceAnswer(sql);
  if (isProgramPlanningQuestion(question)) return programPlanningAnswer(sql);
  if (isReadinessIntelligenceQuestion(question)) return readinessIntelligenceAnswer(sql);
  if (isEngineeringScenarioQuestion(question)) return engineeringScenarioAnswer(sql);
  if (isManufacturingQualityIntelligenceQuestion(question)) return manufacturingQualityIntelligenceAnswer(sql);
  if (isMonteCarloQuestion(question)) return monteCarloAnswer(sql);
  if (isEngineeringPdmQuestion(question)) return engineeringPdmAnswer(sql, question);
  if (isEngineeringChangeControlQuestion(question)) return engineeringChangeControlAnswer(sql, question);
  if (isEngineeringImpactQuestion(question)) return engineeringImpactAnswer(sql, question);
  if (isProgramForecastQuestion(question)) return programForecastAnswer(sql);
  return undefined;
}

