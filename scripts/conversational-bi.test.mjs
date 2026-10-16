import test from 'node:test';
import assert from 'node:assert/strict';
import {AGENTS,businessDay,defaultDefinition,interpretRequest,validateDefinition,projectEvidence} from '../public/bi-model.mjs';
const now=new Date('2026-10-17T10:00:00Z'),base=defaultDefinition(now);
test('natural language creates and edits bounded definitions',()=>{
 const first=interpretRequest('finance and production workflow states, last 7 days',base,now);
 assert.deepEqual([...first.agents].sort(),['finance','production']);assert.equal(first.metric,'statuses');assert.equal(first.from,'2026-10-11');
 const next=interpretRequest('table',first,now);assert.equal(next.chart,'table');assert.deepEqual(next.agents,first.agents);assert.equal(next.from,first.from);
 assert.equal(interpretRequest('consolidated verified agent closures last 30 days',base,now).agents.length,16);
 assert.deepEqual(interpretRequest('HR records',base,now).agents,['people']);
 assert.deepEqual(interpretRequest('VEDM records',base,now).agents,['vibpe']);
 assert.equal(interpretRequest('CRM records',base,now).metric,'crm');
 assert.throws(()=>interpretRequest('finance last 12 days',base,now));
 assert.equal(businessDay(new Date('2026-10-16T23:00:00Z')),'2026-10-17');
});
test('SQL, unsupported financial claims, invalid dates and identifiers fail closed',()=>{
 for(const p of ['select * from secrets','finance; drop table users','profit last 30 days','hello'])assert.throws(()=>interpretRequest(p,base,now));
 for(const patch of [{agents:['__proto__']},{agents:['finance','finance']},{metric:'profit'},{to:'2026-10-18'},{from:'2026-02-30'},{from:'2020-01-01'}])assert.throws(()=>validateDefinition({...base,...patch},now));
});
test('missing is unknown, observed zero is empty, mismatched periods cannot leak old values',()=>{
 const d={...base,agents:['finance','production']};
 const packet={period:{from:d.from,to:d.to},departments:[{employeeId:'finance',sourceTable:'journals',status:'OBSERVED',periodEventCount:0}]};
 const rows=projectEvidence(d,packet,null,now).rows;
 assert.equal(rows[0].state,'EMPTY');assert.equal(rows[0].value,0);assert.equal(rows[1].value,null);
 assert.equal(projectEvidence({...d,from:'2026-10-01'},packet,null,now).rows[0].value,null);
});
test('agent closures use verified evidence only, never recorded completed work',()=>{
 const d=interpretRequest('consolidated verified agent closures last 7 days',base,now);
 const workforce={observedAt:now.toISOString(),employees:[{id:'finance',sourceStatus:'RECORDED',work:{completed:900},verifiedClosures:{'7d':2}}]};
 const rows=projectEvidence(d,null,workforce,now).rows;
 assert.equal(rows.find(r=>r.agent==='finance').value,2);assert.equal(rows.find(r=>r.agent==='production').value,null);
 assert.equal(projectEvidence({...d,from:'2026-10-10'},null,workforce,now).rows[0].value,null);
 assert.equal(AGENTS.length,16);
});
