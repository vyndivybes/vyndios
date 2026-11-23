import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {readCommandLineage} from '../src/lib/command-centre-source-readiness.mjs';

const exactHold=Error('VYNDI_INVENTORY_VENTURE_SCOPE_HOLD: Legacy stock/ATP combines or cannot attribute inventory ventures. Physical stock actions and stock summaries are unavailable.');
test('Command Centre retains real order lineage only for a successful authorized source read',async()=>{
 const source=[{salesOrderId:'SIM-001',shortageLines:0}];
 const out=await readCommandLineage(async()=>source);
 assert.equal(out.sourceHold,false);
 assert.equal(out.rows,source);
});
test('only an exact canonical inventory scope HOLD permits safe partial founder dashboard',async()=>{
 const result=await readCommandLineage(async()=>{throw exactHold;});
 assert.equal(result.sourceHold,true);
 assert.deepEqual(result.rows,[]);
 for(const err of [Error('permission denied'),Error('VYNDI_INVENTORY_VENTURE_SCOPE_HOLD'),Error('VYNDI_INVENTORY_VENTURE_SCOPE_HOLD_FAKE:'),Error('SQL connection timeout'),Error('INVALID_BI_SCOPE')]){
  await assert.rejects(readCommandLineage(async()=>{throw err;}),x=>x===err);
 }
});
test('Command Centre explicitly withholds every lineage-derived KPI and does not render false zero stock',async()=>{
 const route=await readFile(new URL('../src/routes/command/index.tsx',import.meta.url),'utf8');
 assert.match(route,/readCommandLineage\(getOperatingLineage\)/);
 assert.match(route,/data-command-source-readiness="source-scope-hold"/);
 assert.match(route,/lineageScopeHold \? "HOLD"/);
 assert.match(route,/lineageScopeHold \? "HOLD — inventory-linked lineage unverified"/);
 assert.match(route,/materialScopeHold/);
 assert.match(route,/Non-stock approval records only/);
 assert.match(route,/VYNDI_INVENTORY_VENTURE_SCOPE_HOLD/);
});
test('Decision Inbox does not read unscoped material shortages but retains non-stock approvals',async()=>{
 const source=await readFile(new URL('../src/lib/procure-to-pay-authority.ts',import.meta.url),'utf8');
 const from=source.indexOf('export const getDecisionInboxData =');
 const block=source.slice(from,source.indexOf('export const ',from+30));
 assert.match(block,/await requireSingleVentureInventorySource\(sql\)/);
 assert.match(block,/isInventoryVentureSourceHold\(error\)/);
 assert.match(block,/materialScopeHold/);
 assert.match(block,/materialExceptionRead\\.rows/);
 for(const tag of ['purchaseApprovals','receivingExceptions','payableApprovals','planApprovals','ibpeManagementActions']){
  assert.match(block,new RegExp('\\.\\.\\.'+tag));
 }
});
test('Production browser acceptance requires an explicit Command Centre hold, never HTTP 500 or false zero',async()=>{
 const smoke=await readFile(new URL('./vyndi-production-playwright-smoke.mjs',import.meta.url),'utf8');
 assert.match(smoke,/route === "\/command"/);
 assert.match(smoke,/data-command-source-readiness="source-scope-hold"/);
 assert.match(smoke,/VYNDI_TEST_EXPECT_INVENTORY_SCOPE_HOLD/);
 assert.match(smoke,/VERIFIED_COMMAND_SOURCE_HOLD/);
});
