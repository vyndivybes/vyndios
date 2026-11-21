import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readProductionJwks,JWKS_READ_SQL} from '../src/lib/auth/production-jwks-reader.mjs';

const sample=(id='a'.repeat(32))=>({
 id,publicKey:JSON.stringify({kty:'OKP',crv:'Ed25519',x:'x'.repeat(43)}),
 privateKey:'ENCRYPTED_PRIVATE_KEY_'+('q'.repeat(80)),createdAt:new Date('2026-11-21T18:48:00Z'),
 expiresAt:null,alg:'EdDSA',crv:'Ed25519'
});

test('JWKS reader returns existing key pairs from request-time SQL without generation',async()=>{
 let calls=0;
 const rows=await readProductionJwks(async (sql,params)=>{
  calls++;assert.equal(sql,JWKS_READ_SQL);assert.deepEqual(params,[]);
  return [sample()];
 });
 assert.equal(calls,1);assert.equal(rows.length,1);
 assert.equal(rows[0].id,'a'.repeat(32));
 assert.equal(rows[0].alg,'EdDSA');
 assert.equal(rows[0].crv,'Ed25519');
 assert.ok(rows[0].createdAt instanceof Date);
 assert.equal(rows[0].expiresAt,undefined);
 assert.equal(rows[0].privateKey,sample().privateKey);
});

test('JWKS reader rejects absent and malformed keyring without minting another key',async()=>{
 for(const rows of [[],null,[{...sample(),publicKey:'not-json'}],
  [{...sample(),publicKey:JSON.stringify({kty:'OKP',crv:'Ed25519',x:'x'.repeat(43),d:'private'})}],
  [{...sample(),alg:'RS256'}],
  [{...sample(),expiresAt:'not-a-date'}],
  [sample(),sample()]]) {
  await assert.rejects(readProductionJwks(async()=>rows),/AUTH_JWKS_KEYRING_UNAVAILABLE/);
 }
});
test('JWKS reader bounds rows and masks backend failures',async()=>{
 await assert.rejects(readProductionJwks(async()=>{throw Error('super-secret-internal');}),
  err=>{assert.equal(err.message,'AUTH_JWKS_KEYRING_UNAVAILABLE');return true;});
 await assert.rejects(readProductionJwks(async()=>Array.from({length:65},(_,i)=>sample(String(i).padStart(32,'a')))),
  /AUTH_JWKS_KEYRING_UNAVAILABLE/);
});

test('production JWT plugin uses SQL-backed reader only inside enabled issuer',async()=>{
 const s=await readFile(new URL('../src/lib/auth/server.ts',import.meta.url),'utf8');
 assert.match(s,/founderOidcOptions\s*\?\s*\[/);
 assert.match(s,/getJwks:async\(\)=>/);
 assert.match(s,/readProductionJwks\(\(statement,params\)=>sql\.query\(statement,params\)\)/);
 assert.match(s,/getSqlServer\(\)/);
 assert.match(s,/oauthProvider\(founderOidcOptions\)/);
 assert.doesNotMatch(s,/disablePrivateKeyEncryption:\s*true/);
});
