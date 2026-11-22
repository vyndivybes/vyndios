import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {requireVerifiedFounderCommitment, FOUNDER_COMMITMENT_PRINCIPAL_SQL} from '../src/lib/founder-commitment-approval.mjs';

const founder={userId:'verified-founder-id',role:'admin'};
const verifiedSql={query:async (sql,args)=>{
 assert.match(sql,/"emailVerified"\s+IS\s+TRUE/);
 assert.match(sql,/lower\(btrim\(email\)\)/);
 assert.equal(args.length,2);
 assert.equal(args[0],founder.userId);
 return [{verified_founder_id:'verified-founder-id'}];
}};
test('the same authenticated admin actor must match an independently verified founder account',async()=>{
 const x=await requireVerifiedFounderCommitment({actor:founder,sql:verifiedSql});
 assert.deepEqual(x,{founderVerified:true,purchaseReleaseAuthorizedByThisCheck:true,externalDispatchAuthorizedByThisCheck:false});
 assert.match(FOUNDER_COMMITMENT_PRINCIPAL_SQL,/"user"/);
});
test('finance/operations/admin impersonation, unverified and duplicate account fail closed',async()=>{
 for(const actor of [
  {userId:'verified-founder-id',role:'finance'},
  {userId:'verified-founder-id',role:'operations'},
  {userId:'attacker-id',role:'admin'},
  {userId:'',role:'admin'},
  {role:'admin'},
 ])await assert.rejects(requireVerifiedFounderCommitment({actor,sql:{query:async()=>[]}}),/FOUNDER_COMMITMENT_APPROVAL_REQUIRED/);
 for(const rows of [[],[{verified_founder_id:'other'}],[{verified_founder_id:'verified-founder-id'},{verified_founder_id:'verified-founder-id'}]]){
  await assert.rejects(requireVerifiedFounderCommitment({actor:founder,sql:{query:async()=>rows}}),/FOUNDER_COMMITMENT_APPROVAL_REQUIRED/);
 }
 await assert.rejects(requireVerifiedFounderCommitment({actor:founder,sql:null}),/FOUNDER_COMMITMENT_APPROVAL_REQUIRED/);
 await assert.rejects(requireVerifiedFounderCommitment({actor:founder,sql:{query:async()=>{throw Error('db-unavailable')}}}),/db-unavailable/);
});
test('only verified founder may approve/issue/cancel POs and post supplier payments; draft PO remains edit-only',async()=>{
 const s=await readFile(new URL('../src/lib/procure-to-pay-authority.ts',import.meta.url),'utf8');
 assert.match(s,/import \{requireVerifiedFounderCommitment\} from "@\/lib\/founder-commitment-approval.mjs"/);
 assert.match(s,/createPurchaseOrder[\s\S]*?requirePageActor\("\/command\/purchase-execution", "edit"\)[\s\S]*?create_vyndi_purchase_order/);
 assert.match(s,/transitionPurchaseOrder[\s\S]*?requirePageActor\("\/command\/purchase-execution", "approve"\)[\s\S]*?requireVerifiedFounderCommitment\(\{actor,sql\}\);[\s\S]*?transition_vyndi_purchase_order/);
 assert.match(s,/postSupplierPayment[\s\S]*?requirePageActor\("\/command\/payables", "approve"\)[\s\S]*?requireVerifiedFounderCommitment\(\{actor,sql\}\);[\s\S]*?post_vyndi_supplier_payment/);
});
