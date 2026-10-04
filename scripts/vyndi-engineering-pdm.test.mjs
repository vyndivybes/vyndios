import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const read=(p)=>readFile(new URL(`../${p}`,import.meta.url),"utf8");
const [migration,model,authority,panel,route,vibpe,pkg]=await Promise.all([
  read("migrations/0116_vyndi_engineering_pdm.sql"),
  read("src/lib/engineering-pdm-model.ts"),
  read("src/lib/engineering-pdm-authority.ts"),
  read("src/components/engineering-pdm-panel.tsx"),
  read("src/routes/command/engineering.tsx"),
  read("src/lib/vibpe-governance-queries.ts"),
  read("package.json"),
]);

test("Package Q adds controlled document master immutable revisions links and released manifests",()=>{
  for(const token of ["vyndi_engineering_documents","vyndi_engineering_document_revisions","vyndi_engineering_document_links","vyndi_engineering_configuration_manifests"]) assert.match(migration,new RegExp(token));
  assert.match(migration,/content_sha256/);
  assert.match(migration,/content_sha256 text not null check \(content_sha256 ~ '\^\[0-9a-f\]\{64\}\$'\)/i);
  assert.match(migration,/release_vyndi_engineering_document_revision/);
  assert.match(migration,/vyndi_reject_released_document_mutation/);
  assert.match(migration,/before update or delete on vyndi_engineering_configuration_manifests/i);
});

test("document release is maker-checker, requires where-used and supersedes prior released revision atomically",()=>{
  assert.match(migration,/SOD_MAKER_CHECKER/);
  assert.match(migration,/at least one governed where-used link/i);
  assert.match(migration,/status='superseded'/);
  assert.match(migration,/supersedes_revision_id/);
});

test("PDM authority links only to canonical VEDM baseline ECO ECN or BOM release targets",()=>{
  for(const token of ["engineering_baseline","eco","ecn","bom_revision","vedm_authority_node"]) assert.ok(authority.includes(token),token);
  assert.match(authority,/createEngineeringDocument/);
  assert.match(authority,/registerEngineeringDocumentRevision/);
  assert.match(authority,/linkEngineeringDocumentRevision/);
  assert.match(authority,/transitionEngineeringDocumentRevision/);
  assert.match(authority,/releaseEngineeringDocumentRevision/);
  assert.match(authority,/captureEngineeringConfigurationManifest/);
  assert.match(authority,/VEDM_R3A_SOURCE_COMMIT/);
});

test("Engineering exposes controlled PDM revision checksum where-used and manifest workflows",()=>{
  assert.match(route,/EngineeringPdmPanel/);
  assert.match(panel,/Engineering PDM & Document Control/);
  assert.match(panel,/SHA-256/);
  assert.match(panel,/Where-used/);
  assert.match(panel,/Released configuration manifest/);
  assert.match(panel,/Superseded/);
});

test("VIBPE answers document revision checksum where-used and manifest questions from governed PDM state",()=>{
  assert.match(vibpe,/isEngineeringPdmQuestion/);
  assert.match(vibpe,/engineeringPdmAnswer/);
  assert.match(vibpe,/SHA-256/);
  assert.match(vibpe,/where-used/i);
  assert.match(vibpe,/configuration manifest/i);
});

test("aggregate test gate includes Package Q",()=>{
  assert.match(pkg,/vyndi-engineering-pdm\.test\.mjs/);
  assert.match(pkg,/engineering-pdm-model\.test\.ts/);
});


test("Package Q migration has balanced PLpgSQL delimiters and safe release ordering",()=>{
  assert.equal(/(^|\n)[^\n]*\bas \$(?!\$|[A-Za-z_][A-Za-z0-9_]*\$)/g.test(migration),false);
  assert.equal(/(^|\n)\$;\s*(?=\n|$)/g.test(migration),false);
  const supersede=migration.indexOf("set status='superseded',superseded_by_revision_id=r.id");
  const release=migration.indexOf("set supersedes_revision_id=prior.id,status='released'");
  assert.ok(supersede>=0&&release>supersede,"prior released revision must be superseded before successor release to satisfy unique current-release constraint");
  assert.match(migration,/vyndi_guard_manifest_document_insert/);
  assert.match(migration,/finalized=true/);
});

test("Package Q TypeScript contains no connector escape artifacts",()=>{
  for(const [name,source] of [["model",model],["authority",authority],["panel",panel],["route",route],["vibpe",vibpe]]){
    assert.equal(source.includes("\\`"),false,`${name} contains an escaped backtick artifact`);
    assert.equal(source.includes("\\${"),false,`${name} contains an escaped template placeholder artifact`);
  }
});


test("released configuration manifest is complete and self-consistent at the database boundary",()=>{
  assert.match(migration,/every released controlling document for the baseline\/BOM scope must be included/i);
  assert.match(migration,/Configuration manifest JSON does not match the governed manifest identity\/document set/);
  assert.match(migration,/count\(distinct r\.document_id\)/);
});
