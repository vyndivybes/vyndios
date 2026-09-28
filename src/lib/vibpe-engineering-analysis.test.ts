import assert from "node:assert/strict";
import test from "node:test";
import { engineeringSnapshotFromEvidencePacket, resolveVibpeEngineeringAnalysis, tryVibpeEngineeringAnalysis } from "./vibpe-engineering-analysis.ts";

test("clearance question performs engineering interpretation instead of document lookup", () => {
  const result = tryVibpeEngineeringAnalysis("how good is the downtube and tyre clearance in the latest rev");
  assert.equal(result.handled, true);
  assert.equal(result.caseId, "ENG-CLEARANCE-001");
  assert.match(result.answer ?? "", /7\.170 mm/);
  assert.match(result.answer ?? "", /8\.61 \/ 8\.60 \/ 8\.37 \/ 8\.18 \/ 7\.33 mm/);
  assert.match(result.answer ?? "", /PARTIAL/);
  assert.match(result.answer ?? "", /exact downtube-to-tyre BRep/i);
  assert.match(result.answer ?? "", /b874cde910ce/);
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


test("normalizes a governed VEDM evidence packet and uses it in the answer", () => {
  const snapshot = engineeringSnapshotFromEvidencePacket({
    schema: "VYNDI_ENGINEERING_EVIDENCE_V1",
    configurationId: "VEDM-301-EK75",
    revision: "VEDM-301 Rev 5.3.9 Candidate E-K75",
    source: {
      repository: "vayu-shastr/veloxis-engineering-design-manual",
      commit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    },
    assessment: {
      authority: "VEDM-301 Rev 5.3.9 Candidate E-K75 (frame geometry)",
      analyticalScreens: {
        denseSteeringSweepMinMm: 6.5,
        packagingMm: [8.1, 8.0, 7.9, 7.8, 7.2],
        tsaiWuFi: 0.7,
        positiveRootStrengthRatio: 1.3,
        hashinIndex: 0.4,
        qualification: "ANALYTICAL_SCREEN_ONLY",
      },
      results: [
        { dimension: "theoretical", status: "PARTIAL" },
        { dimension: "mathematical", status: "PARTIAL" },
        { dimension: "physical", status: "PARTIAL" },
        { dimension: "practical", status: "INCONCLUSIVE" },
        { dimension: "scientific", status: "PARTIAL" },
      ],
      releaseDisposition: "NO-GO — MATERIAL-01 open",
    },
  });
  assert.ok(snapshot);
  const result = tryVibpeEngineeringAnalysis("how good is tyre clearance?", snapshot ?? undefined);
  assert.match(result.answer ?? "", /6\.500 mm/);
  assert.match(result.answer ?? "", /aaaaaaaaaaaa/);
});


test("prefers the latest accepted governed engineering-evidence receipt over the built-in snapshot", async () => {
  let queryText = "";
  const fakeSql = {
    query: async (sql: string) => {
      queryText = sql;
      return [{
      payload_json: {
        schema: "VYNDI_ENGINEERING_EVIDENCE_V1",
        configurationId: "VEDM-301-EK75",
        revision: "VEDM-301 Rev 5.3.9 Candidate E-K75",
        source: {
          repository: "vayu-shastr/veloxis-engineering-design-manual",
          commit: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        },
        assessment: {
          authority: "VEDM-301 Rev 5.3.9 Candidate E-K75",
          analyticalScreens: {
            denseSteeringSweepMinMm: 6.25,
            packagingMm: [8, 7.9, 7.8, 7.7, 7.1],
            tsaiWuFi: 0.68,
            positiveRootStrengthRatio: 1.31,
            hashinIndex: 0.39,
            qualification: "ANALYTICAL_SCREEN_ONLY",
          },
          results: [
            { dimension: "theoretical", status: "PARTIAL" },
            { dimension: "mathematical", status: "PARTIAL" },
            { dimension: "physical", status: "PARTIAL" },
            { dimension: "practical", status: "INCONCLUSIVE" },
            { dimension: "scientific", status: "PARTIAL" },
          ],
        },
      },
    }];
    },
  };
  const result = await resolveVibpeEngineeringAnalysis(fakeSql as never, "tyre clearance latest rev");
  assert.equal(result.handled, true);
  assert.match(queryText, /vyndi_engineering_evidence_acceptances/);
  assert.match(queryText, /decision=\'accepted\'/);
  assert.match(result.answer ?? "", /6\.250 mm/);
  assert.match(result.answer ?? "", /bbbbbbbbbbbb/);
});
