import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createServer } from "vite";
import { VIBPE_QA_CASES } from "./vibpe-copilot-qa-cases.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcRoot = path.join(repoRoot, "src");
const reportDir = process.env.VIBPE_QA_REPORT_DIR
  ? path.resolve(repoRoot, process.env.VIBPE_QA_REPORT_DIR)
  : path.join(repoRoot, "artifacts", "vibpe-qa");

const server = await createServer({
  root: repoRoot,
  configFile: false,
  appType: "custom",
  logLevel: "error",
  server: { middlewareMode: true },
  resolve: { alias: { "@": srcRoot } },
});

function baseline() {
  return {
    demand: [
      {
        id: "M1-aluminium",
        productId: "aluminium",
        period: 1,
        planQty: 2,
        forecastQty: 2,
        committedQty: 1,
        actualQty: 1,
        residualForecastQty: 1,
        weightedPipelineQty: 0,
        remainingDemandQty: 1,
        expectedTotalQty: 2,
        confidence: 1,
        varianceToPlanQty: -1,
        varianceToPlanPct: -0.5,
      },
    ],
    mrp: [],
    inventoryHealth: [],
    supply: [
      {
        period: 1, sku: "FRAME-M", plannedRequirementQty: 2, committedRequirementQty: 2,
        demandBasis: "committed", grossRequirementQty: 2, reservedCoverageQty: 0,
        unreservedRequirementQty: 2, confirmedReceiptsQty: 0, committedFreeStockStartQty: 0,
        committedFreeStockEndQty: 0, committedFulfillmentShortageQty: 2, targetBufferQty: 0,
        plannedFreeStockStartQty: 0, plannedFreeStockEndQty: 0, recommendedPurchaseQty: 2,
        orderByPeriod: 1, recommendationIsLate: true, purchaseCostLakh: 0.1,
      },
      {
        period: 1, sku: "GROUPSET", plannedRequirementQty: 1, committedRequirementQty: 1,
        demandBasis: "committed", grossRequirementQty: 1, reservedCoverageQty: 0,
        unreservedRequirementQty: 1, confirmedReceiptsQty: 0, committedFreeStockStartQty: 0,
        committedFreeStockEndQty: 0, committedFulfillmentShortageQty: 1, targetBufferQty: 0,
        plannedFreeStockStartQty: 0, plannedFreeStockEndQty: 0, recommendedPurchaseQty: 1,
        orderByPeriod: 1, recommendationIsLate: true, purchaseCostLakh: 0.08,
      },
    ],
    capacity: [{ id: "assembly", period: 1, requiredUnits: 1, availableCapacityUnits: 0, shortfallUnits: 1 }],
    cash: [
      { period: 1, selectedInflowsLakh: 0, selectedOutflowsLakh: 0, incrementalProcurementLakh: 0.18, closingCashLakh: -4.6, freeLiquidityLakh: -4.6, closingCashAfterRecommendationsLakh: -4.7, freeLiquidityAfterRecommendationsLakh: -4.7 },
      { period: 2, selectedInflowsLakh: 0, selectedOutflowsLakh: 0, incrementalProcurementLakh: 0, closingCashLakh: -1.2, freeLiquidityLakh: -1.2, closingCashAfterRecommendationsLakh: -1.2, freeLiquidityAfterRecommendationsLakh: -1.2 },
    ],
    funding: {
      firstBaseLiquidityBreachPeriod: 1,
      firstLiquidityBreachAfterRecommendationsPeriod: 1,
      fundingActionPeriod: 1,
      minimumBaseFreeLiquidityLakh: -4.6,
      minimumFreeLiquidityAfterRecommendationsLakh: -4.7,
      incrementalFundingNeedLakh: 4.7,
    },
    findings: [
      { id: "funding:m1", severity: "critical", domain: "funding", title: "Free liquidity below operating reserve", problem: "Liquidity is negative.", businessImpact: "Plan is funding dependent.", recommendedAction: "Start funding/cost/pace action by M1.", evidence: [] },
      { id: "procurement:frame", severity: "high", domain: "procurement", title: "Committed supply shortfall", problem: "FRAME-M is short.", businessImpact: "Confirmed demand is blocked.", recommendedAction: "Review exact shortage and approve replenishment in Procurement.", evidence: [] },
    ],
    decisions: [],
    summary: {
      horizonMonths: 36,
      expectedUnits: 258,
      committedOpenUnits: 1,
      totalRecommendedProcurementLakh: 0.18,
      fulfillmentShortageSkuMonths: 2,
      capacityShortfallMonths: 1,
      minimumFreeLiquidityLakh: -4.6,
      minimumFreeLiquidityAfterRecommendationsLakh: -4.7,
      businessHealthScore: 53,
      findingCounts: { critical: 1, high: 1, medium: 0, low: 0 },
    },
  };
}

function makeFixtureSql() {
  const normalize = (sql) => String(sql).replace(/\s+/g, " ").trim().toLowerCase();
  const query = async (sql) => {
    const q = normalize(sql);

    if (q.includes("from vyndi_ibpe_runs") && q.includes("minimumfreeliquidityafterrecommendationslakh")) {
      return [{
        id: "IBPE-QA-R7", approved_plan_revision: 7, created_at: "2026-09-16T07:00:00.000Z",
        business_health_score: 53, expected_units: 258, committed_open_units: 1,
        shortage_sku_months: 2, capacity_shortfall_months: 1, recommended_procurement_lakh: 0.18,
        minimum_free_liquidity_lakh: -4.7, minimum_liquidity: -4.7, funding_need: 4.7,
        incremental_funding_need_lakh: 4.7, first_breach: 1, committed_units: 1,
        recommended_procurement: 0.18,
      }];
    }

    // This current operational query also contains the capacity JSON expression.
    // Match the complete CTE first so the synthetic fixture cannot accidentally
    // return a capacity-only row and fabricate "no confirmed demand".
    if (q.includes("with current_orders as") && q.includes("committed_component_units")) {
      return [{
        confirmed_orders: 1, confirmed_units: 1, active_job_cards: 1,
        committed_component_units: 3, committed_skus: 2, net_committed_shortage: 3,
        open_po_qty: 2, capacity_shortfall_months: 1, latest_run_id: "IBPE-QA-R7",
      }];
    }

    if (q.includes("result_json->'summary'->>'capacityshortfallmonths'")) {
      return [{ capacity_shortfall_months: 1 }];
    }
    if (q.includes("from vyndi_sales_orders") && q.includes("count(*)::int as confirmed_orders")) {
      return [{ confirmed_orders: 1, confirmed_units: 1 }];
    }

    if (q.includes("from vyndi_committed_procurement_requirements") && q.includes("where net_committed_shortage > 0")) {
      if (q.includes("count(distinct sku)")) return [{ shortage_qty: 3, shortage_skus: 2 }];
      return [
        { requirement_month: 1, sku: "FRAME-M", item_name: "Frame", committed_requirement: 2, reserved_quantity: 0, physical_quantity: 0, available_to_promise: 0, net_committed_shortage: 2, open_po_qty: 2 },
        { requirement_month: 1, sku: "GROUPSET", item_name: "Groupset", committed_requirement: 1, reserved_quantity: 0, physical_quantity: 0, available_to_promise: 0, net_committed_shortage: 1, open_po_qty: 0 },
      ];
    }

    if (q.includes("from vyndi_purchase_orders") && q.includes("draft_rows")) {
      return [{ draft_rows: 2, draft_qty: 3, unassigned_draft_rows: 1, unassigned_drafts: 1, committed_rows: 0, committed_qty: 0 }];
    }
    if (q.includes("from vyndi_suppliers") && q.includes("approved_active")) {
      return [{ approved_active: 1, missing_quality_rating: 0, missing_delivery_rating: 0 }];
    }
    if (q.includes("from vyndi_operating_actions") && q.includes("open_actions")) {
      return [{ open_actions: 1, unowned: 0, no_due: 0 }];
    }
    if (q.includes("from vyndi_vibpe_assurance_exceptions_all")) {
      return [{ critical_count: 0, top_gate: null, top_type: null }];
    }
    // Match the full reconciliation projection before its embedded inventory view.
    if (q.includes("with jc as") && q.includes("job_reserved") && q.includes("net_committed_shortage")) {
      return [
        { sku: "FRAME-M", open_required: 2, job_reserved: 0, job_shortage: 2, issued_qty: 0, committed_requirement: 2, procurement_reserved: 0, net_committed_shortage: 2, physical_qty: 0, report_reserved: 0, atp_qty: 0, open_po_qty: 2, open_job_cards: 1 },
        { sku: "GROUPSET", open_required: 1, job_reserved: 0, job_shortage: 1, issued_qty: 0, committed_requirement: 1, procurement_reserved: 0, net_committed_shortage: 1, physical_qty: 0, report_reserved: 0, atp_qty: 0, open_po_qty: 0, open_job_cards: 1 },
      ];
    }
    if (q.includes("from vyndi_report_procurement_net_requirement") || q.includes("join vyndi_report_procurement_net_requirement")) {
      return [
        { sku: "FRAME-M", physical_qty: 0, committed_reserved_qty: 0, atp_qty: 0, open_po_qty: 2 },
        { sku: "GROUPSET", physical_qty: 0, committed_reserved_qty: 0, atp_qty: 0, open_po_qty: 0 },
      ];
    }
    if (q.includes("from vyndi_vibpe_job_card_lineage") || (q.includes("epr_production_job_cards") && q.includes("sales_order"))) {
      return [{ sales_order_id: "SO-QA-001", sales_order_revision: 1, matched_order_id: "SO-QA-001", matched_order_revision: 1, order_status: "confirmed", revision: 1, job_card_id: "JC-QA-001", job_card_status: "released", origin_status: "linked", broken_origin: false }];
    }
    if (q.includes("from epr_production_job_cards") && q.includes("epr_travellers")) {
      return [{ sales_order_id: "SO-QA-001", job_card_id: "JC-QA-001", job_card_status: "released", shortage_qty: 3, traveller_count: 0 }];
    }
    if (q.includes("from vyndi_monthly_transaction_actuals")) {
      return [{ plan_month: 1, revenue: 320000, units: 1, receivables: 80000 }];
    }
    if (q.includes("from vyndi_plan_revisions")) return [];
    if (q.includes("from vyndi_knowledge") || q.includes("knowledge")) return [];
    return [];
  };

  const sql = async () => [];
  sql.query = query;
  return sql;
}

function proposalFor(testCase, audit) {
  const filesByPack = {
    "cash-ledger-reconciliation": ["src/lib/vibpe-truth-contract.ts", "src/lib/vibpe-copilot-2.ts"],
    "procurement-recommendations": ["src/lib/vibpe-truth-contract.ts", "src/lib/vibpe-operational-queries.ts"],
    "demand-commitment-feasibility": ["src/lib/vibpe-operational-queries.ts", "scripts/vibpe-copilot-qa-runner.mjs"],
    inventory: ["src/lib/vibpe-live-specialist-queries.ts", "src/lib/vibpe-operational-queries.ts"],
    "job-card-traveller": ["src/lib/vibpe-truth-contract.ts", "src/lib/vibpe-governance-queries.ts"],
    liquidity: ["src/lib/vibpe-truth-contract.ts", "src/lib/vibpe-live-specialist-queries.ts"],
    funding: ["src/lib/vibpe-truth-contract.ts"],
    "actual-vs-plan": ["src/lib/vibpe-truth-contract.ts"],
  };
  return {
    summary: `Tighten governed VIBPE answer contract for ${testCase.pack}: ${audit.assessment.defectClasses.join(", ")}.`,
    kind: "code",
    files: filesByPack[testCase.pack],
    requiresMutation: false,
    sandbox: true,
  };
}

function markdownReport(meta, audits) {
  const lines = [
    "# VIBPE Co-Pilot autonomous QA audit",
    "",
    `Generated: ${meta.generatedAt}`,
    `Baseline: ${meta.baseline}`,
    `Cases: ${meta.total} · PASS ${meta.passed} · FAIL ${meta.failed}`,
    "",
  ];
  for (const audit of audits) {
    lines.push(
      `## ${audit.caseId} · ${audit.pack} · ${audit.assessment.pass ? "PASS" : "FAIL"}`,
      "",
      `**Question:** ${audit.question}`,
      "",
      `**Expected:** ${audit.expected}`,
      "",
      `**Defect class:** ${audit.assessment.defectClasses.length ? audit.assessment.defectClasses.join(", ") : "none"}`,
      "",
      "**Raw answer:**",
      "",
      audit.rawAnswer,
      "",
      `**Proposed correction:** ${audit.proposal?.summary ?? "none"}`,
      "",
      `**Changed files:** ${audit.changedFiles.length ? audit.changedFiles.join(", ") : "none in audit-only CI cycle"}`,
      "",
      `**Test results:** ${audit.testResults.join("; ") || "not recorded"}`,
      "",
      ...audit.assessment.dimensions.map((item) => `- ${item.dimension}: ${item.pass ? "PASS" : `FAIL — ${item.reasons.join("; ")}`}`),
      "",
    );
  }
  return lines.join("\n");
}

try {
  const [{ runVibpeCopilot2 }, { tryVibpeLiveSpecialistAnswer }, qa] = await Promise.all([
    server.ssrLoadModule("/src/lib/vibpe-copilot-2.ts"),
    server.ssrLoadModule("/src/lib/vibpe-live-specialist-queries.ts"),
    server.ssrLoadModule("/src/lib/vibpe-copilot-qa.ts"),
  ]);
  const sql = makeFixtureSql();
  const governedBaseline = baseline();
  const audits = [];

  for (const testCase of VIBPE_QA_CASES) {
    const cycles = await qa.runVibpeQaCycle({
      testCase,
      maxCycles: 1,
      ask: async (question) => {
        const specialist = await tryVibpeLiveSpecialistAnswer(sql, question);
        if (specialist) return String(specialist);
        const result = await runVibpeCopilot2(sql, question, governedBaseline, { sessionKey: `qa:${testCase.id}` });
        return String(result.answer ?? "");
      },
      propose: async (audit) => proposalFor(testCase, audit),
    });
    const audit = cycles.at(-1);
    audit.testResults = [`current certified routing stack governed-fixture execution: ${audit.assessment.pass ? "PASS" : "FAIL"}`];
    audits.push(audit);
  }

  const failed = audits.filter((audit) => !audit.assessment.pass);
  const meta = {
    generatedAt: new Date().toISOString(),
    baseline: "262cac9ff5cfc37a8dd66a14b1b57fa3c3024ad8",
    total: audits.length,
    passed: audits.length - failed.length,
    failed: failed.length,
    guardrails: {
      transactionalBusinessDataAutoMutation: false,
      automaticProcurementCommitment: false,
      automaticFundingCommitment: false,
      automaticCustomerPromise: false,
      productionReleaseMutation: false,
      migrationsAllowed: false,
      mutationsRequireGovernedFixtureOrSandbox: true,
    },
  };

  await mkdir(reportDir, { recursive: true });
  const stamp = meta.generatedAt.replace(/[:.]/g, "-");
  const jsonPath = path.join(reportDir, `vibpe-qa-${stamp}.json`);
  const mdPath = path.join(reportDir, `vibpe-qa-${stamp}.md`);
  await writeFile(jsonPath, JSON.stringify({ ...meta, audits }, null, 2) + "\n");
  await writeFile(mdPath, markdownReport(meta, audits) + "\n");

  console.log(`[vibpe-qa] ${meta.passed}/${meta.total} passed`);
  console.log(`[vibpe-qa] JSON ${path.relative(repoRoot, jsonPath)}`);
  console.log(`[vibpe-qa] Markdown ${path.relative(repoRoot, mdPath)}`);
  for (const audit of failed) {
    console.error(`[vibpe-qa] FAIL ${audit.caseId}: ${audit.assessment.defectClasses.join(", ")}`);
    for (const item of audit.assessment.dimensions.filter((dimension) => !dimension.pass)) {
      console.error(`  - ${item.dimension}: ${item.reasons.join("; ")}`);
    }
  }
  if (failed.length) process.exitCode = 1;
} finally {
  await server.close();
}
