import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

const migration=fs.readFileSync(new URL("../migrations/0137_enterprise_evidence_ledger_closure.sql",import.meta.url),"utf8");
const registry=fs.readFileSync(new URL("../src/lib/enterprise-evidence-registry.ts",import.meta.url),"utf8");

test("enterprise evidence registry covers every material VYNDI operating domain without creating duplicate transaction truth",()=>{
 for(const domain of ["commercial","procurement","inventory","production","quality","engineering","finance","ibpe","risk","maintenance","people-office","supplier","vibe"]) assert.match(registry,new RegExp(`domain:\\s*["']${domain}["']`));
 assert.match(registry,/canonicalStores/);
 assert.match(registry,/classification/);
});

test("Vibe closure persists decisions outcomes replay comparator and certification as append-only evidence",()=>{
 for(const table of ["vyndi_vibe_decisions","vyndi_vibe_decision_events","vyndi_vibe_outcomes","vyndi_vibe_historical_replays","vyndi_vibe_comparator_observations","vyndi_vibe_certification_runs"]) {
  assert.match(migration,new RegExp(`create table if not exists ${table}`,"i"));
 }
 assert.match(migration,/foreach t in array array\[['"]vyndi_vibe_decisions['"],['"]vyndi_vibe_decision_events['"],['"]vyndi_vibe_outcomes['"],['"]vyndi_vibe_historical_replays['"],['"]vyndi_vibe_comparator_observations['"],['"]vyndi_vibe_certification_runs['"]\]/i);
 assert.match(migration,/create trigger trg_%I_append_only before update or delete on %I for each row execute function vyndi_r3_append_only_guard\(\)/i);
});

test("Vibe evidence is pinned to source evidence and exact software/model lineage",()=>{
 assert.match(migration,/evidence_refs jsonb not null/);
 assert.match(migration,/source_sha text not null/);
 assert.match(migration,/model_version text not null/);
 assert.match(migration,/actor_user_id text not null/);
 assert.match(migration,/actor_role text not null/);
 assert.match(migration,/source_reference text not null/);
});

test("outcomes and empirical studies are relationally linked instead of orphan JSON",()=>{
 assert.match(migration,/decision_id text not null references vyndi_vibe_decisions\(id\)/i);
 assert.match(migration,/outcome_id text references vyndi_vibe_outcomes\(id\)/i);
 assert.match(migration,/replay_id text references vyndi_vibe_historical_replays\(id\)/i);
});
