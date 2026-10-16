import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { z } from "zod";
import { PGlite } from "@electric-sql/pglite";
import { pendingMigrations } from "./migration-plan.mjs";
import { approveInventoryMaster } from "./inventory-master-fixture.mjs";
import { buildPayablesAgingReport, loadPayablesAgingReport, PAYABLES_SNAPSHOT_SQL } from "../src/lib/finance/payables-report.ts";

const invoice = { id: "I", partyId: "SUP", issueDate: "2026-09-10", dueDate: "2026-10-10", amountInr: 100, status: "approved" };
const journal = (id, sourceType, sourceId, entryDate, amount, reversedEntryId) => ({ id, sourceType, sourceId, entryDate,
  description: "Synthetic", status: "posted", reversedEntryId,
  lines: amount > 0 ? [{ accountCode: "1200", debitInr: amount }, { accountCode: "2000", creditInr: amount }]
    : [{ accountCode: "2000", debitInr: -amount }, { accountCode: "1000", creditInr: -amount }] });
const base = () => ({ invoices: [invoice], payments: [], returns: [], journals: [journal("JI", "supplier_invoice", "I", invoice.issueDate, 100)] });

test("historical payment reversal uses effective journal date instead of today's reversed status", () => {
  const snapshot = base();
  snapshot.payments.push({ id: "P", invoiceId: "I", postedDate: "2026-09-15", amountInr: 25, status: "reversed" });
  snapshot.journals.push(journal("JP", "supplier_payment", "P", "2026-09-15", -25), journal("JR", "supplier_payment_reversal", "P", "2026-09-20", 25, "JP"));
  assert.equal(buildPayablesAgingReport(snapshot, "2026-09-14").aging.totalOutstandingInr, 100);
  const prior = buildPayablesAgingReport(snapshot, "2026-09-19");
  assert.equal(prior.aging.totalOutstandingInr, 75);
  assert.equal(prior.reconciliation.reconciled, true);
  const after = buildPayablesAgingReport(snapshot, "2026-09-20");
  assert.equal(after.aging.totalOutstandingInr, 100);
  assert.equal(after.reconciliation.reconciled, true);
});

test("supplier debit note reduces only AP offset and unmapped control postings remain a difference", () => {
  const snapshot = base();
  snapshot.returns.push({ id: "DN", invoiceId: "I", postedDate: "2026-09-16", amountInr: 30 });
  snapshot.journals.push(journal("JN", "supplier_return_debit_note", "DN", "2026-09-16", -30));
  const report = buildPayablesAgingReport(snapshot, "2026-10-16");
  assert.equal(report.aging.totalOutstandingInr, 70);
  assert.equal(report.aging.buckets.overdue1To30Inr, 70);
  assert.equal(report.reconciliation.reconciled, true);
  snapshot.journals.push(journal("OPEN", "opening", "opening", "2026-09-01", 9));
  const difference = buildPayablesAgingReport(snapshot, "2026-10-16").reconciliation;
  assert.equal(difference.reconciled, false);
  assert.equal(difference.differenceInr, 9);
});

test("void status does not remove historical invoice before its posted reversal", () => {
  const snapshot = base();
  snapshot.invoices[0] = { ...invoice, status: "void" };
  snapshot.journals.push(journal("VOID", "supplier_invoice_reversal", "I", "2026-10-01", -100, "JI"));
  assert.equal(buildPayablesAgingReport(snapshot, "2026-09-30").aging.totalOutstandingInr, 100);
  const report = buildPayablesAgingReport(snapshot, "2026-10-01");
  assert.equal(report.aging.totalOutstandingInr, 0);
  assert.equal(report.reconciliation.reconciled, true);
});

test("source mismatches, missing posting evidence and malformed reversals fail closed", () => {
  const missing = base(); missing.journals = [];
  assert.throws(() => buildPayablesAgingReport(missing, "2026-10-16"), /Missing posted supplier invoice/);
  const wrong = base(); wrong.invoices[0] = { ...invoice, amountInr: 99 };
  assert.throws(() => buildPayablesAgingReport(wrong, "2026-10-16"), /source\/ledger mismatch/);
  const noDue = base(); noDue.invoices[0] = { ...invoice, dueDate: "" };
  assert.throws(() => buildPayablesAgingReport(noDue, "2026-10-16"), /date/i);
  const missingPayment = base(); missingPayment.payments = [{ id: "P", invoiceId: "I", postedDate: "2026-09-15", amountInr: 1, status: "posted" }];
  assert.throws(() => buildPayablesAgingReport(missingPayment, "2026-10-16"), /Missing posted allocation/);
  const partialReversal = base(); partialReversal.journals.push(journal("R", "supplier_invoice_reversal", "I", "2026-10-01", -99, "JI"));
  assert.throws(() => buildPayablesAgingReport(partialReversal, "2026-10-16"), /Invalid payable reversal/);
  const noReversal = base(); noReversal.payments.push({ id: "P", invoiceId: "I", postedDate: "2026-09-15", amountInr: 25, status: "reversed" });
  noReversal.journals.push(journal("JP", "supplier_payment", "P", "2026-09-15", -25));
  assert.throws(() => buildPayablesAgingReport(noReversal, "2026-10-16"), /Missing allocation reversal/);
});

test("report authority validates date and denies unauthorized callers before opening database", async () => {
  const source = await readFile(new URL("../src/lib/finance/payables-report-authority.ts", import.meta.url), "utf8");
  const code = ts.transpileModule(source.replace(/^import .*;\r?$/gm, ""), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  let role = null; let opened = 0; let allowed = false;
  const createServerFn = ({ method }) => {
    assert.equal(method, "GET");
    return { validator: schema => ({ handler: handler => async input => handler({ data: schema.parse(input.data) }) }) };
  };
  const exports = {};
  new Function("exports", "createServerFn", "z", "getCommandRole", "getSql", "canPerform", "getRouteMeta", "loadPayablesAgingReport", code)(
    exports, createServerFn, z, async () => role, async () => { opened++; return {}; },
    (actualRole, permission, meta) => { assert.equal(actualRole, role); assert.equal(permission, "view"); assert.equal(meta.path, "/command/payables"); return allowed; },
    path => ({ path }), async (_sql, asOfDate) => ({ asOfDate }));
  for (const value of [null, "sales"]) {
    role = value;
    await assert.rejects(() => exports.getPayablesAgingReport({ data: { asOfDate: "2026-10-16" } }), /permission denied/);
  }
  assert.equal(opened, 0);
  role = "finance"; allowed = true;
  await assert.rejects(() => exports.getPayablesAgingReport({ data: { asOfDate: "2026-02-30" } }));
  assert.equal(opened, 0);
  assert.deepEqual(await exports.getPayablesAgingReport({ data: { asOfDate: "2026-10-16" } }), { asOfDate: "2026-10-16" });
  assert.equal(opened, 1);
});

test("database report reconstructs payment reversal, debit-note offset and recoverable without changing books", async t => {
  const db = new PGlite(); t.after(() => db.close());
  await db.waitReady;
  const migrations = new URL("../migrations/", import.meta.url);
  for (const migration of pendingMigrations(await readdir(migrations), [])) await db.exec(await readFile(new URL(migration.path, migrations), "utf8"));
  await db.query(`select save_vyndi_monthly_actual($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [1,null,null,null,null,10,null,null,null,"AGING-CASH",true,"controller","finance"]);
  await approveInventoryMaster(db, { sku: "AGING-SKU", name: "Ageing test item", category: "Test", unit: "ea" });
  await db.query(`insert into master_inventory_items(id,ledger_id,sku,name,category,unit,minimum_stock_level,planned_monthly_use,active,created_by,updated_by)
    values('AGING-ITEM','components','AGING-SKU','Ageing test item','Test','ea',0,0,true,'test','test')`);
  await db.exec(`insert into vyndi_suppliers(id,name,currency,payment_terms_days,lead_time_days,approval_status,source_reference,created_by,updated_by)
      values('AGING-SUP','Ageing supplier','INR',30,30,'approved','SUP-EVID','buyer','buyer');
    insert into vyndi_purchase_orders(id,supplier_id,requirement_month,sku,unit,quantity,unit_price_inr,order_date,expected_receipt_on,payment_terms_days,status,source_reference,notes,created_by,updated_by)
      values('AGING-PO','AGING-SUP',1,'AGING-SKU','ea',2,1000,'2026-09-01','2026-09-02',30,'issued','PO-EVID','','buyer','buyer')`);
  await db.query(`select post_vyndi_goods_receipt($1,$2,$3::date,$4,$5,$6,$7,$8,$9,$10,$11)`,
    ["AGING-GRN","AGING-PO","2026-09-02",2,2,0,"accepted","GRN-EVID","","stores","stores"]);
  await db.exec(`insert into vyndi_supplier_invoices(id,purchase_order_id,invoice_number,invoice_on,due_on,quantity_invoiced,amount_ex_gst_inr,gst_inr,status,match_message,source_reference,created_by)
    values('AGING-INV','AGING-PO','AGING-NO','2026-09-02','2026-10-02',2,2000,0,'approved','Test match','INV-EVID','ap')`);
  const sql = { query: async (text, params) => (await db.query(text, params)).rows };
  assert.equal((await loadPayablesAgingReport(sql, "2026-09-01")).aging.totalOutstandingInr, 0);
  await db.query(`select * from post_vyndi_supplier_payment($1,$2,$3,$4::date,$5,$6,$7,$8)`,
    ["AGING-PAY","AGING-INV",1,"2026-09-03",500,"UTR-AGING","payer","finance"]);
  await assert.rejects(() => db.query(`select reverse_vyndi_supplier_payment($1,$2::date,$3,$4,$5)`,
    ["AGING-PAY","2026-09-04","test","payer","finance"]), /different authorised user/i);
  await db.query(`select reverse_vyndi_supplier_payment($1,$2::date,$3,$4,$5)`,
    ["AGING-PAY","2026-09-04","test reversal","checker","finance"]);
  assert.equal((await loadPayablesAgingReport(sql, "2026-09-03")).aging.totalOutstandingInr, 1500);
  assert.equal((await loadPayablesAgingReport(sql, "2026-09-04")).aging.totalOutstandingInr, 2000);
  await db.query(`select * from post_vyndi_supplier_return_debit_note($1,$2,$3,$4,$5::date,$6,$7,$8,$9,$10)`,
    ["AGING-RET","AGING-INV","AGING-GRN",1,"2026-09-05",1,"AGING-DN","AGING-RTV-EVID","checker","finance"]);
  const before = await db.query(`select (select count(*) from epr_finance_journals) as journals,(select count(*) from vyndi_books_edit_audit) as audit`);
  let queries = 0;
  const report = await loadPayablesAgingReport({ query: async (text, params) => { queries++; assert.equal(text, PAYABLES_SNAPSHOT_SQL); return sql.query(text, params); } }, "2026-10-16");
  assert.equal(queries, 1);
  assert.equal(report.aging.totalOutstandingInr, 1000);
  assert.equal(report.aging.buckets.overdue1To30Inr, 1000);
  assert.equal(report.reconciliation.reconciled, true);
  assert.equal(report.reconciliation.differenceInr, 0);
  assert.equal(report.diagnosticOnly, true);
  assert.deepEqual(await db.query(`select (select count(*) from epr_finance_journals) as journals,(select count(*) from vyndi_books_edit_audit) as audit`), before);
  assert.equal((await loadPayablesAgingReport(sql, "2026-09-04")).aging.totalOutstandingInr, 2000);
  await db.query(`select * from post_vyndi_supplier_payment($1,$2,$3,$4::date,$5,$6,$7,$8)`,
    ["AGING-PAY2","AGING-INV",1,"2026-09-06",1000,"UTR-AGING2","payer","finance"]);
  await db.query(`select * from post_vyndi_supplier_return_debit_note($1,$2,$3,$4,$5::date,$6,$7,$8,$9,$10)`,
    ["AGING-RET2","AGING-INV","AGING-GRN",1,"2026-09-07",1,"AGING-DN2","AGING-RTV2-EVID","checker","finance"]);
  const recoverable = await db.query(`select ap_offset_inr,recoverable_inr from vyndi_supplier_returns where id='AGING-RET2'`);
  assert.equal(Number(recoverable.rows[0].ap_offset_inr), 0);
  assert.equal(Number(recoverable.rows[0].recoverable_inr), 1000);
  const settled = await loadPayablesAgingReport(sql, "2026-09-07");
  assert.equal(settled.aging.totalOutstandingInr, 0);
  assert.equal(settled.reconciliation.reconciled, true);
});
