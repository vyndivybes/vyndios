import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const sql=readFileSync(new URL('../migrations/0194_ca_certificate_evidence_register.sql',import.meta.url),'utf8');
test('certificate migration includes full six-digit membership check without truncated SQL',()=>{
 assert.match(sql,/observed_membership_number is not null and observed_membership_number ~ '\^\[0-9\]\{6\}\$' and/);
 assert.match(sql,/checker_recorded_outcome is not null and/);
 assert.equal((sql.match(/create table if not exists epr_finance_ca_certificate_events/g)||[]).length,1);
 assert.equal((sql.match(/create trigger trg_ca_certificate_event_immutable/g)||[]).length,1);
});
