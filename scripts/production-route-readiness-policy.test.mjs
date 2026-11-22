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
 for(const route of ['/command/quality','/command/risk','/command/financial-cockpit','/command/operations','/command/actuals']){
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
