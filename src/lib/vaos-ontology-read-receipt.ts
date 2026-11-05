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
export async function createOntologyReadReceipt({sourceKind,records,sourceCount,limit,asOf}:{
  sourceKind:"inventory"|"shortages"|"purchaseOrders";records:unknown[];sourceCount:number;limit:number;asOf:string;
}){
  const sourceScope=SCOPES[sourceKind];
  if(!sourceScope||!Array.isArray(records)||!Number.isSafeInteger(sourceCount)||
    sourceCount<records.length||!Number.isInteger(limit)||limit<1||limit>100||
    records.length>limit||!canonicalUtc(asOf)||
    records.some(x=>!x||typeof x!=="object"||Array.isArray(x)))fail();
  const canonical=JSON.stringify(stable({sourceKind,sourceScope,sourceCount,records}));
  const bytes=new TextEncoder().encode(canonical);
  const digest=await crypto.subtle.digest("SHA-256",bytes);
  const sourceRevision=Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,"0")).join("");
  return Object.freeze({schemaVersion:"VYNDI_ONTOLOGY_READ_RECEIPT_V1",
    sourceKind,sourceScope,records,sourceCount,sourceRevision,asOf,
    complete:records.length===sourceCount,hasMore:records.length<sourceCount,
    sourceRevisionAuthority:"CONTENT_DIGEST_ONLY",sourceCompletenessVerified:false,
    asOfAuthority:"EXTRACT_TIME_NOT_SOURCE_CHANGE_TIME",
    readOnly:true,actionAuthorized:false,productionWriteAuthorized:false,
  });
}
