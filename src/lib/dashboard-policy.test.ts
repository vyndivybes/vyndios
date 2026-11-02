import test from 'node:test';import assert from 'node:assert/strict';
import {authorizeDashboard,allowed} from './dashboard-policy.ts';
const base={version:1,title:'Finance records',metric:'activity',chart:'bar',agents:['finance'],from:'2026-10-01',to:'2026-10-15'};
test('dashboard data uses canonical route RBAC at the server boundary',()=>{
 assert.equal(allowed('admin','finance'),true);
 assert.equal(allowed('engineering','finance'),false);
 assert.equal(authorizeDashboard('finance',base).agents[0],'finance');
 assert.throws(()=>authorizeDashboard('engineering',base),/permissions/);
 assert.throws(()=>authorizeDashboard('finance',{...base,agents:['finance','security']}),/permissions/);
});
test('tampered definitions cannot introduce tables, SQL or unknown source IDs',()=>{
 for(const patch of [{sql:'select * from users'},{agents:['finance;drop']},{metric:'revenue'},{agents:['finance','finance']},{from:'2026-02-30'}])assert.throws(()=>authorizeDashboard('admin',{...base,...patch}));
});
