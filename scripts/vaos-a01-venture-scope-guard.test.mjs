import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {A01_SINGLE_VENTURE_GUARD_CTE,assertSingleVentureSource} from '../src/lib/vaos-single-venture-source-guard.ts';

const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const route=()=>readFile(join(root,'src/routes/api/vaos/bridge.ts'),'utf8');

test('A01 accepts a single authoritative venture only',()=>{
 assert.doesNotThrow(()=>assertSingleVentureSource(1));
 for(const value of [0,2,3,-1,NaN,Infinity,null,undefined,'1',true,1.1]){
  assert.throws(()=>assertSingleVentureSource(value),
   /VYNDI_ONTOLOGY_VENTURE_SCOPE_UNVERIFIED/);
 }
});
test('A01 guard counts distinct venture IDs across both source ledgers',()=>{
 assert.match(A01_SINGLE_VENTURE_GUARD_CTE,/epr_inventory_ledger/);
 assert.match(A01_SINGLE_VENTURE_GUARD_CTE,/epr_inventory_cost_ledger/);
 assert.match(A01_SINGLE_VENTURE_GUARD_CTE,/UNION/i);
 assert.match(A01_SINGLE_VENTURE_GUARD_CTE,/LIMIT 2/i);
 assert.match(A01_SINGLE_VENTURE_GUARD_CTE,/venture_count/i);
});
test('A01 signed stock and shortage read must guard in the same SQL snapshot as rows',async()=>{
 const source=await route();
 for(const [open,close] of [
 ['if (actionType === "PROCUREMENT.OBSERVE_SHORTAGE") {','if (actionType === "PROCUREMENT.OBSERVE_OPEN_POS")'],
 ['if (actionType === "INVENTORY.OBSERVE_STOCK") {','if (actionType === "PRODUCTION.OBSERVE_WIP")']
 ]){
  const block=source.split(open)[1]?.split(close)[0]??'';
  assert.match(block,/WITH \$\{A01_SINGLE_VENTURE_GUARD_CTE\}/);
  assert.match(block,/venture_count/);
  assert.match(block,/assertSingleVentureSource\(snapshot\?\.venture_count\)/);
  assert.match(block,/createOntologyReadReceipt/);
 }
});
test('A01 tenant HOLD remains terminal, sanitized, nonce-checked and read-only',async()=>{
 const source=await route();
 assert.match(source,/source_venture_scope_unverified/);
 assert.match(source,/VYNDI_ONTOLOGY_VENTURE_SCOPE_UNVERIFIED/);
 assert.match(source,/json\(\{ok:false,error:"source_venture_scope_unverified"\},409\)/);
 assert.match(source,/claim_vyndi_vaos_bridge_nonce/);
 assert.match(source,/write_execution_not_commissioned/);
});
