import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

const migrationPath=new URL('../migrations/0200_cancelled_parent_traveller_stage_hold.sql',import.meta.url);

test('cancelled parent prevents any forward traveller status, including direct updates and inserts',async t=>{
 const sql=await readFile(migrationPath,'utf8');
 assert.match(sql,/for share/i,'parent status must be locked against concurrent cancellation');
 assert.match(sql,/raise exception/i);
 assert.doesNotMatch(sql,/update\s+epr_production_job_cards|delete\s+from\s+epr_travellers|truncate|alter\s+role/i);
 const db=new PGlite(); await db.waitReady; t.after(()=>db.close());
 await db.exec(`CREATE TABLE epr_production_job_cards(id text PRIMARY KEY,status text);
 CREATE TABLE epr_travellers(id text PRIMARY KEY,job_card_id text,status text);
 INSERT INTO epr_production_job_cards VALUES('J-C','cancelled'),('J-R','released'),('J-P','in_progress');
 INSERT INTO epr_travellers VALUES('T-C','J-C','in_build'),('T-R','J-R','in_build'),('T-P','J-P','released'),('T-D','J-C','draft');`);
 await db.exec(sql);
 await assert.rejects(db.query("UPDATE epr_travellers SET status='completed' WHERE id='T-C'"),/parent.*(cancelled|release|hold)/i);
 await assert.rejects(db.query("UPDATE epr_travellers SET status='released' WHERE id='T-D'"),/parent.*(cancelled|release|hold)/i);
 await assert.rejects(db.query("INSERT INTO epr_travellers VALUES('T-X','J-C','in_build')"),/parent.*(cancelled|release|hold)/i);
 await assert.rejects(db.query("UPDATE epr_travellers SET job_card_id=NULL WHERE id='T-C'"),/linked|lineage|relink/i);
 await assert.rejects(db.query("UPDATE epr_travellers SET status='completed',job_card_id='J-R' WHERE id='T-C'"),/linked|lineage|relink/i);
 const {rows}=await db.query("SELECT status,job_card_id FROM epr_travellers WHERE id='T-C'");
 assert.deepEqual(rows,[{status:'in_build',job_card_id:'J-C'}],'historical state cannot be rewritten by this guard');
 await db.query("UPDATE epr_travellers SET status='hold' WHERE id='T-C'");
 const held=await db.query("SELECT status FROM epr_travellers WHERE id='T-C'");
 assert.equal(held.rows[0].status,'hold','safe hold disposition remains possible');
 await db.query("UPDATE epr_travellers SET status='completed' WHERE id='T-R'");
 await db.query("UPDATE epr_travellers SET status='in_build' WHERE id='T-P'");
 const allowed=await db.query("SELECT id,status FROM epr_travellers WHERE id IN ('T-R','T-P') ORDER BY id");
 assert.deepEqual(allowed.rows,[{id:'T-P',status:'in_build'},{id:'T-R',status:'completed'}]);
});
