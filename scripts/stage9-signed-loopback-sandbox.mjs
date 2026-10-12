// Stage 9 qualification-only HTTP server. NEVER use as an application route.
// Binds loopback 127.0.0.1 only; accepts ephemeral test public key and PGlite only.
// This function must never be imported or bundled into the production Worker.
import {createServer} from 'node:http';
import {createHash,webcrypto} from 'node:crypto';
import {validateVaosBridgeSignedContext,canonicalVaosBridgeSignatureInput,
 VAOS_BRIDGE_MAX_SKEW_SECONDS} from '../src/lib/vaos-bridge-auth.ts';
const digest=s=>createHash('sha256').update(s).digest('hex');
const deny=(code,status=403)=>Object.assign(new Error(code),{status});
const SUPPLIER='STAGE9-SIGNED-SYNTHETIC-SUPPLIER';
const SKU='STAGE9-SIGNED-UNIFIED-MATERIAL';
const json=(res,status,data)=>{
 res.writeHead(status,{'content-type':'application/json','cache-control':'no-store',
  'x-content-type-options':'nosniff'});
 res.end(JSON.stringify(data));
};
async function bodyText(req){
 let text='';
 for await (const buf of req){
  text+=buf.toString('utf8');
  if(text.length>12000)throw deny('payload_too_large',413);
 }
 return text;
}
function validatePayload(p){
 if(p?.purpose!=='write-execute'||p.qualificationProfile!=='STAGE9_ISOLATED_PGLITE_ONLY_V1')
  throw deny('qualification_purpose_denied');
 if(p.actionType!=='PROCUREMENT.CREATE_PO'||p.employeeId!=='procurement'||
    typeof p.idempotencyKey!=='string'||p.idempotencyKey.length<8||
    typeof p.requestedBy!=='string'||typeof p.approvedBy!=='string'||
    !p.requestedBy||!p.approvedBy||p.requestedBy===p.approvedBy)
  throw deny('approval_separation_invalid',422);
 const v=p.input?.variants;
 if(p.input?.supplier!==SUPPLIER||p.input?.sku!==SKU||
    p.input?.model!=='VYNDI Altitude'||p.input?.currency!=='INR'||
    p.input?.materialStatus!=='UNFROZEN'||
    !Array.isArray(v)||v.length!==2||
    v[0]?.size!=='M'||v[1]?.size!=='L'||
    !v.every(x=>x.quantity===1&&Number.isInteger(x.unitPriceInr)&&x.unitPriceInr>=1&&x.unitPriceInr<=1000))
  throw deny('synthetic_pilot_scope_invalid',422);
 if(p.approvalId!=='SYNTHETIC-CHECKER-APPROVAL')
  throw deny('synthetic_approval_required',422);
}
async function transact(db,p){
 const prefix='STAGE9-SIGNED-';
 return db.transaction(async tx=>{
  const orders=[];
  for(const v of p.input.variants){
   const size=v.size,id=prefix+'PO-'+size,price=v.unitPriceInr;
   const notes='TEST-ONLY VYNDI Altitude configuration.frameSize='+size+'; engineering/material UNFROZEN';
   const created=await tx.query(`select create_vyndi_purchase_order(
    $1,$2,$3,$4,$5,$6,$7,$8,$9::date,$10::date,$11,$12,$13,$14,$15) as id`,[
    id,SUPPLIER,'',6,SKU,'ea',1,price,'2026-10-12','2026-11-12',30,
    'SYNTHETIC-SIGNED-QUOTE-'+size,notes,p.requestedBy,'operations']);
   if(created.rows?.[0]?.id!==id)throw deny('canonical_po_creation_failed',500);
   await tx.query(`select transition_vyndi_purchase_order($1,$2,$3,$4,$5)`,
    [id,'approved','STAGE9-SIGNED-APPROVAL-'+size,p.approvedBy,'operations']);
   await tx.query(`select transition_vyndi_purchase_order($1,$2,$3,$4,$5)`,
    [id,'issued','STAGE9-SIGNED-ISSUE-'+size,p.requestedBy,'operations']);
   await tx.query(`select post_vyndi_goods_receipt($1,$2,$3::date,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [prefix+'GRN-'+size,id,'2026-10-13',1,1,0,'accepted',
      'STAGE9-SIGNED-RECEIPT-'+size,'SYNTHETIC DO NOT SHIP','synthetic-receiver','operations']);
   const invoice=await tx.query(`select * from post_vyndi_supplier_invoice(
    $1,$2,$3,$4::date,$5,$6,$7,$8,$9,$10)`,
    [prefix+'INV-'+size,id,'SYNTHETIC-INV-'+size,'2026-10-14',1,price,0,
     'STAGE9-SIGNED-INVOICE-'+size,'synthetic-ap-maker','finance']);
   if(invoice.rows?.[0]?.match_status!=='matched')throw deny('canonical_three_way_match_failed',500);
   const confirmed=await tx.query(`select p.status as po_status,p.quantity,p.sku,g.inspection_status,
     g.quantity_accepted,i.status as invoice_status from vyndi_purchase_orders p
     join vyndi_goods_receipts g on g.purchase_order_id=p.id
     join vyndi_supplier_invoices i on i.purchase_order_id=p.id
     where p.id=$1 and g.id=$2 and i.id=$3`,
     [id,prefix+'GRN-'+size,prefix+'INV-'+size]);
   const c=confirmed.rows?.[0];
   if(!c||c.po_status!=='received'||c.invoice_status!=='matched'||
      c.inspection_status!=='accepted'||Number(c.quantity)!==1||
      Number(c.quantity_accepted)!==1||c.sku!==SKU)
      throw deny('canonical_readback_mismatch',500);
   orders.push({size,poId:id,receiptId:prefix+'GRN-'+size,
    invoiceId:prefix+'INV-'+size,status:c.po_status,invoiceMatch:c.invoice_status});
  }
  const pay=await tx.query("select count(*)::int as count from vyndi_supplier_payments");
  if(Number(pay.rows?.[0]?.count)!==0)throw deny('payment_execution_forbidden',500);
  return orders;
 });
}

export async function createStage9SignedLoopbackSandbox({db,publicKey}={}){
 if(!db||typeof db.transaction!=='function'||!publicKey||publicKey.algorithm?.name!=='ECDSA')
  throw deny('ephemeral_database_and_ecdsa_verifier_required',500);
 const nonces=new Set(),idempotency=new Map();
 let serialization=Promise.resolve();
 const handle=async(req,res)=>{
  try{
   if(req.method!=='POST'||req.url!=='/api/vaos/bridge')throw deny('route_not_allowed',405);
   const raw=await bodyText(req),bodyHash=digest(raw);
   const keyId=req.headers['x-vaos-key-id'];
   const time=req.headers['x-vaos-timestamp'];
   const nonce=req.headers['x-vaos-nonce'];
   const signature=req.headers['x-vaos-signature'];
   if(req.headers['x-vaos-body-sha256']!==bodyHash)
    throw deny('body_hash_mismatch',401);
   if(keyId!=='vyndi-primary-p256-v1'||typeof time!=='string'||!/^\d{13}$/.test(time)||
      typeof nonce!=='string'||!/^[A-Za-z0-9_-]{16,160}$/.test(nonce)||
      typeof signature!=='string'||!/^[A-Za-z0-9_-]{40,200}$/.test(signature))
    throw deny('signature_metadata_invalid',401);
   if(Math.abs(Date.now()-Number(time))>VAOS_BRIDGE_MAX_SKEW_SECONDS*1000)
    throw deny('timestamp_out_of_window',401);
   const canonical=canonicalVaosBridgeSignatureInput({timestamp:time,nonce,bodySha256:bodyHash});
   const verified=await webcrypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},publicKey,
     Buffer.from(signature,'base64url'),new TextEncoder().encode(canonical));
   if(!verified)throw deny('signature_invalid',401);
   let p;try{p=JSON.parse(raw)}catch{throw deny('invalid_json',400)}
   if(!p||typeof p!=='object'||Array.isArray(p))throw deny('invalid_json',400);
   const context=validateVaosBridgeSignedContext({payload:p,requestMethod:req.method,
     requestPath:req.url,expectedPurpose:'write-execute'});
   if(!context.ok)throw deny('signed_context_invalid',401);
   // A live VYNDI Worker rejects write-execute unconditionally. This is an isolated
   // test receiver, NEVER install it as the production route.
   if(p.purpose!=='write-execute')throw deny('purpose_not_commissioned');
   // Serialize admitted requests so concurrent duplicate idempotency cannot bypass replay checks.
   const previous=serialization;let release;
   serialization=new Promise(resolve=>{release=resolve});
   await previous;
   try{
    if(nonces.has(nonce))throw deny('replay_detected',409);
    nonces.add(nonce);
    const existing=idempotency.get(p.idempotencyKey);
    if(existing){
     if(existing.hash!==bodyHash)throw deny('idempotency_conflict',409);
     return json(res,200,{...existing.response,replay:true});
    }
    validatePayload(p);
    const orders=await transact(db,p);
    const out={ok:true,qualificationOnly:true,productionWrites:false,
      paymentAuthorized:false,sourceAuthority:'VYNDI_CANONICAL_SQL_PGLITE_ONLY',
      actionType:'PROCUREMENT.CREATE_PO',orders,replay:false};
    idempotency.set(p.idempotencyKey,{hash:bodyHash,response:out});
    json(res,200,out);
   }finally{release()}
  }catch(e){
   json(res,Number.isInteger(e.status)?e.status:500,{ok:false,error:e.status?e.message:'qualification_internal_error',
    paymentAuthorized:false,productionWrites:false});
  }
 };
 const server=createServer((req,res)=>{void handle(req,res)});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});
 const address=server.address();
 return Object.freeze({url:'http://127.0.0.1:'+address.port,
  close:()=>new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()))});
}
