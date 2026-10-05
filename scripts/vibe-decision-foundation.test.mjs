import assert from "node:assert/strict";
import test from "node:test";

import {
  assessEvidenceFreshness,
  buildVibeDecisionFoundation,
  detectEvidenceConflicts,
} from "../src/lib/vibe-decision-foundation.ts";

const now = new Date("2026-10-05T06:00:00.000Z");

test("evidence freshness is explicit and deterministic", () => {
  assert.equal(assessEvidenceFreshness({ observedAt: "2026-10-05T05:00:00.000Z", maxAgeHours: 6 }, now), "current");
  assert.equal(assessEvidenceFreshness({ observedAt: "2026-10-04T20:00:00.000Z", maxAgeHours: 6 }, now), "stale");
  assert.equal(assessEvidenceFreshness({ maxAgeHours: 6 }, now), "unknown");
});

test("materially different governed claims are surfaced as conflicts", () => {
  const conflicts = detectEvidenceConflicts([
    { key: "material-budget", value: 8, truthClass: "governed-internal", source: "finance", observedAt: now.toISOString() },
    { key: "material-budget", value: 8.7, truthClass: "governed-internal", source: "procurement", observedAt: now.toISOString() },
    { key: "material-budget", value: 8.7, truthClass: "scenario-assumption", source: "scenario", observedAt: now.toISOString() },
  ]);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].key, "material-budget");
  assert.deepEqual(conflicts[0].sources.sort(), ["finance", "procurement"]);
});

test("decision foundation separates facts, assumptions, conflicts and missing evidence", () => {
  const decision = buildVibeDecisionFoundation({
    question: "Can we commit the prototype date?",
    decisionClass: "programme",
    now,
    evidence: [
      { key: "material-lead-time", value: 6, truthClass: "governed-internal", source: "procurement", observedAt: "2026-10-05T05:00:00.000Z", maxAgeHours: 24 },
      { key: "material-lead-time", value: 8, truthClass: "governed-internal", source: "supplier-review", observedAt: "2026-10-05T04:00:00.000Z", maxAgeHours: 24 },
      { key: "funding", value: 10, truthClass: "scenario-assumption", source: "scenario" },
    ],
    requiredEvidenceKeys: ["material-lead-time", "capacity"],
  });

  assert.equal(decision.facts.length, 2);
  assert.equal(decision.assumptions.length, 1);
  assert.equal(decision.conflicts.length, 1);
  assert.deepEqual(decision.missingEvidence, ["capacity"]);
  assert.equal(decision.authority.executable, false);
  assert.equal(decision.authority.approvalRequired, true);
  assert.equal(decision.confidence.level, "LOW");
});
