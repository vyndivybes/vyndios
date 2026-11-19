import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {PGlite} from '@electric-sql/pglite';

const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const oldPath=join(root,'migrations/0089_admin_recovery_centre.sql');
const patchPath=join(root,'migrations/0199_recovery_collision_resistant_events.sql');
const FN='append_vyndi_recovery_event';
async function loadLegacyFunction(db){
 const old=await readFile(oldPath,'utf8');
 const start=old.indexOf('create or replace function '+FN+'(');
 assert.ok(start>=0);
 const end=old.indexOf('\n$$;',start);
 assert.ok(end>start);
 await db.exec(old.slice(start,end+4));
}
const setup=async(db)=>{
 await db.exec(`CREATE TABLE vyndi_recovery_events (
  id text PRIMARY KEY,request_id text,checkpoint_id text,event_type text NOT NULL,
  actor_user_id text NOT NULL,actor_role text NOT NULL,evidence_reference text NOT NULL,
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now());
 CREATE FUNCTION deny_vyndi_recovery_event_mutation() RETURNS trigger
 LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'VYNDI recovery events are append-only.'; END; $$;
 CREATE TRIGGER trg_vyndi_recovery_events_append_only
 BEFORE UPDATE OR DELETE ON vyndi_recovery_events
 FOR EACH ROW EXECUTE FUNCTION deny_vyndi_recovery_event_mutation();`);
 await loadLegacyFunction(db);
};
test('forward-only migration replaces timestamp-derived recovery IDs with unique DB UUIDs, without rewriting history',async t=>{
 const patch=await readFile(patchPath,'utf8');
 assert.match(patch,/create or replace function append_vyndi_recovery_event\s*\(/i);
 assert.match(patch,/gen_random_uuid\s*\(\)/);
 const executable=patch.split('\n').filter(line=>!line.trimStart().startsWith('--')).join('\n');
 assert.doesNotMatch(executable,/clock_timestamp\s*\(\)/);
 assert.doesNotMatch(patch,/drop\s+table|truncate\s+|delete\s+from\s+vyndi_recovery_events/i);
 const db=new PGlite();await db.waitReady;t.after(()=>db.close());
 await setup(db);
 await db.query(`INSERT INTO vyndi_recovery_events(id,request_id,checkpoint_id,event_type,
 actor_user_id,actor_role,evidence_reference,payload_json)
 VALUES ('REC-EVT-legacy-unchanged',NULL,NULL,'historical','maker','admin','TEST:OLD','{}'::jsonb)`);
 await db.exec(patch);
 const r=await db.query(`SELECT append_vyndi_recovery_event(
 NULL,NULL,'same-kind','same-actor','admin','TEST:APPEND','{}'::jsonb) AS id
 FROM generate_series(1,256)`);
 assert.equal(r.rows.length,256);
 const ids=r.rows.map(x=>x.id);
 assert.equal(new Set(ids).size,256,'All identical-input events must have separate IDs');
 assert.ok(ids.every(x=>/^REC-EVT-[0-9a-f]{32}$/.test(x)));
 const {rows}=await db.query(`SELECT count(*)::int AS total,
 count(DISTINCT id)::int AS unique_ids,
 count(*) FILTER (WHERE id='REC-EVT-legacy-unchanged')::int AS old_entries
 FROM vyndi_recovery_events`);
 assert.deepEqual(rows,[{total:257,unique_ids:257,old_entries:1}]);
 await assert.rejects(db.query(
  "UPDATE vyndi_recovery_events SET event_type='tampered' WHERE id='REC-EVT-legacy-unchanged'"),
  /append-only/i);
 await assert.rejects(db.query("DELETE FROM vyndi_recovery_events WHERE id='REC-EVT-legacy-unchanged'"),/append-only/i);
});
