import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { assertNoAppliedMigrationPrefixConflicts } from "./migration-plan.mjs";

const here=dirname(fileURLToPath(import.meta.url));
const migrationsDir=join(here,"..","migrations");

test("historical applied-only migrations are explicit immutable lineage, never deployable SQL", async()=>{
  const manifest=JSON.parse(await readFile(join(migrationsDir,"MIGRATION_LINEAGE.json"),"utf8"));
  const entries=await readdir(migrationsDir,{withFileTypes:true});
  const deployable=new Set(entries.filter(entry=>entry.isFile()&&entry.name.endsWith(".sql")).map(entry=>entry.name));

  assert.equal(manifest.version,1);
  assert.ok(Array.isArray(manifest.historicalAppliedOnly));
  assert.ok(manifest.historicalAppliedOnly.length>=1);

  const seen=new Set();
  for(const record of manifest.historicalAppliedOnly){
    assert.match(record.name,/^\d{4}_[a-z0-9_]+\.sql$/);
    assert.equal(record.status,"superseded");
    assert.equal(record.databaseLedgerPolicy,"retain");
    assert.equal(record.sourceFilePolicy,"do-not-recreate");
    assert.ok(String(record.reason||"").length>=40);
    assert.equal(deployable.has(record.name),false,`${record.name} cannot be both a historical tombstone and a deployable migration`);
    assert.equal(seen.has(record.name),false,`duplicate migration lineage entry: ${record.name}`);
    seen.add(record.name);
  }

  assert.ok(seen.has("0023_operating_plan_versions.sql"),"known production-only historical migration must remain documented");
});

test("deployment refuses applied 0149 HR migration that would replace the real CRM migration",()=>{
  assert.throws(
    ()=>assertNoAppliedMigrationPrefixConflicts(
      ["0149_vaos_people_master_operational_write.sql"],
      ["0149_native_commercial_crm.sql"],
    ),
    /0149.*0149_native_commercial_crm\.sql.*0149_vaos_people_master_operational_write\.sql/,
  );
});

test("deployment refuses finance 0194/0195 branches against applied CA and BI migrations",()=>{
  assert.throws(
    ()=>assertNoAppliedMigrationPrefixConflicts(
      ["0194_finance_journal_exact_paise.sql","0195_receivables_independent_reversal.sql"],
      ["0194_ca_certificate_evidence_register.sql","0195_conversational_bi.sql"],
    ),
    /0194.*0194_ca_certificate_evidence_register\.sql.*0194_finance_journal_exact_paise\.sql/,
  );
});

test("exact matching migrations and missing historical source files remain legal",()=>{
  assert.doesNotThrow(()=>assertNoAppliedMigrationPrefixConflicts(
    ["0194_ca_certificate_evidence_register.sql","0195_conversational_bi.sql"],
    ["0194_ca_certificate_evidence_register.sql","0195_conversational_bi.sql","0023_operating_plan_versions.sql"],
  ));
});

test("approved historical duplicate prefixes remain valid and new high-numbered migrations are allowed",()=>{
  assert.doesNotThrow(()=>assertNoAppliedMigrationPrefixConflicts(
    ["0072_verified_management_actuals.sql","0196_proposed_additive.sql"],
    ["0072_advanced_planning_authority_workbench.sql","0195_conversational_bi.sql"],
  ));
});

test("deploy migrator must enforce applied-ledger prefix guard before applying SQL", async()=>{
  const text=await readFile(join(here,"migrate.mjs"),"utf8");
  assert.match(text,/assertNoAppliedMigrationPrefixConflicts\(entries, applied\)/);
  assert.ok(text.indexOf("assertNoAppliedMigrationPrefixConflicts(entries, applied)")<text.indexOf("for (const { name, path } of pendingMigrations(entries, applied))"));
});
