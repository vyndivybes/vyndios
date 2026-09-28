import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildVibpeAnswerReceipt,
  deriveVibpeDegradationState,
  rankSensitivityDrivers,
  type VibpeFiveDimensionAssessment,
} from "./vibpe-reasoning-core.ts";

const fiveDimensions: VibpeFiveDimensionAssessment = {
  mathematical: { status: "verified", basis: "recomputed from governed inputs" },
  theoretical: { status: "supported", basis: "governing model identified" },
  physical: { status: "requires-simulation", basis: "no correlated physical result" },
  practical: { status: "partially-supported", basis: "supplier constraint incomplete" },
  scientific: { status: "supported", basis: "evidence and assumptions declared" },
};

test("answer receipt exposes degraded source failures instead of silently falling back", () => {
  const state = deriveVibpeDegradationState([
    { source: "governance", status: "unavailable", detail: "query failed" },
    { source: "operational", status: "live" },
  ]);

  assert.equal(state.mode, "degraded");
  assert.equal(state.live, false);
  assert.match(state.disclosure, /governance unavailable/i);
});

test("answer receipt carries evidence, assumptions, contradictions and five-dimension assessment", () => {
  const receipt = buildVibpeAnswerReceipt({
    answerId: "ans-001",
    question: "Can this plan be executed?",
    intent: "assessment",
    dataMode: "live",
    evidence: [
      {
        claimId: "C1",
        claim: "Supplier capacity is 100 units/month",
        claimClass: "capacity",
        source: "supplier-lane",
        revision: "R3",
        effectiveDate: "2026-09-01",
        authority: "governed-internal",
        supersessionState: "current",
        support: "direct",
        confidence: 0.95,
        reviewerStatus: "accepted",
      },
    ],
    assumptions: ["Demand remains at approved-plan level"],
    contradictions: [
      {
        claim: "Supplier capacity",
        evidenceA: "100 units/month",
        evidenceB: "80 units/month",
        resolution: "unresolved",
      },
    ],
    calculations: [{ label: "capacity gap", expression: "120-100", result: 20, unit: "units" }],
    reasoningTrace: [
      { stage: "classify-intent", status: "completed", detail: "assessment" },
      { stage: "decompose-question", status: "completed", detail: "capacity feasibility" },
      { stage: "retrieve-evidence", status: "completed", detail: "supplier lane evidence" },
      { stage: "identify-conflicts", status: "completed", detail: "one unresolved conflict" },
      { stage: "declare-assumptions", status: "completed", detail: "one assumption" },
      { stage: "calculate-or-simulate", status: "completed", detail: "capacity gap recomputed" },
      { stage: "test-constraints", status: "completed", detail: "supplier capacity constraint tested" },
      { stage: "score-correctness", status: "completed", detail: "five-dimension assessment" },
      { stage: "state-uncertainty", status: "completed", detail: "confidence calibrated" },
      { stage: "recommend-controlled-action", status: "completed", detail: "resolve contradiction" },
    ],
    fiveDimensions,
    confidence: 0.72,
    nextAction: "Resolve supplier-capacity contradiction before approval.",
  });

  assert.equal(receipt.schema, "vibpe-answer-receipt/v1");
  assert.equal(receipt.fiveDimensions.mathematical.status, "verified");
  assert.equal(receipt.contradictions.length, 1);
  assert.equal(receipt.evidence[0].revision, "R3");
  assert.equal(receipt.evidence[0].claimClass, "capacity");
  assert.equal(receipt.evidence[0].supersessionState, "current");
  assert.equal(receipt.reasoningTrace.length, 10);
  assert.equal(receipt.confidence, 0.72);
});

test("sensitivity ranking orders assumptions by absolute outcome effect and preserves direction", () => {
  const ranked = rankSensitivityDrivers([
    { variable: "supplier lead time", baseValue: 30, lowValue: 20, highValue: 45, lowOutcome: 15, baseOutcome: 25, highOutcome: 55, unit: "days" },
    { variable: "scrap", baseValue: 0.05, lowValue: 0.03, highValue: 0.08, lowOutcome: 23, baseOutcome: 25, highOutcome: 29, unit: "ratio" },
  ]);

  assert.equal(ranked[0].variable, "supplier lead time");
  assert.equal(ranked[0].maximumAbsoluteEffect, 30);
  assert.equal(ranked[0].direction, "increases-outcome");
});
