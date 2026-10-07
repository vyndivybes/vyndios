import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

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
