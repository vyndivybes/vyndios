import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read=(path)=>readFile(new URL(`../${path}`,import.meta.url),"utf8");

const [migration,model,authority,panel,planning,planningDeck,intelligence,intelligenceDeck,queries,pkg]=await Promise.all([
  read("migrations/0110_vyndi_earned_value_intelligence.sql"),
  read("src/lib/earned-value-model.ts"),
  read("src/lib/earned-value-authority.ts"),
  read("src/components/earned-value-panel.tsx"),
  read("src/routes/command/planning.tsx"),
  read("src/components/planning-intelligence-deck.tsx"),
  read("src/routes/command/intelligence.tsx"),
  read("src/components/intelligence-advisory-deck.tsx"),
  read("src/lib/vibpe-governance-queries.ts"),
  read("package.json"),
]);

test("EVM schema persists evidence-backed progress, actual cost and immutable snapshots",()=>{
  for(const token of ["progress_pct","progress_evidence_ref","actual_cost_lakh","actual_cost_source_ref","vyndi_earned_value_runs"]) assert.ok(migration.includes(token),`missing ${token}`);
  assert.match(migration,/Immutable governed Earned Value/i);
});

test("EVM model computes standard program-control measures and withholds unsupported performance",()=>{
  for(const token of ["bacLakh","pvLakh","evLakh","acLakh","spi","cpi","eacLakh","etcLakh","vacLakh","tcpiBac"]) assert.ok(model.includes(token),`missing ${token}`);
  assert.match(model,/missingProgressTaskIds/);
  assert.match(model,/missingActualCostTaskIds/);
  assert.doesNotMatch(model,/Math\.random/);
});

test("Earned Value authority stores evidence before deriving immutable advisory results",()=>{
  assert.match(authority,/updateEarnedValueEvidence/);
  assert.match(authority,/captureEarnedValueSnapshot/);
  assert.match(authority,/PROGRAM_EVM_EVIDENCE_UPDATED/);
  assert.match(authority,/PROGRAM_EVM_SNAPSHOT_CAPTURED/);
  assert.match(authority,/requireBusinessActor/);
});

test("Integrated Planning and Product Intelligence expose governed Earned Value",()=>{
  assert.match(planning,/PlanningIntelligenceDeck/);
  assert.match(planningDeck,/EarnedValuePanel/);
  assert.match(planningDeck,/getEarnedValueState/);
  assert.match(panel,/Earned Value Intelligence/);
  assert.match(intelligence,/IntelligenceAdvisoryDeck/);
  assert.match(intelligenceDeck,/Earned Value/);
  assert.match(intelligenceDeck,/CPI/);
  assert.match(intelligenceDeck,/SPI/);
});

test("VIBPE answers EVM questions from captured governed evidence and preserves authority boundary",()=>{
  assert.match(queries,/isEarnedValueQuestion/);
  assert.match(queries,/earnedValueAnswer/);
  assert.match(queries,/CPI/);
  assert.match(queries,/SPI/);
  assert.match(queries,/does not approve|advisory/i);
});

test("aggregate repository test command includes Package K static and model tests",()=>{
  assert.match(pkg,/vyndi-earned-value-intelligence\.test\.mjs/);
  assert.match(pkg,/earned-value-model\.test\.ts/);
});


test("Earned Value GET state returns serializable task rows instead of Record<string, unknown>",()=>{
  assert.match(authority,/type SerializableRow/);
  assert.match(authority,/toSerializableRow/);
  assert.match(authority,/taskRows: taskRows\.map\(toSerializableRow\)/);
});
