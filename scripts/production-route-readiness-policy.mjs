/**
 * Production browser acceptance distinguishes an independently observed,
 * fail-closed stock/source HOLD from a generic broken page. An explicit
 * release-run flag is required to expect that HOLD. Never relabel arbitrary
 * HTTP errors, auth failures or unqualified enterprise source data as READY.
 */
export function assertProductionRouteReadiness({
  route,state,visibleText,expectInventoryHold=false,
}={}){
 if(route==='/command/inventory' && expectInventoryHold){
  if(state!=='error'||!String(visibleText||'').includes('VYNDI_INVENTORY_VENTURE_SCOPE_HOLD'))
   throw Error('INVENTORY_SOURCE_HOLD_NOT_CONFIRMED');
  return 'VERIFIED_INVENTORY_SOURCE_HOLD';
 }
 if(state!=='ready')throw Error('ROUTE_NOT_READY: '+String(route||'unknown'));
 return 'READY';
}
