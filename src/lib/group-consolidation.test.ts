import test from 'node:test';
import assert from 'node:assert/strict';
import {GROUP_UNITS,calculateGroupCoverage,consolidateGroupEvents,validateTransferPair,aggregateDivisionSources} from './group-consolidation.ts';

test('the six group units are management divisions and not separate legal companies',()=>{
 assert.deepEqual(GROUP_UNITS.map(x=>x.id),['corporate','carbon','aluminium','software','vybes','merchandise']);
 assert.ok(GROUP_UNITS.every(x=>x.type==='management_unit'));
});
test('unattributed data does not get auto-assigned to bicycles or group finance',()=>{
 const data=aggregateDivisionSources([
  {sourceKind:'sales_order',divisionId:'carbon',count:2,units:3},
  {sourceKind:'sales_order',divisionId:null,count:4,units:8},
  {sourceKind:'job_card',divisionId:'aluminium',count:1},
 ],{sales_order:'PASS',job_card:'PASS'});
 assert.equal(data.divisions.find(x=>x.id==='carbon')?.orders,2);
 assert.equal(data.divisions.find(x=>x.id==='carbon')?.units,3);
 assert.equal(data.totalAttributed.orders,2);
 assert.equal(data.unattributed.orders,4);
 assert.equal(data.groupStatus,'PARTIAL');
 assert.equal(data.groupFinancialTotal,null);
});
test('source HOLD invalidates grouped completeness even when all rows were tagged',()=>{
 const data=aggregateDivisionSources([{sourceKind:'sales_order',divisionId:'carbon',count:1,units:1}],{sales_order:'PASS',supplier_invoice:'HOLD'});
 assert.equal(data.groupStatus,'HOLD');
 assert.equal(data.groupFinancialTotal,null);
});
test('duplicate division+source buckets cannot inflate reported metrics',()=>{
 assert.throws(()=>aggregateDivisionSources([
  {sourceKind:'job_card',divisionId:'carbon',count:2},
  {sourceKind:'job_card',divisionId:'carbon',count:1},
 ],{job_card:'PASS'}),/GROUP_DUPLICATE_SOURCE_BUCKET/);
});
test('internal transfer eliminations demand independently evidenced matched external identifiers',()=>{
 const base={transferId:'X1',period:'2026-10',currency:'INR',basis:'approved',
  debit:{divisionId:'carbon',amount:20000,sourceRef:'JC-SERVICE-1'},
  credit:{divisionId:'software',amount:20000,sourceRef:'INV-SERVICE-1'}};
 assert.equal(validateTransferPair(base).eligible,true);
 assert.equal(validateTransferPair({...base,credit:{...base.credit,amount:19999}}).eligible,false);
 assert.equal(validateTransferPair({...base,credit:{...base.credit,divisionId:'carbon'}}).eligible,false);
 assert.equal(validateTransferPair({...base,basis:'draft'}).eligible,false);
});
test('consolidation excludes only independently matched and approved internal pairs',()=>{
 const external=[{id:'external-sale',amount:40000,divisionId:'software',class:'external' as const}];
 const internal=[{id:'internal-charge',amount:20000,divisionId:'software',class:'internal' as const,transferId:'X1'}];
 const pair={transferId:'X1',period:'2026-10',currency:'INR',basis:'approved',
  debit:{divisionId:'carbon',amount:20000,sourceRef:'BILL-1'},
  credit:{divisionId:'software',amount:20000,sourceRef:'BILL-2'}};
 const a=consolidateGroupEvents([...external,...internal],[pair]);
 assert.equal(a.groupAmount,40000);
 assert.equal(a.eliminatedAmount,20000);
 assert.equal(a.status,'QUALIFIED_INTERNAL_PAIRS_ONLY');
 const b=consolidateGroupEvents([...external,...internal],[]);
 assert.equal(b.groupAmount,null);
 assert.equal(b.status,'HOLD_UNMATCHED_INTERNAL');
});
test('coverage completeness cannot be certified without all source families',()=>{
 const r=calculateGroupCoverage({sales_order:'PASS'},[{sourceKind:'sales_order',divisionId:null,count:7}]);
 assert.equal(r.complete,false);
 assert.ok(r.holds.some(x=>x.includes('Unattributed')));
});
