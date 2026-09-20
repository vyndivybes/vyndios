import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read=(p)=>fs.readFileSync(new URL("../"+p,import.meta.url),"utf8");
const migration=read("migrations/0090_bom_revision_propagation.sql");
const bomAuthority=read("src/lib/bom-mapping-authority.ts");
const bomRoute=read("src/routes/command/bom-control.tsx");
const production=read("src/lib/production-job-card.ts");
const procurementCost=read("src/lib/procurement-cost-authority.ts");
const ibpe=read("src/lib/ibpe-authority.ts");

test("BOM revision release is atomic and supersedes prior active revision",()=>{
  assert.match(migration,/release_vyndi_bom_revision/);
  assert.match(migration,/BOM release blocked: an approved BOM master revision matching/);
  assert.match(migration,/status='superseded'/);
  assert.match(migration,/bom_revision<>p_bom_revision/);
  assert.match(migration,/status='active'/);
  assert.match(migration,/BOM_SUPERSEDED_BY_RELEASE/);
  assert.match(migration,/duplicate controlled component\/option lines/);
  assert.match(migration,/not approved in Inventory Master/);
});

test("existing Job Cards remain frozen while new planning follows current BOM",()=>{
  assert.match(migration,/Existing Job Cards are deliberately not rewritten/);
  assert.match(migration,/vyndi_bom_revision_job_card_impact/);
  assert.match(migration,/PROTECTED_FROZEN/);
  assert.match(migration,/RELEASED_REVIEW_REQUIRED/);
  assert.match(production,/is frozen to BOM/);
  assert.match(production,/Do not silently resynchronize it/);
  assert.match(production,/released_mapping_set/);
});

test("procurement and VIBPE consume active released BOM dynamically",()=>{
  assert.match(procurementCost,/epr_bom_inventory_mappings/);
  assert.match(procurementCost,/status='active'/);
  assert.match(procurementCost,/active_planning_bom=true/);
  assert.match(ibpe,/epr_bom_inventory_mappings/);
  assert.match(ibpe,/status='active'/);
  assert.match(ibpe,/bomCogsReconciliation/);
  assert.match(ibpe,/committedMaterialRequirements/);
});

test("BOM Control exposes release reason, cost impact and Job Card impact",()=>{
  assert.match(bomAuthority,/releaseControlledBomRevision/);
  assert.match(bomAuthority,/getBomRevisionPropagationState/);
  assert.match(bomRoute,/Revision release & downstream impact/);
  assert.match(bomRoute,/Release reason \/ ECR \/ engineering change reference/);
  assert.match(bomRoute,/Bottom-up BOM cost/);
  assert.match(bomRoute,/Existing Job Card impact/);
  assert.match(bomRoute,/Open Procurement impact/);
  assert.match(bomRoute,/Awaiting revision release/);
  assert.doesNotMatch(bomRoute,/approveEprMapping/);
});
