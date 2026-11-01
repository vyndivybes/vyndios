import test from 'node:test';
import assert from 'node:assert/strict';
import { createVerifiedCaEvidence } from '../src/lib/finance/ca-evidence-hashing.mjs';
const data=new TextEncoder().encode('Ledger,Debit,Credit\nBank,100,0\nCapital,0,100\n');
test('calculates real SHA-256 content hash with immutable size reference',async()=>{
 const result=await createVerifiedCaEvidence({type:'trial_balance',reference:'TB-2026-10',bytes:data});
 assert.match(result.sha256,/^[a-f0-9]{64}$/);assert.equal(result.hashesVerifiedAgainstBytes,true);
});
test('identical source generates deterministic hash',async()=>{
 const a=await createVerifiedCaEvidence({type:'trial_balance',reference:'TB',bytes:data});
 const b=await createVerifiedCaEvidence({type:'trial_balance',reference:'TB',bytes:data});
 assert.equal(a.sha256,b.sha256);assert.equal(a.byteLength,data.byteLength);
});
test('tampering changes digest',async()=>{
 const a=await createVerifiedCaEvidence({type:'trial_balance',reference:'TB',bytes:data});
 const b=await createVerifiedCaEvidence({type:'trial_balance',reference:'TB',bytes:new TextEncoder().encode('changed')});
 assert.notEqual(a.sha256,b.sha256);
});
test('reject empty and excessive evidence',async()=>{
 await assert.rejects(createVerifiedCaEvidence({type:'trial_balance',reference:'TB',bytes:new Uint8Array()}),/empty/i);
 await assert.rejects(createVerifiedCaEvidence({type:'trial_balance',reference:'TB',bytes:new Uint8Array(1024),maxBytes:100}),/size/i);
});
test('restrict evidence metadata and encoded raw strings',async()=>{
 await assert.rejects(createVerifiedCaEvidence({type:'trial_balance',reference:'',bytes:data}),/reference/i);
 await assert.rejects(createVerifiedCaEvidence({type:'trial_balance',reference:'TB',bytes:'raw'}),/bytes/i);
});
