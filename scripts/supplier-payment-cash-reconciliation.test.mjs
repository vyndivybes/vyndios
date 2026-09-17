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

async function seedVerifiedCash(db, planMonth = 1, closingCashLakh = 10) {
  await db.query(
    `select save_vyndi_monthly_actual($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [planMonth,null,null,null,null,closingCashLakh,null,null,null,`TEST-CASH-M${planMonth}`,true,"cash-controller","finance"],
  );
}

async function seedApprovedSupplierInvoice(db) {
  await db.query(`insert into vyndi_suppliers
    (id,name,currency,payment_terms_days,lead_time_days,approval_status,source_reference,created_by,updated_by)
    values('SUP-CASH','Cash Test Supplier','INR',30,30,'approved','SUP-EVIDENCE','buyer','buyer')`);
  await db.query(`insert into vyndi_purchase_orders
    (id,supplier_id,requirement_month,sku,unit,quantity,unit_price_inr,order_date,expected_receipt_on,
     payment_terms_days,status,source_reference,notes,created_by,updated_by)
    values('PO-CASH','SUP-CASH',1,'TEST-PAY-SKU','ea',1,10000,'2026-09-01','2026-09-05',30,
           'approved','PO-EVIDENCE','','buyer','buyer')`);
  await db.query(`insert into vyndi_supplier_invoices
    (id,purchase_order_id,invoice_number,invoice_on,due_on,quantity_invoiced,amount_ex_gst_inr,gst_inr,
     status,match_message,source_reference,created_by)
    values('AP-CASH','PO-CASH','SUPINV-CASH','2026-09-10','2026-10-10',1,10000,0,
           'approved','Controlled test invoice','AP-EVIDENCE','ap-user')`);
}

test("controlled supplier payment moves AP, Bank and verified canonical cash together and reverses symmetrically", async (t) => {
  const db = await createDb(); t.after(() => db.close());
  await seedVerifiedCash(db,1,10);
  await seedApprovedSupplierInvoice(db);

  const posted = await db.query(
    `select * from post_vyndi_supplier_payment($1,$2,$3,$4::date,$5,$6,$7,$8)`,
    ["PAY-CASH-1","AP-CASH",1,"2026-09-17",2500,"UTR-CASH-001","payer","finance"],
  );
  assert.equal(posted.rows[0].payment_id,"PAY-CASH-1");
  assert.equal(posted.rows[0].invoice_status,"part_paid");
  assert.equal(Number(posted.rows[0].new_closing_cash_lakh),9.975);

  const payment = await db.query(`select plan_month,cash_evidence_reference,journal_id,cash_actual_revision,status from vyndi_supplier_payments where id='PAY-CASH-1'`);
  assert.equal(Number(payment.rows[0].plan_month),1);
  assert.equal(payment.rows[0].cash_evidence_reference,"UTR-CASH-001");
  assert.ok(payment.rows[0].journal_id);
  assert.ok(Number(payment.rows[0].cash_actual_revision)>0);
  assert.equal(payment.rows[0].status,"posted");

  const journal = await db.query(`select account_code,debit_inr,credit_inr from epr_finance_journal_lines where journal_id=$1 order by line_no`,[payment.rows[0].journal_id]);
  assert.deepEqual(journal.rows.map((row)=>[row.account_code,Number(row.debit_inr),Number(row.credit_inr)]),[["2000",2500,0],["1000",0,2500]]);
  const actual = await db.query(`select closing_cash from vyndi_monthly_actuals where plan_month=1`);
  assert.equal(Number(actual.rows[0].closing_cash),9.975);

  await assert.rejects(
    () => db.query(`select * from post_vyndi_supplier_payment($1,$2,$3,$4::date,$5,$6,$7,$8)`,["PAY-CASH-2","AP-CASH",1,"2026-09-17",100,"UTR-CASH-001","payer","finance"]),
    /evidence\/reference has already been used/i,
  );
  await assert.rejects(
    () => db.query(`select post_vyndi_supplier_payment($1,$2,$3::date,$4,$5,$6,$7)`,["PAY-LEGACY-BLOCK","AP-CASH","2026-09-17",100,"UTR-LEGACY","payer","finance"]),
    /Explicit supplier-payment cash plan month is required/i,
  );

  const reversed = await db.query(`select reverse_vyndi_supplier_payment($1,$2::date,$3,$4,$5) as revision`,["PAY-CASH-1","2026-09-18","Bank payment cancelled","approver","finance"]);
  assert.equal(Number(reversed.rows[0].revision),2);
  const reversedPayment = await db.query(`select status,cash_reversal_revision,reversed_closing_cash_lakh from vyndi_supplier_payments where id='PAY-CASH-1'`);
  assert.equal(reversedPayment.rows[0].status,"reversed");
  assert.ok(Number(reversedPayment.rows[0].cash_reversal_revision)>0);
  assert.equal(Number(reversedPayment.rows[0].reversed_closing_cash_lakh),10);
  const invoice = await db.query(`select status from vyndi_supplier_invoices where id='AP-CASH'`);
  assert.equal(invoice.rows[0].status,"approved");
  const restored = await db.query(`select closing_cash from vyndi_monthly_actuals where plan_month=1`);
  assert.equal(Number(restored.rows[0].closing_cash),10);
  const reversalJournal = await db.query(`select count(*)::int as count from epr_finance_journals where source_type='supplier_payment_reversal' and source_id='PAY-CASH-1' and status='posted'`);
  assert.equal(Number(reversalJournal.rows[0].count),1);
});

test("hard close requires Statement = Bank GL = verified canonical VIBPE cash with explicit plan-month mapping", async (t) => {
  const db = await createDb(); t.after(() => db.close());
  await seedVerifiedCash(db,1,10);

  await db.query(`insert into epr_finance_bank_reconciliation_sessions
    (id,bank_account_ref,period,plan_month,opening_balance_inr,closing_balance_inr,statement_movement_inr,
     book_movement_inr,book_closing_balance_inr,difference_inr,status,evidence_reference,prepared_by,approved_by,approved_at)
    values('REC-CASH-OK','BANK-01','2026-09',1,1000000,1000000,0,0,1000000,0,'reconciled','BANK-STATEMENT-OK','preparer','approver',now())`);
  await db.query(`insert into epr_finance_period_closures(period,status,evidence_reference,updated_by) values('2026-09','hard_closed','CLOSE-EVIDENCE','approver')`);
  const closed = await db.query(`select status from epr_finance_period_closures where period='2026-09'`);
  assert.equal(closed.rows[0].status,"hard_closed");

  await db.query(`insert into epr_finance_bank_reconciliation_sessions
    (id,bank_account_ref,period,plan_month,opening_balance_inr,closing_balance_inr,statement_movement_inr,
     book_movement_inr,book_closing_balance_inr,difference_inr,status,evidence_reference,prepared_by,approved_by,approved_at)
    values('REC-CASH-BAD','BANK-01','2026-10',1,900000,900000,0,0,900000,0,'reconciled','BANK-STATEMENT-BAD','preparer','approver',now())`);
  await assert.rejects(
    () => db.query(`insert into epr_finance_period_closures(period,status,evidence_reference,updated_by) values('2026-10','hard_closed','CLOSE-BAD','approver')`),
    /does not equal M1 canonical cash/i,
  );

  await db.query(`insert into epr_finance_bank_reconciliation_sessions
    (id,bank_account_ref,period,opening_balance_inr,closing_balance_inr,statement_movement_inr,
     book_movement_inr,difference_inr,status,evidence_reference,prepared_by,approved_by,approved_at)
    values('REC-CASH-NOMAP','BANK-01','2026-11',1000000,1000000,0,0,0,'reconciled','BANK-STATEMENT-NOMAP','preparer','approver',now())`);
  await assert.rejects(
    () => db.query(`insert into epr_finance_period_closures(period,status,evidence_reference,updated_by) values('2026-11','hard_closed','CLOSE-NOMAP','approver')`),
    /explicit governed VIBPE plan-month mapping/i,
  );
});

test("UI/server authorities expose explicit month, evidence uniqueness and three-way cash controls", async () => {
  const migration = await readFile(join(root,"migrations/0083_supplier_payment_cash_reconciliation.sql"),"utf8");
  const paymentAuthority = await readFile(join(root,"src/lib/supplier-payment-cash-authority.ts"),"utf8");
  const reconciliationAuthority = await readFile(join(root,"src/lib/finance/cash-reconciliation-authority.ts"),"utf8");
  const payablesRoute = await readFile(join(root,"src/routes/command/payables.tsx"),"utf8");
  const statutoryRoute = await readFile(join(root,"src/routes/command/accounting/statutory.tsx"),"utf8");

  assert.match(migration,/Supplier payment cash plan month must be between 1 and 36/);
  assert.match(migration,/cash_evidence_reference/);
  assert.match(migration,/apply_vyndi_verified_cash_movement/);
  assert.match(migration,/supplier-payment-reversal/);
  assert.match(migration,/statement closing balance/i);
  assert.match(migration,/canonical closing-cash evidence/);
  assert.match(paymentAuthority,/paymentPlanMonth: z\.number\(\)\.int\(\)\.min\(1\)\.max\(36\)/);
  assert.match(paymentAuthority,/requireActor\("approve"\)/);
  assert.match(reconciliationAuthority,/planMonth: z\.number\(\)\.int\(\)\.min\(1\)\.max\(36\)/);
  assert.match(reconciliationAuthority,/does not equal M\$\{planMonth\} canonical cash/);
  assert.match(payablesRoute,/never inferred from the calendar payment date/);
  assert.match(statutoryRoute,/does not convert the calendar finance period into M1–M36 automatically/);
  assert.match(statutoryRoute,/Statement closing = Bank 1000 closing = verified canonical VIBPE cash/);
});
