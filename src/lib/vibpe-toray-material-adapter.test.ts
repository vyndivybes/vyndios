import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeTorayMaterialEvidence,
  toTorayMaterialReleaseEvidence,
} from "./vibpe-toray-material-adapter.ts";
import { evaluateTorayMaterialReleaseGate } from "./vibpe-carbon-bike-material-gate.ts";

const source = {
  supplier: "Toray Advanced Composites",
  materialSystem: "TC750",
  fibreBasis: "T700S 12K",
  fawGm2: 380,
  resinContentPct: 37,
  curedPlyThicknessMm: 0.364,
  datasheetUrl: "https://www.toraytac.com/resources/datasheets",
  datasheetRef: "TORAY_TC750_PDS_V1.0_2022/02/15",
  calculatorUrl: "https://www.toraytac.com/resources/Calculators",
  calculatorRecordId: "TORAY-CPT-2026-09-25-002",
  checkedAt: "2026-09-25T10:30:00+05:30",
};

test("normalizes Toray evidence and maps it into the existing material-release gate", () => {
  const normalized = normalizeTorayMaterialEvidence(source);
  const gateEvidence = toTorayMaterialReleaseEvidence(normalized);
  const result = evaluateTorayMaterialReleaseGate(gateEvidence);

  assert.equal(result.supplierValidated, true);
  assert.equal(result.promoteRev1FromProvisional, true);
  assert.equal(result.productionReleased, false);
});

test("preserves missing supplier values instead of substituting defaults", () => {
  const normalized = normalizeTorayMaterialEvidence({ ...source, resinContentPct: undefined });
  assert.equal(normalized.resinContentPct, undefined);
  const result = evaluateTorayMaterialReleaseGate(toTorayMaterialReleaseEvidence(normalized));
  assert.equal(result.supplierValidated, false);
  assert.ok(result.blockers.some((x) => /resin content/i.test(x)));
});

test("rejects non-Toray datasheet and calculator provenance", () => {
  assert.throws(
    () => normalizeTorayMaterialEvidence({ ...source, datasheetUrl: "https://example.com/ds" }),
    /Toray datasheet/i,
  );
  assert.throws(
    () => normalizeTorayMaterialEvidence({ ...source, calculatorUrl: "https://example.com/calc" }),
    /Toray calculator/i,
  );
});
