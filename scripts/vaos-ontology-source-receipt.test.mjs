import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
import {createOntologyReadReceipt} from '../src/lib/vaos-ontology-read-receipt.ts';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const asOf='2026-11-05T04:00:00.000Z';
const sample={sourceKind:'inventory',records:[{sku:'A',unit:'pcs',quantity_balance:2}],sourceCount:1,limit:100,asOf};
test('full source observation cannot certify independent completeness or CDC revision',async()=>{
 const v=await createOntologyReadReceipt(sample);assert.equal(v.complete,true);assert.equal(v.sourceCompletenessVerified,false);
 assert.equal(v.sourceRevisionAuthority,'CONTENT_DIGEST_ONLY');assert.equal(v.asOfAuthority,'EXTRACT_TIME_NOT_SOURCE_CHANGE_TIME');
 assert.equal(v.readOnly,true);assert.equal(v.productionWriteAuthorized,false);assert.match(v.sourceRevision,/^[a-f0-9]{64}$/);
});
test('bounded partial read retains explicit hasMore and no inferred completeness',async()=>{
 const v=await createOntologyReadReceipt({...sample,sourceCount:2});assert.equal(v.complete,false);assert.equal(v.hasMore,true);
});
test('empty shortage extract remains an observation, not a PO authorization',async()=>{
 const v=await createOntologyReadReceipt({sourceKind:'shortages',records:[],sourceCount:0,limit:100,asOf});
 assert.equal(v.complete,true);assert.equal(v.sourceCompletenessVerified,false);assert.equal(v.actionAuthorized,false);
});
test('canonical digest detects stock changes, ignores object property ordering',async()=>{
 const a=await createOntologyReadReceipt(sample);
 const b=await createOntologyReadReceipt({...sample,records:[{quantity_balance:2,unit:'pcs',sku:'A'}]});
 const c=await createOntologyReadReceipt({...sample,records:[{quantity_balance:3,unit:'pcs',sku:'A'}]});
 assert.equal(a.sourceRevision,b.sourceRevision);assert.notEqual(a.sourceRevision,c.sourceRevision);
});
test('rejects impossible dates, counts and source claims',async()=>{
 for(const x of [{...sample,sourceCount:0},{...sample,sourceCount:-1},{...sample,sourceCount:1.5},
 {...sample,limit:101},{...sample,records:null},{...sample,sourceKind:'purchaseOrders'},
 {...sample,asOf:'2026-02-30T04:00:00.000Z'}])await assert.rejects(()=>createOntologyReadReceipt(x));
});
test('signed VYNDI bridge uses single-statement inventory and shortage source coverage',async()=>{
 const code=await readFile(resolve(root,'src/routes/api/vaos/bridge.ts'),'utf8');
 assert.match(code,/createOntologyReadReceipt/);
 assert.match(code,/WITH eligible AS MATERIALIZED/g);
 assert.match(code,/count\(\*\)::integer FROM eligible/g);
 assert.match(code,/job_card_id,job_card_line_id/);
 assert.match(code,/sourceKind:"inventory"/);
 assert.match(code,/sourceKind:"shortages"/);
 assert.match(code,/write_execution_not_commissioned/);
});
