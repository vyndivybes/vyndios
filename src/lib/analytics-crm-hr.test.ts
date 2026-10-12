import test from 'node:test';
import assert from 'node:assert/strict';
import {GROUP_AGGREGATE_QUERIES,validateAggregateRows} from './analytics-crm-hr.ts';
import {buildAnalyticsRows,aggregateAnalyticsRows} from './analytics-studio.ts';

test('CRM and HR queries are aggregate-only and do not select personal records',()=>{
 const ids=['crmCustomers','crmFollowups','hrWorkforce','hrAttendance','hrPayrollReadiness'];
 assert.deepEqual(Object.keys(GROUP_AGGREGATE_QUERIES),ids);
 for(const [key,spec] of Object.entries(GROUP_AGGREGATE_QUERIES)){
  assert.match(spec.query,/count\s*\(\s*\*\s*\)/i,key);
  assert.match(spec.query,/group by/i,key);
  assert.doesNotMatch(spec.query,/\b(select\s+\*|display_name|email|phone|salary|bank_account|person_id|customer_id|notes|summary)\b/i,key);
  assert.deepEqual(spec.keys,['category','status','record_count']);
 }
});
test('failed/partial CRM or HR aggregate result is rejected, never treated as empty',()=>{
 assert.throws(()=>validateAggregateRows([{category:'employee',status:'approved',record_count:-1}]),/GROUP_AGGREGATE_INVALID/);
 assert.throws(()=>validateAggregateRows([{category:'employee',status:'approved',record_count:'3',email:'secret@example.com'}]),/GROUP_AGGREGATE_INVALID/);
 assert.throws(()=>validateAggregateRows([{category:'employee',status:'approved',record_count:2.2}]),/GROUP_AGGREGATE_INVALID/);
 assert.deepEqual(validateAggregateRows([{category:'employee',status:'approved',record_count:2}]),[{category:'employee',status:'approved',record_count:2}]);
});
test('CRM and HR aggregate counts are underlying records, not category buckets',()=>{
 const supply={coverage:{crmCustomers:'PASS',crmFollowups:'PASS',hrWorkforce:'PASS',hrAttendance:'PASS',hrPayrollReadiness:'PASS'},records:{
  crmCustomers:[{category:'retail',status:'prospect',record_count:4},{category:'dealer',status:'active',record_count:2}],
  crmFollowups:[{category:'followup',status:'overdue',record_count:3}],
  hrWorkforce:[{category:'planned_role',status:'draft',record_count:4},{category:'employee',status:'approved',record_count:1}],
  hrAttendance:[],
  hrPayrollReadiness:[{category:'payroll',status:'hold',record_count:1}],
 }};
 const rows=buildAnalyticsRows({lineage:[],report:{},actuals:{},supply});
 assert.equal(rows.find(x=>x.dataset==='crmCustomers')?.metrics.recordCount,4);
 assert.equal(aggregateAnalyticsRows(rows.filter(x=>x.dataset==='crmCustomers'),'status','recordCount').reduce((a,b)=>a+b.value,0),6);
 assert.equal(rows.find(x=>x.dataset==='hrWorkforce'&&x.category==='planned_role')?.metrics.recordCount,4);
 assert.equal(rows.filter(x=>x.dataset==='hrWorkforce').reduce((v,x)=>v+x.metrics.recordCount,0),5);
 assert.ok(rows.every(x=>!JSON.stringify(x).includes('example.com')));
});
test('CRM or HR HOLD suppresses all unverified aggregate rows',()=>{
 const supply={coverage:{crmCustomers:'HOLD',hrWorkforce:'PASS'},records:{
  crmCustomers:[{category:'retail',status:'active',record_count:900}],
  hrWorkforce:[{category:'employee',status:'approved',record_count:0}]
 }};
 const rows=buildAnalyticsRows({lineage:[],report:{},actuals:{},supply});
 assert.equal(rows.filter(x=>x.dataset==='crmCustomers').length,0);
 assert.equal(rows.find(x=>x.dataset==='hrWorkforce')?.metrics.recordCount,0);
});
