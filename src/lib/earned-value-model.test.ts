import test from "node:test";
import assert from "node:assert/strict";
import { buildEarnedValueSnapshot } from "./earned-value-model.ts";

const baseTask = {
  status: "in_progress" as const,
  plannedStart: "2026-10-01",
  plannedFinish: "2026-10-11",
  budgetAtCompletionLakh: 10,
  progressPct: 50,
  progressSourceRef: "EVID:PROGRESS",
  actualCostLakh: 5,
  actualCostSourceRef: "EVID:COST",
};

test("earned value derives BAC PV EV AC and performance indices from governed evidence", () => {
  const result = buildEarnedValueSnapshot({
    asOfDate: "2026-10-06",
    tasks: [
      { ...baseTask, id: "A", budgetAtCompletionLakh: 10, progressPct: 100, actualCostLakh: 9 },
      { ...baseTask, id: "B", budgetAtCompletionLakh: 20, progressPct: 25, actualCostLakh: 8 },
    ],
  });
  assert.equal(result.available, true);
  assert.equal(result.bacLakh, 30);
  assert.equal(result.pvLakh, 15);
  assert.equal(result.evLakh, 15);
  assert.equal(result.acLakh, 17);
  assert.equal(result.spi, 1);
  assert.equal(result.cpi, 0.8824);
  assert.equal(result.svLakh, 0);
  assert.equal(result.cvLakh, -2);
  assert.equal(result.eacLakh, 34);
  assert.equal(result.etcLakh, 17);
  assert.equal(result.vacLakh, -4);
  assert.equal(result.tcpiBac, 1.1538);
  assert.equal(result.progressCoveragePct, 100);
  assert.equal(result.actualCostCoveragePct, 100);
});

test("earned value withholds performance when an active task lacks progress or actual-cost evidence", () => {
  const result = buildEarnedValueSnapshot({
    asOfDate: "2026-10-06",
    tasks: [
      { ...baseTask, id: "A" },
      { ...baseTask, id: "B", progressPct: null, progressSourceRef: null, actualCostLakh: null, actualCostSourceRef: null },
    ],
  });
  assert.equal(result.available, false);
  assert.deepEqual(result.missingProgressTaskIds, ["B"]);
  assert.deepEqual(result.missingActualCostTaskIds, ["B"]);
  assert.equal(result.cpi, null);
  assert.equal(result.spi, null);
  assert.equal(result.eacLakh, null);
  assert.match(result.reason, /withheld/i);
});

test("completed tasks earn 100 percent without a separate manual EV input", () => {
  const result = buildEarnedValueSnapshot({
    asOfDate: "2026-10-11",
    tasks: [{
      ...baseTask,
      id: "A",
      status: "complete",
      progressPct: null,
      progressSourceRef: null,
      actualCostLakh: 11,
      actualCostSourceRef: "INVOICE:ACTUAL",
    }],
  });
  assert.equal(result.available, true);
  assert.equal(result.evLakh, 10);
  assert.equal(result.acLakh, 11);
  assert.equal(result.cpi, 0.9091);
});

test("earned value never emits infinite ratios when denominators are zero", () => {
  const result = buildEarnedValueSnapshot({
    asOfDate: "2026-09-01",
    tasks: [{
      ...baseTask,
      id: "A",
      status: "planned",
      plannedStart: "2026-10-01",
      plannedFinish: "2026-10-11",
      progressPct: null,
      progressSourceRef: null,
      actualCostLakh: null,
      actualCostSourceRef: null,
    }],
  });
  assert.equal(result.pvLakh, 0);
  assert.equal(result.evLakh, 0);
  assert.equal(result.spi, null);
  assert.equal(result.cpi, null);
  assert.equal(result.tcpiBac, null);
});


test("blocked tasks preserve previously evidenced physical progress", () => {
  const result = buildEarnedValueSnapshot({
    asOfDate: "2026-10-06",
    tasks: [{
      ...baseTask,
      id: "A",
      status: "blocked",
      progressPct: 40,
      progressSourceRef: "EVID:BLOCKED-PROGRESS",
      actualStart: "2026-10-02",
      actualCostLakh: 4,
      actualCostSourceRef: "LEDGER:BLOCKED-COST",
    }],
  });

  assert.equal(result.available, true);
  assert.equal(result.evLakh, 4);
  assert.equal(result.acLakh, 4);
  assert.equal(result.cpi, 1);
});


test("blocked work that has started requires progress evidence before EVM is publishable", () => {
  const result = buildEarnedValueSnapshot({
    asOfDate: "2026-10-06",
    tasks: [{
      ...baseTask,
      id: "A",
      status: "blocked",
      actualStart: "2026-10-02",
      progressPct: null,
      progressSourceRef: null,
      actualCostLakh: 4,
      actualCostSourceRef: "LEDGER:BLOCKED-COST",
    }],
  });

  assert.equal(result.available, false);
  assert.deepEqual(result.missingProgressTaskIds, ["A"]);
  assert.equal(result.cpi, null);
  assert.equal(result.spi, null);
});
