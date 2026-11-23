import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {assertProductionRouteReadiness} from './production-route-readiness-policy.mjs';

const hold='Master Inventory VYNDI_INVENTORY_VENTURE_SCOPE_HOLD: Legacy stock/ATP combines different ventures.';
test('current mixed-venture source acceptance requires explicit visible HOLD rather than ready',()=>{
 assert.equal(assertProductionRouteReadiness({route:'/command/inventory',state:'error',visibleText:hold,expectInventoryHold:true}),'VERIFIED_INVENTORY_SOURCE_HOLD');
 for(const state of ['ready','loading',null]){
  assert.throws(()=>assertProductionRouteReadiness({route:'/command/inventory',state,visibleText:hold,expectInventoryHold:true}),/INVENTORY_SOURCE_HOLD_NOT_CONFIRMED/);
 }
 assert.throws(()=>assertProductionRouteReadiness({route:'/command/inventory',state:'error',visibleText:'Internal Server Error',expectInventoryHold:true}),/INVENTORY_SOURCE_HOLD_NOT_CONFIRMED/);
 assert.throws(()=>assertProductionRouteReadiness({route:'/command/inventory',state:'error',visibleText:'',expectInventoryHold:true}),/INVENTORY_SOURCE_HOLD_NOT_CONFIRMED/);
});
test('all other departmental browser checks still require actual readiness and no unexpected errors',()=>{
 for(const route of ['/command/quality','/command/risk','/command/financial-cockpit','/command/actuals']){
  assert.equal(assertProductionRouteReadiness({route,state:'ready',visibleText:'loaded',expectInventoryHold:true}),'READY');
  assert.throws(()=>assertProductionRouteReadiness({route,state:'error',visibleText:hold,expectInventoryHold:true}),/ROUTE_NOT_READY/);
 }
 assert.equal(assertProductionRouteReadiness({route:'/command/inventory',state:'ready',visibleText:'loaded',expectInventoryHold:false}),'READY');
 assert.throws(()=>assertProductionRouteReadiness({route:'/command/inventory',state:'error',visibleText:hold,expectInventoryHold:false}),/ROUTE_NOT_READY/);
});
test('production assurance explicitly establishes mixed-venture baseline, not generic acceptance of failing routes',async()=>{
 const yaml=await readFile(new URL('../.github/workflows/production-assurance.yml',import.meta.url),'utf8');
 const browser=await readFile(new URL('./vyndi-production-playwright-smoke.mjs',import.meta.url),'utf8');
 assert.match(yaml,/VYNDI_TEST_EXPECT_INVENTORY_SCOPE_HOLD:\s*["']?1/);
 assert.match(browser,/import \{assertProductionRouteReadiness\} from ".\/production-route-readiness-policy.mjs"/);
 assert.match(browser,/assertProductionRouteReadiness\(\{/);
 assert.match(browser,/VYNDI_TEST_EXPECT_INVENTORY_SCOPE_HOLD/);
 assert.match(browser,/\[data-route-readiness="ready"\],\s*\[data-route-readiness="error"\]/);
});


test('inventory-ledger loader returns an explicit source HOLD and cannot render fake zero-stock spreadsheets',async()=>{
 const route=await readFile(new URL('../src/routes/command/inventory-ledgers/$ledger.tsx',import.meta.url),'utf8');
 assert.match(route,/VYNDI_INVENTORY_VENTURE_SCOPE_HOLD/);
 assert.match(route,/inventoryScopeHold:\s*true/);
 assert.match(route,/data-ledger-readiness="source-scope-hold"/);
 assert.match(route,/Item balance register/);
 const browser=await readFile(new URL('./vyndi-production-playwright-smoke.mjs',import.meta.url),'utf8');
 assert.match(browser,/data-ledger-readiness="source-scope-hold"/);
 assert.match(browser,/VYNDI_INVENTORY_VENTURE_SCOPE_HOLD/);
});


test('SLO and responsive operator UAT must accept only the exact inventory scope HOLD',async()=>{
 for(const name of ['vyndi-observability-slo.mjs','operator-ux-hardening.mjs']){
  const s=await readFile(new URL('./'+name,import.meta.url),'utf8');
  assert.match(s,/import \{assertProductionRouteReadiness\} from ".\/production-route-readiness-policy.mjs"/,name+' must share strict readiness policy');
  assert.match(s,/VYNDI_TEST_EXPECT_INVENTORY_SCOPE_HOLD/,name+' must obey explicit source evidence expectation');
  assert.match(s,/\[data-route-readiness="ready"\],\s*\[data-route-readiness="error"\]/,name+' must observe both terminal states');
  assert.match(s,/assertProductionRouteReadiness\(\{/,name+' must classify terminal state, not blindly accept error');
  assert.match(s,/readinessVerdict/,name+' must persist observable result');
 }
});

test('Operations reports explicit partial stock source HOLD without permitting generic failure or false READY',()=>{
 const opsHold='Inventory warnings unavailable: VYNDI_INVENTORY_VENTURE_SCOPE_HOLD: Legacy stock/ATP combines or cannot attribute inventory ventures.';
 assert.equal(assertProductionRouteReadiness({route:'/command/operations',state:'error',visibleText:opsHold,expectInventoryHold:true}),'VERIFIED_OPERATIONS_INVENTORY_HOLD');
 for(const [state,visibleText] of [['ready',opsHold],['loading',opsHold],['error','permission denied'],['error','Internal Server Error'],['error','not VYNDI_INVENTORY_VENTURE_SCOPE_HOLD']]){
  assert.throws(()=>assertProductionRouteReadiness({route:'/command/operations',state,visibleText,expectInventoryHold:true}),/OPERATIONS_INVENTORY_HOLD_NOT_CONFIRMED/);
 }
 assert.throws(()=>assertProductionRouteReadiness({route:'/command/operations',state:'error',visibleText:opsHold,expectInventoryHold:false}),/ROUTE_NOT_READY/);
});


test('SPA operator viewport qualification waits for the Operations route marker, never stale Inventory HOLD',async()=>{
 const operations=await readFile(new URL('../src/routes/command/operations.tsx',import.meta.url),'utf8');
 const ux=await readFile(new URL('./operator-ux-hardening.mjs',import.meta.url),'utf8');
 for(const state of ['loading','error','ready']){
  assert.match(operations,new RegExp('data-operations-readiness="'+state+'"'));
 }
 assert.match(ux,/route === "\/command\/operations"/);
 assert.match(ux,/\[data-operations-readiness="ready"\], \[data-operations-readiness="error"\]/);
 assert.match(ux,/await terminal\.first\(\)\.waitFor\(\{ state: "attached", timeout: 30_000 \}\)/);
 assert.match(ux,/assertProductionRouteReadiness\(\{/);
 assert.match(ux,/expectInventoryHold: process\.env\.VYNDI_TEST_EXPECT_INVENTORY_SCOPE_HOLD === "1"/);
});
