import assert from "node:assert/strict";
import { test } from "node:test";
import { buildGovernedIntelligence, type GovernedIntelligenceInput } from "./intelligence-model.ts";
import type { IntegratedPlanningResult } from "./integrated-business-planning-engine.ts";
import type { VibpeOptimizerReleaseClosure } from "./vibpe-optimizer-release-closure.ts";

const result = {
  demand: [
    { period: 1, planQty: 10, forecastQty: 15, committedQty: 4, actualQty: 2 },
    { period: 1, planQty: 8, forecastQty: 7, committedQty: 3, actualQty: 1 },
    { period: 2, planQty: 12, forecastQty: 11, committedQty: 5, actualQty: 0 },
  ],
  findings: [
    { id: "LOW", severity: "low", domain: "planning", title: "Minor", businessImpact: "Minor impact", recommendedAction: "Review", evidence: [] },
    { id: "CRITICAL", severity: "critical", domain: "supply", title: "Shortage", businessImpact: "Committed supply short", recommendedAction: "Review stock", evidence: [{ label: "Inventory", sourceRef: "INV-1" }] },
  ],
  decisions: [{ id: "DEC-1" }],
  summary: { horizonMonths: 36, expectedUnits: 33, committedOpenUnits: 12, fulfillmentShortageSkuMonths: 1, capacityShortfallMonths: 0, totalRecommendedProcurementLakh: 2, minimumFreeLiquidityLakh: 5, minimumFreeLiquidityAfterRecommendationsLakh: 3, businessHealthScore: 65, findingCounts: { critical: 1, high: 0, medium: 0, low: 1 } },
  funding: { firstBaseLiquidityBreachPeriod: null, firstLiquidityBreachAfterRecommendationsPeriod: null, fundingActionPeriod: null, minimumBaseFreeLiquidityLakh: 5, minimumFreeLiquidityAfterRecommendationsLakh: 3, incrementalFundingNeedLakh: 0 },
} as IntegratedPlanningResult;

function input(): GovernedIntelligenceInput {
  return {
    run: { id: "IBPE-1", sourceSha: "source-1", snapshotAt: "2026-10-03T18:00:00Z", approvedPlanId: "PLAN-1", approvedPlanRevision: 3, result },
    deployedSourceSha: "source-1",
    readAt: "2026-10-03T19:00:00Z",
    closure: {
      verdict: "GREEN",
      packet: { id: "PACKET-1", parent_ibpe_run_id: "IBPE-1", source_sha: "source-1" },
      run: { id: "OPT-1", parent_advanced_packet_id: "PACKET-1", accepted: true, optimization_status: "feasible", cash_guardrail_status: "feasible" },
      gates: [{ id: "RUN", label: "Run", pass: true, evidence: "present" }],
    } as VibpeOptimizerReleaseClosure,
  };
}

test("projects only persisted planning figures and exact optimizer lineage", () => {
  const view = buildGovernedIntelligence(input());
  assert.equal(view.available, true);
  if (!view.available) return;
  assert.deepEqual(view.demandByPeriod[0], { period: 1, plan: 18, forecast: 22, committed: 7, actual: 3 });
  assert.equal(view.findings[0]?.id, "CRITICAL");
  assert.deepEqual(view.findings[0]?.evidence, ["INV-1"]);
  assert.equal(view.lineage.optimizerRunId, "OPT-1");
  assert.equal(view.lineage.releaseCurrent, true);
  assert.equal(view.lineage.ageHours, 1);
});

test("never attributes an optimizer result to a different IBPE snapshot", () => {
  const stale = input();
  stale.run = { ...stale.run!, id: "IBPE-2", sourceSha: "source-2" };
  const view = buildGovernedIntelligence(stale);
  assert.equal(view.available, true);
  if (!view.available) return;
  assert.equal(view.lineage.sourceCurrent, false);
  assert.equal(view.lineage.packetId, null);
  assert.equal(view.lineage.optimizerRunId, null);
  assert.equal(view.lineage.releaseCurrent, false);
  assert.equal(view.optimizer, null);
});

test("missing governed snapshot stays unavailable instead of displaying invented values", () => {
  const missing = input();
  missing.run = null;
  const view = buildGovernedIntelligence(missing);
  assert.deepEqual(view, {
    available: false,
    readAt: missing.readAt,
    reason: "No complete governed IBPE run is available. Run governed IBPE to create a planning snapshot.",
  });
});
