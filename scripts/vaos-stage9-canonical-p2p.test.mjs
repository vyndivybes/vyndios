// Stage 9 acceptance: run the REAL VYNDI SQL migrations and canonical P2P
// functions against an ephemeral WASM PostgreSQL (PGlite), never Neon/production.
// Synthetic currency/identities only; no external supplier, payment or business effects.
import assert from "node:assert/strict";
import test from "node:test";
import {readdir,readFile} from "node:fs/promises";
import {join,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {PGlite} from "@electric-sql/pglite";
import {pendingMigrations} from "./migration-plan.mjs";
import {approveInventoryMaster} from "./inventory-master-fixture.mjs";

const here=dirname(fileURLToPath(import.meta.url));
const migrationsDir=join(here,"..","migrations");
async function ephemeralCanonicalDatabase(){
 const db=new PGlite();
 await db.waitReady;
 const migrations=pendingMigrations(await readdir(migrationsDir),[]);
 for(const m of migrations)await db.exec(await readFile(join(migrationsDir,m.path),"utf8"));
 return {db,migrationCount:migrations.length};
}
const rows=r=>r.rows;
const supplier="STAGE9-SYNTHETIC-SUPPLIER",sku="STAGE9-UNIFIED-MATERIAL";
const poBySize=size=>"STAGE9-PO-"+size;
const invBySize=size=>"STAGE9-INV-"+size;
const grnBySize=size=>"STAGE9-GRN-"+size;

test("Stage 9: the actual VYNDI canonical migration-backed P2P workflow processes M/L without real writes",async t=>{
 const {db,migrationCount}=await ephemeralCanonicalDatabase();
 t.after(()=>db.close());
 assert.ok(migrationCount>=140,"must exercise full current canonical SQL schema");
 await approveInventoryMaster(db,{sku,name:"Stage 9 approved synthetic raw material",category:"test",unit:"ea"});
 await db.query(`insert into master_inventory_items
 (id,ledger_id,sku,name,category,unit,minimum_stock_level,planned_monthly_use,created_by,updated_by)
 values ('ITEM-STAGE9','components',$1,'Stage 9 approved synthetic raw material','test','ea',0,0,'synthetic-maker','synthetic-checker')`,[sku]);
 await db.query(`select upsert_vyndi_supplier($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,[
 supplier,"SYNTHETIC - DO NOT ORDER","INR",30,30,"approved",90,90,"STAGE9-NO-REAL-SUPPLIER",
 "synthetic-supplier-maker","operations","AUD-STAGE9-SUPPLIER"
 ]);
 // Different prototype frame configurations must NOT create separate item/ledger identities.
 // VYNDI's existing PO schema is keyed to a controlled material SKU, not a frame-size ledger.
 for(const [size,unitPrice] of [["M",100],["L",200]]){
  const poId=poBySize(size);
  const notes=`TEST-ONLY VYNDI Altitude configuration.frameSize=${size}; engineering/material UNFROZEN`;
  const po=await db.query(`select create_vyndi_purchase_order(
   $1,$2,$3,$4,$5,$6,$7,$8,$9::date,$10::date,$11,$12,$13,$14,$15) as id`,[
   poId,supplier,"",6,sku,"ea",1,unitPrice,"2026-10-12","2026-11-12",30,
   "SYNTHETIC-QUOTE-"+size,notes,"synthetic-maker","operations"]);
  assert.equal(rows(po)[0].id,poId);
  // No self-approval; the canonical SQL procedure must enforce SoD.
  await assert.rejects(()=>db.query(`select transition_vyndi_purchase_order($1,$2,$3,$4,$5)`,
   [poId,"approved","SYNTHETIC-APP-"+size,"synthetic-maker","operations"]),/different authorised user/i);
  const fresh=await db.query("select record_revision from vyndi_purchase_orders where id=$1",[poId]);
  assert.equal(Number(rows(fresh)[0].record_revision),1);
  await assert.rejects(()=>db.query(`select * from amend_vyndi_purchase_order(
   $1,$2,$3,$4,$5,$6::date,$7,$8,$9,$10,$11)`,
   [poId,77,supplier,1,unitPrice,"2026-11-12",30,"SYNTHETIC-STAGE9-AMEND",notes,
    "synthetic-maker","operations"]),/Stale purchase-order revision/i);
  await db.query(`select transition_vyndi_purchase_order($1,$2,$3,$4,$5)`,
   [poId,"approved","SYNTHETIC-APP-"+size,"synthetic-checker","operations"]);
  await db.query(`select transition_vyndi_purchase_order($1,$2,$3,$4,$5)`,
   [poId,"issued","SYNTHETIC-ISSUE-"+size,"synthetic-maker","operations"]);
  await db.query(`select post_vyndi_goods_receipt($1,$2,$3::date,$4,$5,$6,$7,$8,$9,$10,$11)`,
   [grnBySize(size),poId,"2026-10-13",1,1,0,"accepted","SYNTHETIC-GRN-EVIDENCE-"+size,
    "Controlled acceptance synthetic only","synthetic-receiver","operations"]);
  const invoice=await db.query(`select * from post_vyndi_supplier_invoice(
   $1,$2,$3,$4::date,$5,$6,$7,$8,$9,$10)`,
   [invBySize(size),poId,"SANDBOX-"+size,"2026-10-14",1,unitPrice,0,
    "SYNTHETIC-INVOICE-EVIDENCE-"+size,"synthetic-ap-maker","finance"]);
  assert.equal(rows(invoice)[0].match_status,"matched");
  const payable=await db.query("select status,amount_open_inr from vyndi_accounts_payable where id=$1",
   [invBySize(size)]);
  assert.equal(rows(payable)[0].status,"matched");
  assert.equal(Number(rows(payable)[0].amount_open_inr),unitPrice);
  await assert.rejects(()=>db.query(`select approve_vyndi_supplier_invoice($1,$2,$3)`,
   [invBySize(size),"synthetic-ap-maker","finance"]),/different authorised user/i);
 }
 const pos=await db.query("select id,sku,quantity,status,notes from vyndi_purchase_orders where id like 'STAGE9-PO-%' order by id");
 assert.equal(rows(pos).length,2);
 assert.deepEqual(rows(pos).map(x=>x.sku),[sku,sku]);
 assert.deepEqual(rows(pos).map(x=>Number(x.quantity)),[1,1]);
 assert.deepEqual(rows(pos).map(x=>x.status),["received","received"]);
 assert.ok(rows(pos).some(x=>x.notes.includes("configuration.frameSize=M")));
 assert.ok(rows(pos).some(x=>x.notes.includes("configuration.frameSize=L")));
 const inventory=await db.query(`select sku,unit,physical_quantity from vyndi_inventory_available_to_promise where sku=$1`,[sku]);
 assert.equal(rows(inventory).length,1,"one canonical shared material inventory, not two size ledgers");
 assert.equal(Number(rows(inventory)[0].physical_quantity),2);
 const invoiced=await db.query("select count(*)::int as count from vyndi_supplier_invoices where id like 'STAGE9-INV-%' and status='matched'");
 assert.equal(Number(rows(invoiced)[0].count),2);
 const payment=await db.query(`select count(*)::int as count from vyndi_supplier_payments`);
 assert.equal(Number(rows(payment)[0].count),0,"not a single payable or bank effect");
 const audit=await db.query(`select count(*)::int as count from vyndi_audit_events
   where entity_id like 'STAGE9-%' and entity_type in ('purchase_order','goods_receipt','supplier_invoice')`);
 assert.ok(Number(rows(audit)[0].count)>=6);
 // Native canonical invoice mismatch must be blocked and unapprovable.
 const blocked=await db.query(`select * from post_vyndi_supplier_invoice(
  $1,$2,$3,$4::date,$5,$6,$7,$8,$9,$10)`,
  ["STAGE9-MISMATCH","STAGE9-PO-M","SANDBOX-MISMATCH","2026-10-14",1,999,0,
   "SYNTHETIC-MISMATCH-EVIDENCE","synthetic-ap-maker","finance"]);
 assert.equal(rows(blocked)[0].match_status,"blocked");
 await assert.rejects(()=>db.query(`select approve_vyndi_supplier_invoice($1,$2,$3)`,
  ["STAGE9-MISMATCH","synthetic-ap-checker","finance"]),/three-way-matched/i);
 assert.equal(Number(rows((await db.query("select count(*)::int as count from vyndi_supplier_payments")))[0].count),0);
});
