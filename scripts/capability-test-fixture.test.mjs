import assert from "node:assert/strict";
import test from "node:test";
import { readFile,readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { pendingMigrations } from "./migration-plan.mjs";
import { seedCapabilityFixture } from "./capability-test-fixture.mjs";
test("four synthetic orders reconcile without stock, PO or finance postings; reseed refuses overwrite",async(t)=>{
  const db=new PGlite(); await db.waitReady; t.after(()=>db.close());
  for(const m of pendingMigrations(await readdir("migrations"),[])) await db.exec(await readFile("migrations/"+m.path,"utf8"));
  const result=await seedCapabilityFixture(db,{operatingPlan:{testOnly:true}});
  assert.equal(result.orders,4); assert.equal(result.physicalApproval,false);
  assert.match(result.inputHash,/^[a-f0-9]{64}$/);
  const orders=await db.query(`select o.id,o.revision,c.sales_order_revision,c.bom_revision,c.status
    from vyndi_sales_orders o join epr_production_job_cards c on c.sales_order_id=o.id order by o.id`);
  assert.equal(orders.rows.length,4);
  for(const r of orders.rows){assert.equal(Number(r.revision),Number(r.sales_order_revision));assert.equal(r.bom_revision,"CAP-TEST-BOM-R1");assert.equal(r.status,"released");}
  for(const table of ["epr_inventory_ledger","vyndi_purchase_orders","vyndi_invoices","vyndi_collections"]){
    assert.equal(Number((await db.query("select count(*) as count from "+table)).rows[0].count),0,table);
  }
  const requirements=await db.query("select sum(committed_requirement) as total from vyndi_committed_procurement_requirements where sku='CAP-TEST-SKU'");
  assert.equal(Number(requirements.rows[0].total),4);
  await assert.rejects(()=>seedCapabilityFixture(db,{}),/requires empty orders and plans/);
});
