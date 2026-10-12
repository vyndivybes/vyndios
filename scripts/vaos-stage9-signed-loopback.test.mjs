// Real signed HTTP loopback. The receiver uses ACTUAL VYNDI canonical SQL,
// but the PostgreSQL instance is ephemeral PGlite and cannot reach production.
import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto,createHash} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {PGlite} from '@electric-sql/pglite';
import {pendingMigrations} from './migration-plan.mjs';
import {approveInventoryMaster} from './inventory-master-fixture.mjs';
import {createStage9SignedLoopbackSandbox} from './stage9-signed-loopback-sandbox.mjs';

const subtle=webcrypto.subtle;
const here=dirname(fileURLToPath(import.meta.url));
const vaosDir=join(here,'..','vaos-reference');
const vaosBridge=await import(pathToFileURL(join(vaosDir,'platform/execution/vyndi-write-bridge.mjs')));
const vaosSigned=await import(pathToFileURL(join(vaosDir,'platform/execution/vyndi-read-bridge-client.mjs')));
const SUPPLIER='STAGE9-SIGNED-SYNTHETIC-SUPPLIER',SKU='STAGE9-SIGNED-UNIFIED-MATERIAL';
const hex=s=>createHash('sha256').update(s).digest('hex');
const b64url=a=>Buffer.from(a).toString('base64url');

async function createDb(){
 const db=new PGlite();await db.waitReady;
 const base=join(here,'..','migrations');
 const files=pendingMigrations(await readdir(base),[]);
 for(const f of files)await db.exec(await readFile(join(base,f.path),'utf8'));
 assert.ok(files.length>=140);
 await approveInventoryMaster(db,{sku:SKU,name:'Stage 9 signed synthetic raw material',category:'test',unit:'ea'});
 await db.query(`insert into master_inventory_items
 (id,ledger_id,sku,name,category,unit,minimum_stock_level,planned_monthly_use,created_by,updated_by)
 values ('ITEM-STAGE9-SIGNED','components',$1,'Stage 9 signed synthetic raw material','test','ea',0,0,'synthetic-maker','synthetic-checker')`,[SKU]);
 await db.query(`select upsert_vyndi_supplier($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,[
 SUPPLIER,'SYNTHETIC NO REAL PURCHASE','INR',30,30,'approved',90,90,'STAGE9-SIGNED-ISOLATED',
 'synthetic-supplier-maker','operations','AUD-STAGE9-SIGNED-SUPPLIER']);
 return db;
}
function payload(overrides={}){
 const envelope=vaosBridge.prepareVyndiBridgeEnvelope({
  employeeId:'procurement',actionType:'PROCUREMENT.CREATE_PO',
  intentId:'STAGE9-SIGNED-INTENT-001',missionId:'STAGE9-SIGNED-MISSION-001',
  idempotencyKey:'STAGE9-SIGNED-PO-M-L',approvalRef:'SYNTHETIC-CHECKER-APPROVAL',
  input:{model:'VYNDI Altitude',supplier:SUPPLIER,sku:SKU,currency:'INR',materialStatus:'UNFROZEN',
   variants:[{size:'M',quantity:1,unitPriceInr:1},{size:'L',quantity:1,unitPriceInr:2}]},
 });
 assert.equal(envelope.executionEnabled,false,'live procurement must remain disabled');
 return {protocolVersion:vaosSigned.VYNDI_BRIDGE_PROTOCOL_VERSION,
  serviceIdentity:'vaos',audience:'vyndi-os',method:'POST',path:'/api/vaos/bridge',
  purpose:'write-execute',actionType:'PROCUREMENT.CREATE_PO',employeeId:'procurement',
  intentId:envelope.intentId,executionJobId:'STAGE9-SIGNED-SYNTHETIC-JOB-001',
  approvalId:envelope.approvalRef,missionId:envelope.missionId,
  idempotencyKey:envelope.idempotencyKey,
  requestedBy:'synthetic-maker',approvedBy:'synthetic-checker',
  qualificationProfile:'STAGE9_ISOLATED_PGLITE_ONLY_V1',input:envelope.input,...overrides};
}
async function signedRequest(url,priv,p,{nonce='nonce-stage9-signed-'+crypto.randomUUID().replaceAll('-',''),timestamp=String(Date.now()),tamper=false,signatureCorrupt=false,keyId='vyndi-primary-p256-v1'}={}){
 const text=JSON.stringify(p),digest=hex(text);
 const canonical=vaosSigned.canonicalBridgeSignatureInput({timestamp,nonce,bodySha256:digest});
 const signatureBytes=await subtle.sign({name:'ECDSA',hash:'SHA-256'},priv,new TextEncoder().encode(canonical));
 const signature=signatureCorrupt?b64url(webcrypto.getRandomValues(new Uint8Array(64))):b64url(signatureBytes);
 const res=await fetch(url+'/api/vaos/bridge',{method:'POST',
  headers:{'content-type':'application/json','x-vaos-key-id':keyId,
   'x-vaos-timestamp':timestamp,'x-vaos-nonce':nonce,
   'x-vaos-body-sha256':digest,'x-vaos-signature':signature},
  body:tamper?text+' ':text});
 return {status:res.status,body:await res.json()};
}

test('Stage 9 cross-repo VAOS signed ingress reaches real VYNDI canonical SQL on isolated HTTP loopback',async t=>{
 const db=await createDb();t.after(async()=>db.close());
 const keys=await subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
 const server=await createStage9SignedLoopbackSandbox({db,publicKey:keys.publicKey});
 t.after(async()=>server.close());
 assert.match(server.url,/^http:\/\/127\.0\.0\.1:\d+$/);
 const p=payload();
 assert.equal(vaosBridge.createVyndiWriteBridgeAdapter().prepare({...p,approvalRef:p.approvalId}).executionEnabled,false); // production adapter stays closed
 await assert.rejects(()=>vaosBridge.createVyndiWriteBridgeAdapter().execute(
  vaosBridge.prepareVyndiBridgeEnvelope({...p,approvalRef:p.approvalId})),
  e=>e.code==='VYNDI_WRITE_BRIDGE_NOT_COMMISSIONED');
 const n='nonce-stage9-signed-accept-0001';
 const ok=await signedRequest(server.url,keys.privateKey,p,{nonce:n});
 assert.equal(ok.status,200,JSON.stringify(ok.body));
 assert.equal(ok.body.qualificationOnly,true);
 assert.equal(ok.body.productionWrites,false);
 assert.equal(ok.body.paymentAuthorized,false);
 assert.equal(ok.body.orders.length,2);
 assert.deepEqual(ok.body.orders.map(x=>x.size),['M','L']);
 assert.ok(ok.body.orders.every(x=>x.status==='received'&&x.invoiceMatch==='matched'));
 const pos=await db.query("select id,sku,quantity,status from vyndi_purchase_orders where id like 'STAGE9-SIGNED-PO-%' order by id");
 assert.equal(pos.rows.length,2);
 assert.deepEqual(pos.rows.map(x=>x.sku),[SKU,SKU]);
 const unified=await db.query("select sku,physical_quantity from vyndi_inventory_available_to_promise where sku=$1",[SKU]);
 assert.equal(unified.rows.length,1);assert.equal(Number(unified.rows[0].physical_quantity),2);
 const payments=await db.query("select count(*)::int as n from vyndi_supplier_payments");
 assert.equal(Number(payments.rows[0].n),0);
 const replay=await signedRequest(server.url,keys.privateKey,p,{nonce:n});assert.equal(replay.status,409);
 const idempotent=await signedRequest(server.url,keys.privateKey,p,{nonce:'nonce-stage9-idempotent-0002'});
 assert.equal(idempotent.status,200);assert.equal(idempotent.body.replay,true);
 const noDouble=await db.query("select count(*)::int as n from vyndi_purchase_orders where id like 'STAGE9-SIGNED-PO-%'");
 assert.equal(Number(noDouble.rows[0].n),2);

 const tampered=await signedRequest(server.url,keys.privateKey,p,{nonce:'nonce-stage9-tampered-0003',tamper:true});
 assert.equal(tampered.status,401);
 const forged=await signedRequest(server.url,keys.privateKey,p,{nonce:'nonce-stage9-forgedsig-0004',signatureCorrupt:true});
 assert.equal(forged.status,401);
 const stale=await signedRequest(server.url,keys.privateKey,p,{nonce:'nonce-stage9-stale-0005',timestamp:String(Date.now()-900000)});
 assert.equal(stale.status,401);
 const differentBody=await signedRequest(server.url,keys.privateKey,payload({input:{...p.input,
  variants:[{size:'M',quantity:2,unitPriceInr:1},{size:'L',quantity:1,unitPriceInr:2}]}}),{nonce:'nonce-stage9-malformed-0006'});
 assert.equal(differentBody.status,409,'conflicting signed idempotency keys must fail');
 const selfApproval=await signedRequest(server.url,keys.privateKey,payload({idempotencyKey:'STAGE9-SECOND-PO',requestedBy:'same',approvedBy:'same'}),{nonce:'nonce-stage9-sod-0007'});
 assert.equal(selfApproval.status,422);
 const wrongPurpose=await signedRequest(server.url,keys.privateKey,payload({purpose:'read-observe',idempotencyKey:'STAGE9-THIRD-PO'}),{nonce:'nonce-stage9-purpose-0008'});
 assert.equal(wrongPurpose.status,401,'invalid signed context is an authentication failure, not an authorized action');
 const after=await db.query("select count(*)::int as n from vyndi_purchase_orders where id like 'STAGE9-SIGNED-PO-%'");
 assert.equal(Number(after.rows[0].n),2);
 const audit=await db.query("select count(*)::int as n from vyndi_audit_events where entity_id like 'STAGE9-SIGNED-%'");
 assert.ok(Number(audit.rows[0].n)>=6);
 console.log(JSON.stringify({stage:'STAGE9_SIGNED_LOOPBACK',result:'PASS',
  canonicalPurchaseOrders:2,canonicalGoodsReceipts:2,canonicalMatchedInvoices:2,payments:0,
  rejectionChecks:6,productionDatabaseTouched:false,isolatedTestKeyOnly:true}));
});
