/**
 * Production JWKS key reader for pinned Better Auth 1.7.26.
 * The module-scoped Better Auth adapter currently returns [] from findMany('jwks')
 * inside the request-isolated Cloudflare Worker, even though SQL shows rows.
 * Reuse the established request-time SQL transport. No key material is logged.
 */
export const JWKS_READ_SQL =
  'select "id", "publicKey", "privateKey", "createdAt", "expiresAt", "alg", "crv" from "jwks" order by "createdAt" desc limit 65';

const fail=()=>{throw new Error('AUTH_JWKS_KEYRING_UNAVAILABLE');};
const B64URL=/^[A-Za-z0-9_-]{43}$/;
const ID=/^[A-Za-z0-9_-]{16,128}$/;

export async function readProductionJwks(query) {
  if(typeof query!=='function')fail();
  let rows;
  try {rows=await query(JWKS_READ_SQL,[]);}
  catch {fail();}
  if(!Array.isArray(rows)||rows.length===0||rows.length>64)fail();
  const ids=new Set();
  return rows.map(row=>{
    if(!row||typeof row!=='object'||typeof row.id!=='string'||!ID.test(row.id)||
      ids.has(row.id)||typeof row.publicKey!=='string'||row.publicKey.length>4096||
      typeof row.privateKey!=='string'||row.privateKey.length<32||row.privateKey.length>16384)
      fail();
    ids.add(row.id);
    let key;
    try {key=JSON.parse(row.publicKey);}catch{fail();}
    if(!key||typeof key!=='object'||Array.isArray(key)||
      key.kty!=='OKP'||key.crv!=='Ed25519'||!B64URL.test(key.x||'')||
      key.d!==undefined||key.k!==undefined||
      row.alg!=='EdDSA'||row.crv!=='Ed25519')fail();
    const createdAt=row.createdAt instanceof Date?row.createdAt:new Date(row.createdAt);
    const expiresAt=row.expiresAt==null?undefined:
      row.expiresAt instanceof Date?row.expiresAt:new Date(row.expiresAt);
    if(!Number.isFinite(createdAt.getTime())||
      (expiresAt&&!Number.isFinite(expiresAt.getTime())))fail();
    return {id:row.id,publicKey:row.publicKey,privateKey:row.privateKey,
      createdAt,expiresAt,alg:'EdDSA',crv:'Ed25519'};
  });
}
