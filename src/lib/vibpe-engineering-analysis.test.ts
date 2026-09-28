import assert from "node:assert/strict";
import test from "node:test";
import { tryVibpeEngineeringAnalysis } from "./vibpe-engineering-analysis.ts";

test("clearance question performs engineering interpretation instead of document lookup", () => {
  const result = tryVibpeEngineeringAnalysis("how good is the downtube and tyre clearance in the latest rev");
  assert.equal(result.handled, true);
  assert.equal(result.caseId, "ENG-CLEARANCE-001");
  assert.match(result.answer ?? "", /7\.170 mm/);
  assert.match(result.answer ?? "", /8\.61 \/ 8\.60 \/ 8\.37 \/ 8\.18 \/ 7\.33 mm/);
  assert.match(result.answer ?? "", /PARTIAL/);
  assert.match(result.answer ?? "", /exact downtube-to-tyre BRep/i);
  assert.match(result.answer ?? "", /9ef41eb8afbc/);
});

test("composite failure question evaluates current analytical screens", () => {
  const result = tryVibpeEngineeringAnalysis("are the current Tsai-Wu and Hashin values acceptable?");
  assert.equal(result.handled, true);
  assert.equal(result.caseId, "ENG-COMPOSITE-SCREEN-001");
  assert.match(result.answer ?? "", /Tsai-Wu FI 0\.623 < 1\.000/);
  assert.match(result.answer ?? "", /Hashin index 0\.353 < 1\.000/);
  assert.match(result.answer ?? "", /not production release/i);
});

test("five-dimension correctness question returns dimension-specific evidence states", () => {
  const result = tryVibpeEngineeringAnalysis("is the current design mathematically physically theoretically practically and scientifically correct?");
  assert.equal(result.handled, true);
  assert.equal(result.caseId, "ENG-CORRECTNESS-001");
  assert.match(result.answer ?? "", /Theoretical: PARTIAL/);
  assert.match(result.answer ?? "", /Mathematical: PARTIAL/);
  assert.match(result.answer ?? "", /Physical: PARTIAL/);
  assert.match(result.answer ?? "", /Practical: INCONCLUSIVE/);
  assert.match(result.answer ?? "", /Scientific: PARTIAL/);
});

test("ordinary business question is not hijacked by engineering analysis", () => {
  const result = tryVibpeEngineeringAnalysis("what is our current cash runway?");
  assert.equal(result.handled, false);
});
