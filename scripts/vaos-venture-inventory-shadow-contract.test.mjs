import test from 'node:test';
import assert from 'node:assert/strict';
import { readVentureInventoryShadow, VYNDI_VENTURE_INVENTORY_SHADOW_SQL } from '../src/lib/vaos-venture-inventory-shadow.mjs';

const snapshot = {
  source_count:4, venture_count:2, unpaired_count:2, negative_count:1, invalid_identity_count:0,
  records:[{venture:'v1',sku:'SAME',unit:'ea',quantity_balance:'10',inventory_value_inr:'500',quantity_observed:true,value_observed:true},
    {venture:'v2',sku:'SAME',unit:'ea',quantity_balance:'-3',inventory_value_inr:'-180',quantity_observed:true,value_observed:true}],
  source_mvcc_snapshot:'123:125:', extracted_at:'2026-11-20T00:00:00.000Z',
};
test('read-only shadow never promotes tenant, stock or purchase authority',async()=>{
  const calls=[];
  const sql={query:async(text,args)=>{calls.push({text,args});return [snapshot]}};
  const result=await readVentureInventoryShadow({sql,limit:2});
  assert.equal(calls.length,1);
  assert.deepEqual(calls[0].args,[2]);
  assert.deepEqual(result.records,snapshot.records);
  assert.equal(result.sourceCount,4);
  assert.equal(result.ventureCount,2);
  assert.equal(result.hasMore,true);
  assert.equal(result.sourceRevisionAuthority,'UNVERIFIED_SQL_SNAPSHOT_ONLY');
  assert.equal(result.tenantIdentityVerified,false);
  assert.equal(result.sourceCompletenessVerified,false);
  assert.equal(result.businessWritesAuthorized,false);
  assert.equal(result.availableToPromiseAuthorized,false);
  assert.equal(result.status,'HOLD');
  assert.ok(result.holdReasons.includes('CROSS_VENTURE_TENANT_MAPPING_UNVERIFIED'));
  assert.ok(result.holdReasons.includes('UNPAIRED_STOCK_LEDGER'));
  assert.ok(result.holdReasons.includes('NEGATIVE_PHYSICAL_STOCK'));
});
test('caller-selected venture cannot masquerade as tenant authorization',async()=>{
  const sql={query:async()=>{throw Error('must not query')}};
  await assert.rejects(()=>readVentureInventoryShadow({sql,venture:'v1'}),/SHADOW_TENANT_SCOPE_FORBIDDEN/);
  await assert.rejects(()=>readVentureInventoryShadow({sql,tenantId:'tenant_alpha'}),/SHADOW_TENANT_SCOPE_FORBIDDEN/);
  await assert.rejects(()=>readVentureInventoryShadow({sql,principal:'founder'}),/SHADOW_TENANT_SCOPE_FORBIDDEN/);
  await assert.rejects(()=>readVentureInventoryShadow({sql,limit:101}),/SHADOW_PAGE_LIMIT_INVALID/);
});
test('SQL is bounded and segregates quantity and valuation by venture,sku,canonical unit',()=>{
  const s=VYNDI_VENTURE_INVENTORY_SHADOW_SQL;
  assert.match(s,/FULL\s+OUTER\s+JOIN/);
  assert.match(s,/q\.venture\s*=\s*v\.venture/);
  assert.match(s,/q\.sku\s*=\s*v\.sku/);
  assert.match(s,/q\.unit\s*=\s*v\.unit/);
  assert.match(s,/public\.vyndi_canonical_unit\(l\.unit\)/);
  assert.match(s,/public\.vyndi_canonical_unit\(c\.unit\)/);
  assert.match(s,/ORDER\s+BY\s+venture,sku,unit/);
  assert.match(s,/LIMIT\s+\$1/);
  assert.doesNotMatch(s,/\b(?:INSERT|DELETE|TRUNCATE|UPDATE|ALTER|DROP)\b/i);
});