import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pendingMigrations } from "./migration-plan.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const migrationsDir = join(root, "migrations");

async function createDb() {
  const db = new PGlite();
  await db.waitReady;
  const files = await readdir(migrationsDir);
  for (const migration of pendingMigrations(files, [])) {
    await db.exec(await readFile(join(migrationsDir, migration.path), "utf8"));
  }
  return db;
}

async function seedCash(db, closingCashLakh = 10) {
  await db.query(
    `select save_vyndi_monthly_actual($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [1,null,null,null,null,closingCashLakh,null,null,null,"RETURNS-TEST-CASH",true,"cash-controller","finance"],
  );
}

async function seedInventoryItem(db, { id, sku, name }) {
  await db.query(
    `insert into master_inventory_items
      (id,ledger_id,sku,name,category,unit,minimum_stock_level,planned_monthly_use,active,created_by,updated_by)
     values($1,'components',$2,$3,'Test','ea',0,0,true,'test','test')`,
    [id,sku,name],
  );
}

test("customer RMA -> credit note -> refund preserves original invoice and nets AR/GST/cash", async (t) => {
  const db = await createDb(); t.after(() => db.close());
  await seedCash(db,10);
  await seedInventoryItem(db,{ id:"ITEM-CUST-RET",sku:"TEST-CUST-RET",name:"Customer Return Test Part" });

  await db.query(
    `select * from post_vyndi_inventory_receipt($1,$2,$3,$4,$5,$6,$7::date,$8,$9,$10,$11)`,
    ["REC-CUST-BASE","LED-CUST-BASE","TEST-CUST-RET",2,"ea",1000,"2026-09-01","CUST-STOCK-EVID","test stock","stores","stores"],
  );
  const sale = await db.query(
    `select * from post_vyndi_spare_sale_dispatch($1,$2,$3,$4,$5,$6,$7::date,$8,$9::uuid,$10,$11)`,
    ["SPARE-CUST-1",1,"ITEM-CUST-RET",1,2000,"direct","2026-09-02","CUST-SALE-EVID",null,"sales","sales"],
  );
  assert.equal(Number(sale.rows[0].fifo_cost_inr),1000);

  await db.query(
    `insert into vyndi_invoices(
      id,plan_month,units,asp_lakh,amount_lakh,status,source_reference,issued_by,
      sale_type,spare_sale_id,recipient_name,recipient_address,delivery_address,place_of_supply_code,
      hsn_sac,item_description,unit_code,taxable_value_inr,tax_rate_pct,tax_mode,cgst_inr,sgst_inr,
      igst_inr,cess_inr,gst_inr,gross_amount_inr,reverse_charge,e_invoice_required,tax_evidence_reference,
      tax_profile_status,credit_terms_days,due_on,credit_terms_reference,credit_profile_status)
     values(
      'INV-CUST-RET',1,1,0.0200,0.0200,'issued','INV-CUST-EVID','finance',
      'spare_component','SPARE-CUST-1','Test Customer','Address','Address','33',
      '8714','Test component','NOS',2000,18,'cgst_sgst',180,180,0,0,360,2360,false,false,'TAX-CUST-EVID',
      'complete',0,'2026-09-02','TERMS-CUST','controlled')`
  );

  await db.query(
    `select post_vyndi_collection($1,$2,$3,$4,$5,$6,$7)`,
    ["COL-CUST-RET","INV-CUST-RET",1,0.0236,"UTR-COL-CUST","collector","finance"],
  );

  const returned = await db.query(
    `select * from post_vyndi_customer_return($1,$2,$3,$4::date,$5,$6,$7::uuid,$8,$9,$10,$11)`,
    ["RMA-CUST-1","INV-CUST-RET",1,"2026-09-03",1,"quarantine",null,"Customer return test","RMA-CUST-EVID","returns","sales"],
  );
  assert.equal(Number(returned.rows[0].restored_cogs_inr),0);

  const note = await db.query(
    `select * from issue_vyndi_customer_credit_note($1,$2,$3::date,$4,$5,$6)`,
    ["CN-CUST-1","RMA-CUST-1","2026-09-03","CN-CUST-EVID","approver","finance"],
  );
  assert.equal(Number(note.rows[0].gross_amount_inr),2360);
  assert.equal(Number(note.rows[0].refund_due_inr),2360);

  const gst = await db.query(
    `select taxable_value_inr,gst_inr from epr_finance_gst_ledger where source_type='customer_credit_note' and source_id='CN-CUST-1'`,
  );
  assert.equal(Number(gst.rows[0].taxable_value_inr),-2000);
  assert.equal(Number(gst.rows[0].gst_inr),-360);

  const refund = await db.query(
    `select * from post_vyndi_customer_refund($1,$2,$3,$4::date,$5,$6,$7,$8)`,
    ["REF-CUST-1","CN-CUST-1",1,"2026-09-04",2360,"UTR-REF-CUST","approver","finance"],
  );
  assert.equal(Number(refund.rows[0].new_closing_cash_lakh),10);

  const invoice = await db.query(`select status from vyndi_invoices where id='INV-CUST-RET'`);
  assert.equal(invoice.rows[0].status,"issued");
  const ledger = await db.query(`select balance_inr,refund_due_inr,credit_note_gross_inr,refunded_inr from vyndi_report_sales_ledger where invoice_id='INV-CUST-RET'`);
  assert.equal(Number(ledger.rows[0].balance_inr),0);
  assert.equal(Number(ledger.rows[0].refund_due_inr),0);
  assert.equal(Number(ledger.rows[0].credit_note_gross_inr),2360);
  assert.equal(Number(ledger.rows[0].refunded_inr),2360);
});

test("supplier GRN return -> debit note -> recoverable -> refund preserves FIFO and nets AP/ITC/cash", async (t) => {
  const db = await createDb(); t.after(() => db.close());
  await seedCash(db,10);
  await seedInventoryItem(db,{ id:"ITEM-SUP-RET",sku:"TEST-SUP-RET",name:"Supplier Return Test Part" });

  await db.query(`insert into vyndi_suppliers
    (id,name,currency,payment_terms_days,lead_time_days,approval_status,source_reference,created_by,updated_by)
    values('SUP-RET','Return Supplier','INR',30,30,'approved','SUP-RET-EVID','buyer','buyer')`);
  await db.query(`insert into vyndi_purchase_orders
    (id,supplier_id,requirement_month,sku,unit,quantity,unit_price_inr,order_date,expected_receipt_on,
     payment_terms_days,status,source_reference,notes,created_by,updated_by)
    values('PO-RET','SUP-RET',1,'TEST-SUP-RET','ea',2,1000,'2026-09-01','2026-09-02',30,
           'issued','PO-RET-EVID','','buyer','buyer')`);

  await db.query(
    `select post_vyndi_goods_receipt($1,$2,$3::date,$4,$5,$6,$7,$8,$9,$10,$11)`,
    ["GRN-RET","PO-RET","2026-09-02",2,2,0,"accepted","GRN-RET-EVID","","stores","stores"],
  );
  await db.query(`insert into vyndi_supplier_invoices(
    id,purchase_order_id,invoice_number,invoice_on,due_on,quantity_invoiced,amount_ex_gst_inr,gst_inr,
    status,match_message,source_reference,created_by,supplier_gstin,hsn_sac,tax_rate_pct,cgst_inr,sgst_inr,
    igst_inr,cess_inr,itc_eligible,itc_control_status,itc_evidence_reference,gstr2b_reference)
    values('AP-RET','PO-RET','SINV-RET','2026-09-02','2026-10-02',2,2000,360,
      'approved','Matched','AP-RET-EVID','ap','33ABCDE1234F1Z5','8714',18,180,180,0,0,true,'verified','ITC-RET-EVID','2B-RET')`);

  const payment = await db.query(
    `select * from post_vyndi_supplier_payment($1,$2,$3,$4::date,$5,$6,$7,$8)`,
    ["PAY-RET","AP-RET",1,"2026-09-03",2360,"UTR-PAY-RET","payer","finance"],
  );
  assert.equal(Number(payment.rows[0].new_closing_cash_lakh),9.9764);

  const returned = await db.query(
    `select * from post_vyndi_supplier_return_debit_note($1,$2,$3,$4,$5::date,$6,$7,$8,$9,$10)`,
    ["RTV-RET","AP-RET","GRN-RET",1,"2026-09-04",1,"DN-RET-001","RTV-EVID","approver","finance"],
  );
  assert.equal(Number(returned.rows[0].fifo_cost_inr),1000);
  assert.equal(Number(returned.rows[0].gross_amount_inr),1180);
  assert.equal(Number(returned.rows[0].ap_offset_inr),0);
  assert.equal(Number(returned.rows[0].recoverable_inr),1180);

  const gst = await db.query(`select taxable_value_inr,gst_inr,eligible_itc from epr_finance_gst_ledger where source_type='supplier_debit_note' and source_id='RTV-RET'`);
  assert.equal(Number(gst.rows[0].taxable_value_inr),-1000);
  assert.equal(Number(gst.rows[0].gst_inr),-180);
  assert.equal(gst.rows[0].eligible_itc,true);

  const ap = await db.query(`select amount_open_inr,supplier_recoverable_inr from vyndi_accounts_payable where id='AP-RET'`);
  assert.equal(Number(ap.rows[0].amount_open_inr),0);
  assert.equal(Number(ap.rows[0].supplier_recoverable_inr),1180);

  const refund = await db.query(
    `select * from post_vyndi_supplier_refund($1,$2,$3,$4::date,$5,$6,$7,$8)`,
    ["SUP-REF-RET","RTV-RET",1,"2026-09-05",1180,"UTR-SUP-REF-RET","approver","finance"],
  );
  assert.equal(Number(refund.rows[0].new_closing_cash_lakh),9.9882);
  const recovered = await db.query(`select supplier_recoverable_inr from vyndi_accounts_payable where id='AP-RET'`);
  assert.equal(Number(recovered.rows[0].supplier_recoverable_inr),0);

  const alloc = await db.query(`select source_ledger.movement_id
    from epr_inventory_fifo_allocations a
    join epr_inventory_fifo_layers fl on fl.id=a.layer_id
    join epr_inventory_ledger source_ledger on source_ledger.id=fl.source_ledger_id
    where a.issue_ledger_id='SUP-RET-LED-RTV-RET'`);
  assert.deepEqual(alloc.rows.map((row)=>row.movement_id),["REC-GRN-RET"]);
});

test("source authorities expose non-destructive returns and explicit cash-month boundaries", async () => {
  const migration = await readFile(join(root,"migrations/0085_returns_credit_debit_notes.sql"),"utf8");
  const salesAuthority = await readFile(join(root,"src/lib/sales-ledger-authority.ts"),"utf8");
  const payablesAuthority = await readFile(join(root,"src/lib/procure-to-pay-authority.ts"),"utf8");
  const salesRoute = await readFile(join(root,"src/routes/command/sales-ledger.tsx"),"utf8");
  const payablesRoute = await readFile(join(root,"src/routes/command/payables.tsx"),"utf8");
  assert.match(migration,/Original invoices, dispatches, GRNs and payments remain immutable audit history/);
  assert.match(migration,/Customer refund cash plan month must be between 1 and 36/);
  assert.match(migration,/Supplier refund cash plan month must be between 1 and 36/);
  assert.match(migration,/Supplier return is blocked because FIFO allocation does not belong exclusively to the selected GRN/);
  assert.match(migration,/'1400'.*Supplier recoverable/s);
  assert.match(salesAuthority,/issue_vyndi_customer_credit_note/);
  assert.match(salesAuthority,/post_vyndi_customer_refund/);
  assert.match(payablesAuthority,/post_vyndi_supplier_return_debit_note/);
  assert.match(payablesAuthority,/post_vyndi_supplier_refund/);
  assert.match(salesRoute,/Quarantine\/scrap never silently increase available stock/);
  assert.match(payablesRoute,/Debit note offsets AP first; any excess becomes Supplier Recoverable/);
});
