import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {isInventoryVentureSourceHold} from '../src/lib/procurement-source-readiness.mjs';

test('only exact authoritative venture HOLD is recoverable for procurement planning surface',()=>{
 assert.equal(isInventoryVentureSourceHold(Error('VYNDI_INVENTORY_VENTURE_SCOPE_HOLD: Legacy stock/ATP combines or cannot attribute inventory ventures.')),true);
 for(const error of [null,undefined,'VYNDI_INVENTORY_VENTURE_SCOPE_HOLD',Error('permission denied'),Error('VYNDI_INVENTORY_VENTURE_SCOPE_HOLD'),Error('Error: VYNDI_INVENTORY_VENTURE_SCOPE_HOLD'),Error('VYNDI_INVENTORY_VENTURE_SCOPE_HOLD_FAKE:')]){
  assert.equal(isInventoryVentureSourceHold(error),false);
 }
});

test('procurement route catches only venture scope HOLD and does not render fake 0 stock/shortage facts',async()=>{
 const source=await readFile(new URL('../src/routes/command/procurement.tsx',import.meta.url),'utf8');
 assert.match(source,/isInventoryVentureSourceHold/);
 assert.match(source,/getInventoryMslWarnings\(\)/);
 assert.match(source,/getConfiguredDemandShortages\(\)/);
 assert.match(source,/throw error/);
 assert.match(source,/inventoryScopeHold:true/);
 assert.match(source,/data-procurement-source-readiness="source-scope-hold"/);
 assert.match(source,/VYNDI_INVENTORY_VENTURE_SCOPE_HOLD/);
 assert.match(source,/if\s*\(inventoryScopeHold\)\s*return\s*\(/,'source-HOLD branches before KPI calculation');
});

test('all canonical stock/ATP/shortage readers refuse unqualified multi-venture source',async()=>{
 const source=await readFile(new URL('../src/lib/production-job-card.ts',import.meta.url),'utf8');
 for(const [start,end] of [
  ['export const getProductionJobCards =','export const getConfiguredDemandShortages ='],
  ['export const getConfiguredDemandShortages =',null],
 ]){
  const offset=source.indexOf(start);
  assert.ok(offset>=0);
  const until=end?source.indexOf(end,offset+start.length):source.length;
  const block=source.slice(offset,until);
  assert.match(block,/await requireSingleVentureInventorySource\(sql\);/);
  assert.ok(block.indexOf('await requireSingleVentureInventorySource(sql);')<block.indexOf('vyndi_live_job_card_requirements'));
 }
});

test('production four-department browser acceptance requires exact procurement HOLD evidence',async()=>{
 const smoke=await readFile(new URL('./vyndi-production-playwright-smoke.mjs',import.meta.url),'utf8');
 assert.match(smoke,/route === "\/command\/procurement"/);
 assert.match(smoke,/VYNDI_TEST_EXPECT_INVENTORY_SCOPE_HOLD/);
 assert.match(smoke,/data-procurement-source-readiness="source-scope-hold"/);
 assert.match(smoke,/VERIFIED_PROCUREMENT_INVENTORY_HOLD/);
 assert.match(smoke,/No active MSL warnings/);
});
