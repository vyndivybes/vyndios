import { createHash } from 'node:crypto';
/** Server-side evidence hashing. Call only with authenticated and authorized source bytes.
 * Does not sign provenance or certify statutory completeness.
 */
export async function createVerifiedCaEvidence({type,reference,bytes,maxBytes=10_000_000}) {
  if(typeof type!=='string' || !/^[a-z][a-z0-9_]{1,63}$/.test(type))
    throw new Error('Invalid evidence type');
  if(typeof reference!=='string' || !reference.trim() || reference.length>200)
    throw new Error('Invalid evidence reference');
  if(!(bytes instanceof Uint8Array))throw new Error('Invalid evidence bytes');
  if(!Number.isSafeInteger(maxBytes) || maxBytes<=0 || bytes.byteLength>maxBytes)
    throw new Error('Invalid evidence size');
  if(bytes.byteLength===0)throw new Error('Empty evidence');
  const sha256=createHash('sha256').update(bytes).digest('hex');
  return {type,reference:reference.trim(),sha256,byteLength:bytes.byteLength,
    hashesVerifiedAgainstBytes:true,caCertified:false};
}
