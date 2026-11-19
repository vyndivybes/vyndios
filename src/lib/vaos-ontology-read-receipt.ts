/** A bounded content-addressed signed-bridge observation, NOT a certified DB revision.
 * This is NOT CDC or an independently reconciled durable Ontology snapshot. */
const SCOPES = Object.freeze({
  inventory:'vyndi_inventory_balance:all',
  shortages:'vyndi_live_job_card_requirements:released_in_progress_positive_shortage',
  purchaseOrders:'vyndi_purchase_orders:open_status_v1',
});
function canonicalUtc(value:unknown):value is string {
  if(typeof value!=="string"||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,3})?Z$/.test(value))return false;
  const ms=Date.parse(value);
  if(!Number.isFinite(ms))return false;
  return new Date(ms).toISOString()===value.replace(/(?:\.([0-9]{1,3}))?Z$/,(_m,f)=>`.${(f||"").padEnd(3,"0")}Z`);
}
function stable(value:unknown):unknown{
  if(Array.isArray(value))return value.map(stable);
  if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,stable(v)]));
  return value;
}
function fail():never{throw Error("VYNDI_ONTOLOGY_SOURCE_RECEIPT_INVALID");}

function validMvccSnapshot(value:string):boolean{
 const m=/^(\d+):(\d+):((?:\d+(?:,\d+)*)?)$/.exec(value);
 if(!m)return false;
 const min=BigInt(m[1]),max=BigInt(m[2]);
 if(min>max)return false;
 const active=m[3]?m[3].split(',').map(x=>BigInt(x)):[];
 return active.every(x=>x>=min&&x<max);
}

/** A bounded page must not contain duplicate or non-canonical enterprise identities.
 * Valid identity within a page is NOT a source-revision/completeness attestation. */
function sourceIdentity(sourceKind:"inventory"|"shortages"|"purchaseOrders",value:unknown):string{
  if(!value||typeof value!=="object"||Array.isArray(value))fail();
  const row=value as Record<string,unknown>;
  const keys=sourceKind==="inventory"?["sku","unit"]:
    sourceKind==="shortages"?["job_card_id","job_card_line_id","sku"]:["id"];
  const parts=keys.map(k=>row[k]);
  if(parts.some(x=>typeof x!=="string"||x.length===0||x.trim()!==x))fail();
  // Job-card line IDs are globally unique; parent job ID and SKU remain mandatory.
  return sourceKind==="shortages"?JSON.stringify([row.job_card_line_id]):JSON.stringify(parts);
}
export async function createOntologyReadReceipt({sourceKind,records,sourceCount,limit,asOf,sourceScopeFingerprint,sourceMvccSnapshot}:{
  sourceKind:"inventory"|"shortages"|"purchaseOrders";records:unknown[];sourceCount:number;limit:number;asOf:string;sourceScopeFingerprint?:string;sourceMvccSnapshot?:string;
}){
  const sourceScope=SCOPES[sourceKind];
  if(!sourceScope||!Array.isArray(records)||!Number.isSafeInteger(sourceCount)||
    sourceCount<records.length||!Number.isInteger(limit)||limit<1||limit>100||
    records.length>limit||!canonicalUtc(asOf)||
    records.some(x=>!x||typeof x!=="object"||Array.isArray(x)))fail();
  if(sourceCount>0&&records.length===0)fail();
  const fingerprintSupplied=sourceScopeFingerprint!==undefined||sourceMvccSnapshot!==undefined;
  if(fingerprintSupplied&&(
    typeof sourceScopeFingerprint!=="string"||!/^[a-f0-9]{64}$/.test(sourceScopeFingerprint)||
    typeof sourceMvccSnapshot!=="string"||!validMvccSnapshot(sourceMvccSnapshot)
  ))fail();
  const seen=new Set<string>();
  for(const record of records){
    const identity=sourceIdentity(sourceKind,record);
    if(seen.has(identity))fail();
    seen.add(identity);
  }
  const canonical=JSON.stringify(stable({sourceKind,sourceScope,sourceCount,records}));
  const bytes=new TextEncoder().encode(canonical);
  const digest=await crypto.subtle.digest("SHA-256",bytes);
  const sourceRevision=Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,"0")).join("");
  return Object.freeze({schemaVersion:"VYNDI_ONTOLOGY_READ_RECEIPT_V1",
    sourceKind,sourceScope,records,sourceCount,sourceRevision,asOf,
    ...(fingerprintSupplied?{
      sourceScopeFingerprint,sourceMvccSnapshot,
      sourceFingerprintAuthority:"SAME_STATEMENT_SQL_CONTENT_DIGEST",
      sourceSnapshotAuthority:"PG_MVCC_SNAPSHOT_NOT_SOURCE_REVISION"
    }:{}),
    complete:records.length===sourceCount,hasMore:records.length<sourceCount,
    sourceRevisionAuthority:"CONTENT_DIGEST_ONLY",sourceCompletenessVerified:false,
    asOfAuthority:"EXTRACT_TIME_NOT_SOURCE_CHANGE_TIME",
    readOnly:true,actionAuthorized:false,productionWriteAuthorized:false,
  });
}
