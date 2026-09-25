import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateTorayMaterialReleaseGate,
  type TorayMaterialReleaseEvidence,
} from "./vibpe-carbon-bike-material-gate.ts";

const completeSupplierEvidence: TorayMaterialReleaseEvidence = {
  supplier: "Toray",
  materialSystem: "Example Toray commercial prepreg",
  fibreBasis: "T700S",
  fawGm2: 150,
  resinContentPct: 35,
  curedPlyThicknessMm: 0.18,
  calculatorUrl: "https://www.toraytac.com/resources/Calculators",
  calculatorRecordId: "TORAY-CPT-2026-09-25-001",
  calculatorCheckedAt: "2026-09-25T10:30:00+05:30",
  supplierDatasheetUrl: "https://www.toraytac.com/resources/datasheets",
  supplierDatasheetRef: "TORAY-DATASHEET-REF",
};

test("Toray supplier validation stays blocked when cured-ply evidence is incomplete", () => {
  const evidence = { ...completeSupplierEvidence, curedPlyThicknessMm: undefined };
  const result = evaluateTorayMaterialReleaseGate(evidence);

  assert.equal(result.supplierValidated, false);
  assert.equal(result.promoteRev1FromProvisional, false);
  assert.ok(result.blockers.some((item) => /cured ply thickness/i.test(item)));
});

test("complete supplier evidence permits only supplier-validated Rev-1 promotion", () => {
  const result = evaluateTorayMaterialReleaseGate(completeSupplierEvidence);

  assert.equal(result.supplierValidated, true);
  assert.equal(result.promoteRev1FromProvisional, true);
  assert.equal(result.productionReleased, false);
  assert.match(result.releaseNote, /does not constitute structural or production release/i);
});

test("Toray calculator evidence is traceable and cannot replace structural validation", () => {
  const result = evaluateTorayMaterialReleaseGate(completeSupplierEvidence);

  assert.equal(result.evidence.calculatorUrl, "https://www.toraytac.com/resources/Calculators");
  assert.equal(result.evidence.supplierDatasheetUrl, "https://www.toraytac.com/resources/datasheets");
  assert.ok(result.requiredDownstreamChecks.includes("laminate allowables"));
  assert.ok(result.requiredDownstreamChecks.includes("FEA/test correlation"));
  assert.ok(result.requiredDownstreamChecks.includes("coupon/subcomponent validation"));
});

test("Toray datasheet authority URL is mandatory for supplier validation", () => {
  const evidence = { ...completeSupplierEvidence, supplierDatasheetUrl: undefined };
  const result = evaluateTorayMaterialReleaseGate(evidence);

  assert.equal(result.supplierValidated, false);
  assert.ok(result.blockers.some((item) => /datasheet source url/i.test(item)));
});
