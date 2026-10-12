import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const sql = readFileSync(new URL("../migrations/0191_books_transaction_edit_audit.sql", import.meta.url), "utf8");
const scopeMatch=sql.match(/-- AUDIT_SCOPE_BEGIN\n([\s\S]*?)\n-- AUDIT_SCOPE_END/);
assert.ok(scopeMatch, "books audit migration must declare its scope");
const scope=scopeMatch[1].split("\n").map(x=>x.trim()).filter(Boolean);
test("books audit logs insert/change/delete with old/new values and protects log immutability",async t=>{
 const db=new PGlite();t.after(()=>db.close());
 for(const name of scope){
   assert.match(name,/^[a-z][a-z0-9_]*$/);
   await db.exec(`create table ${name}(id text primary key,status text,updated_by text,created_by text);`);
 }
 await db.exec(sql);
 const covered=await db.query(`select count(*)::int as total from pg_trigger where tgname='trg_vyndi_books_row_audit' and tgenabled='A'`);
 assert.equal(covered.rows[0].total,scope.length);
 await db.query("insert into epr_finance_posting_exceptions(id,status,created_by) values($1,$2,$3)",["FIN-EX-A","open","maker"]);
 await db.query("update epr_finance_posting_exceptions set status=$2,updated_by=$3 where id=$1",["FIN-EX-A","resolved","checker"]);
 await db.query("delete from epr_finance_posting_exceptions where id=$1",["FIN-EX-A"]);
 const events=await db.query("select event_type,old_record,new_record,actor_user_id from vyndi_books_edit_audit where source_table='epr_finance_posting_exceptions' order by audit_id");
 assert.deepEqual(events.rows.map(x=>x.event_type),["INSERT","UPDATE","DELETE"]);
 assert.equal(events.rows[0].actor_user_id,"maker");
 assert.equal(events.rows[1].actor_user_id,"checker");
 assert.equal(events.rows[1].old_record.status,"open");
 assert.equal(events.rows[1].new_record.status,"resolved");
 assert.equal(events.rows[2].old_record.status,"resolved");
 await assert.rejects(()=>db.query("delete from vyndi_books_edit_audit where audit_id=$1",[1]),/append.only/i);
 await assert.rejects(()=>db.query("update vyndi_books_edit_audit set actor_user_id='forged' where audit_id=$1",[1]),/append.only/i);
 await assert.rejects(()=>db.exec("truncate vyndi_books_edit_audit"),/append.only/i);
});
test("audit migration requires every scoped finance source table",async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await assert.rejects(()=>db.exec(sql),/required books source table missing/i);
});
