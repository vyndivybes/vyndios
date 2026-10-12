import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pendingMigrations } from "./migration-plan.mjs";
import { DAY1_TECHNICAL_QUERY, assessDay1TechnicalHealth } from "../src/lib/finance/bookkeeping-day1-operational.ts";

const root=join(dirname(fileURLToPath(import.meta.url)),"..");
test("actual migrated empty PostgreSQL qualifies Day-1 technical integrity before any completed period",async(t)=>{
  const db=new PGlite();
  t.after(()=>db.close());
  await db.waitReady;
  const files=await readdir(join(root,"migrations"));
  for (const m of pendingMigrations(files,[])) {
    await db.exec(await readFile(join(root,"migrations",m.path),"utf8"));
  }
  const {rows}=await db.query(DAY1_TECHNICAL_QUERY);
  const health=assessDay1TechnicalHealth(rows[0]);
  assert.equal(health.state,"TECHNICAL_CONTROLS_PASS",JSON.stringify(health));
  assert.equal(Number(rows[0].active_audit_tables),12);
  assert.equal(Number(rows[0].active_journal_guards),3);
  const noClose=await db.query("select count(*)::int as count from epr_finance_period_closures");
  const noRecon=await db.query("select count(*)::int as count from epr_finance_bank_reconciliation_sessions");
  const noStocktake=await db.query("select count(*)::int as count from epr_inventory_stocktakes");
  assert.equal(noClose.rows[0].count,0);
  assert.equal(noRecon.rows[0].count,0);
  assert.equal(noStocktake.rows[0].count,0);
});
