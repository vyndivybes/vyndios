export type EngineeringDocumentStatus = "draft" | "pending_approval" | "approved" | "released" | "superseded" | "rejected";

export type ControlledEngineeringRevision = {
  id:string;
  documentId:string;
  documentNumber:string;
  title:string;
  documentType:string;
  revisionCode:string;
  status:EngineeringDocumentStatus;
  contentSha256:string;
  fileName:string;
  mediaType:string;
  fileSizeBytes:number;
  sourceUri:string;
  sourceRef:string;
  releasedAt:string|null;
};

export type EngineeringDocumentTargetType = "engineering_baseline" | "eco" | "ecn" | "bom_revision" | "vedm_authority_node";
export type EngineeringDocumentRelation = "CONTROLS" | "EVIDENCES" | "VALIDATES" | "DERIVES_FROM" | "REQUIRES";
export type EngineeringDocumentLink = {
  id:string;
  revisionId:string;
  targetType:EngineeringDocumentTargetType;
  targetId:string;
  relation:EngineeringDocumentRelation;
};

const comparisonFields:(keyof ControlledEngineeringRevision)[]=[
  "revisionCode","contentSha256","fileName","mediaType","fileSizeBytes","sourceUri","sourceRef",
];

export function compareEngineeringDocumentRevisions(from:ControlledEngineeringRevision,to:ControlledEngineeringRevision){
  if(from.documentId!==to.documentId) throw new Error("Document revision comparison requires the same document master.");
  const changedFields=comparisonFields.filter((field)=>from[field]!==to[field]);
  return {
    documentId:from.documentId,
    fromRevisionId:from.id,
    toRevisionId:to.id,
    sameContent:from.contentSha256===to.contentSha256,
    changedFields,
  };
}

export function buildEngineeringDocumentWhereUsed(revisionId:string,links:EngineeringDocumentLink[]){
  const targets=links
    .filter((link)=>link.revisionId===revisionId)
    .sort((a,b)=>a.targetType.localeCompare(b.targetType)||a.targetId.localeCompare(b.targetId)||a.relation.localeCompare(b.relation));
  return {revisionId,targets};
}

function rotr(value:number,shift:number){return (value>>>shift)|(value<<(32-shift));}
function sha256(value:string){
  const bytes=new TextEncoder().encode(value);
  const bitLength=bytes.length*8;
  const paddedLength=(((bytes.length+9+63)>>6)<<6);
  const data=new Uint8Array(paddedLength);
  data.set(bytes);data[bytes.length]=0x80;
  const view=new DataView(data.buffer);
  const hi=Math.floor(bitLength/0x100000000);
  const lo=bitLength>>>0;
  view.setUint32(paddedLength-8,hi,false);view.setUint32(paddedLength-4,lo,false);
  const k=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  let h0=0x6a09e667,h1=0xbb67ae85,h2=0x3c6ef372,h3=0xa54ff53a,h4=0x510e527f,h5=0x9b05688c,h6=0x1f83d9ab,h7=0x5be0cd19;
  const w=new Uint32Array(64);
  for(let offset=0;offset<data.length;offset+=64){
    for(let i=0;i<16;i++) w[i]=view.getUint32(offset+i*4,false);
    for(let i=16;i<64;i++){const s0=rotr(w[i-15]!,7)^rotr(w[i-15]!,18)^(w[i-15]!>>>3);const s1=rotr(w[i-2]!,17)^rotr(w[i-2]!,19)^(w[i-2]!>>>10);w[i]=(w[i-16]!+s0+w[i-7]!+s1)>>>0;}
    let a=h0,b=h1,c=h2,d=h3,e=h4,f=h5,g=h6,h=h7;
    for(let i=0;i<64;i++){const S1=rotr(e,6)^rotr(e,11)^rotr(e,25);const ch=(e&f)^((~e)&g);const t1=(h+S1+ch+k[i]!+w[i]!)>>>0;const S0=rotr(a,2)^rotr(a,13)^rotr(a,22);const maj=(a&b)^(a&c)^(b&c);const t2=(S0+maj)>>>0;h=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0;}
    h0=(h0+a)>>>0;h1=(h1+b)>>>0;h2=(h2+c)>>>0;h3=(h3+d)>>>0;h4=(h4+e)>>>0;h5=(h5+f)>>>0;h6=(h6+g)>>>0;h7=(h7+h)>>>0;
  }
  return [h0,h1,h2,h3,h4,h5,h6,h7].map((n)=>n.toString(16).padStart(8,"0")).join("");
}

export function buildReleasedConfigurationManifest(input:{baselineId:string;bomRevision:string|null;revisions:ControlledEngineeringRevision[]}){
  if(!input.revisions.length) throw new Error("Released configuration manifest requires at least one controlled document revision.");
  if(input.revisions.some((revision)=>revision.status!=="released")) throw new Error("Released configuration manifest accepts released revisions only.");
  const documentIds=new Set<string>();
  for(const revision of input.revisions){
    if(documentIds.has(revision.documentId)) throw new Error("Released configuration manifest contains a duplicate document master.");
    documentIds.add(revision.documentId);
  }
  const documents=[...input.revisions]
    .sort((a,b)=>a.documentNumber.localeCompare(b.documentNumber)||a.revisionCode.localeCompare(b.revisionCode))
    .map((revision)=>({
      documentId:revision.documentId,documentNumber:revision.documentNumber,title:revision.title,documentType:revision.documentType,
      revisionId:revision.id,revisionCode:revision.revisionCode,contentSha256:revision.contentSha256,fileName:revision.fileName,sourceUri:revision.sourceUri,
    }));
  const canonical=JSON.stringify({baselineId:input.baselineId,bomRevision:input.bomRevision,documents});
  return {
    baselineId:input.baselineId,
    bomRevision:input.bomRevision,
    documentCount:documents.length,
    documents,
    configurationFingerprint:sha256(canonical),
  };
}
