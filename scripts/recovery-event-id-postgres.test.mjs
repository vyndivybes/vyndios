import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import pg from 'pg';
const dsn=process.env.RECOVERY_TEST_DATABASE_URL;
assert.ok(dsn,'Dedicated recovery test database required');
const uri=new URL(dsn);
assert.ok(['localhost','127.0.0.1','::1'].includes(uri.hostname),'Refusing non-loopback test database');
assert.equal(uri.pathname,'/recovery_test','Refusing any non-fixture DB');
const root=join(dirname(fileURLToPath(import.meta.url)),'..');
test('isolated PostgreSQL 18 recovery event IDs survive 1,000 same-input calls and preserve history',async t=>{
 const db=new pg.Client({connectionString:dsn,connectionTimeoutMillis:5000,statement_timeout:20000});
 await db.connect();t.after(()=>db.end());
 await db.query(`CREATE TABLE vyndi_recovery_events (
  id text PRIMARY KEY,request_id text,checkpoint_id text,event_type text NOT NULL,
  actor_user_id text NOT NULL,actor_role text NOT NULL,evidence_reference text NOT NULL,
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now());
 CREATE FUNCTION deny_vyndi_recovery_event_mutation() RETURNS trigger
 LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'VYNDI recovery events are append-only.'; END; $$;
 CREATE TRIGGER trg_vyndi_recovery_events_append_only
 BEFORE UPDATE OR DELETE ON vyndi_recovery_events
 FOR EACH ROW EXECUTE FUNCTION deny_vyndi_recovery_event_mutation();`);
 await db.query(`INSERT INTO vyndi_recovery_events(id,request_id,checkpoint_id,event_type,
  actor_user_id,actor_role,evidence_reference,payload_json)
  VALUES('REC-EVT-existing',NULL,NULL,'historical','checker','admin','TEST:OLD','{}'::jsonb)`);
 const src=await readFile(join(root,'migrations/0199_recovery_collision_resistant_events.sql'),'utf8');
 await db.query(src);
 const r=await db.query(`SELECT append_vyndi_recovery_event(
 NULL,NULL,'qualification_passed','same-checker','admin','TEST:APPEND','{}'::jsonb) AS id
 FROM generate_series(1,1000)`);
 assert.equal(r.rows.length,1000);
 const ids=r.rows.map(x=>x.id);
 assert.equal(new Set(ids).size,1000);
 assert.ok(ids.every(x=>/^REC-EVT-[0-9a-f]{32}$/.test(x)));
 const check=(await db.query(`SELECT count(*)::int AS n,count(DISTINCT id)::int AS u,
 COUNT(*) FILTER (WHERE id='REC-EVT-existing')::int AS historical
 FROM vyndi_recovery_events`)).rows[0];
 assert.deepEqual(check,{n:1001,u:1001,historical:1});
 await assert.rejects(db.query("DELETE FROM vyndi_recovery_events WHERE id='REC-EVT-existing'"),/append-only/i);
});
