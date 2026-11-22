import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const approval='founder:internal-startup-writes:20261123';
const payload={purpose:'write-execute',actionType:'STARTUP.PERSIST_INTERNAL_DRAFT',employeeId:'orchestrator',
  approvalId:approval,missionId:'startup:hourly:2026-11-23T01Z',intentId:'internal-draft-plan',
  executionJobId:'vaos-job-1',idempotencyKey:'vaos-internal-plan-20261123-1',
  input:{recordId:'VAOS-DRAFT-20261123-PLAN',category:'FOUNDER_INTERNAL_ACTION_PLAN',
    title:'Internal founder action plan',content:'Collect evidence and reconcile simulation baseline.',
    classification:'INTERNAL_DRAFT',state:'DRAFT_PREPARED'}};

test('signed internal draft allowlist is exact and does not extend business execution',async()=>{
  const {validateInternalDraftWrite}=await import('../src/lib/vaos-internal-draft-write.ts');
  assert.equal(validateInternalDraftWrite(payload).ok,true);
  for(const broken of [
    {...payload,approvalId:'not-founder'},
    {...payload,actionType:'PROCUREMENT.CREATE_PO'},
    {...payload,employeeId:'finance'},
    {...payload,input:{...payload.input,classification:'ACTUAL_BUSINESS'}},
    {...payload,input:{...payload.input,state:'ISSUED'}},
    {...payload,input:{...payload.input,category:'ISSUE_REAL_PO'}},
    {...payload,input:{...payload.input,sent:true}},
    {...payload,input:{...payload.input,content:'x'.repeat(10001)}},
    {...payload,input:{...payload.input,recordId:'../../UNSAFE'}},
  ]) assert.equal(validateInternalDraftWrite(broken).ok,false);
  for(const category of ['PURCHASE_REQUEST_DRAFT','SUPPLIER_OUTREACH_DRAFT']){
    assert.equal(validateInternalDraftWrite({...payload,input:{...payload.input,category,state:'DRAFT_PREPARED'}}).ok,false);
    assert.equal(validateInternalDraftWrite({...payload,input:{...payload.input,category,state:'AWAITING_FOUNDER_APPROVAL'}}).ok,true);
  }
});

test('canonical VYNDI ledger accepts idempotent internal draft only and creates immutable audit',async(t)=>{
  const sql=await readFile(new URL('../migrations/0202_vaos_internal_startup_write.sql',import.meta.url),'utf8');
  const db=new PGlite();t.after(()=>db.close());await db.exec(sql);
  const args=['VAOS-DRAFT-20261123-PLAN','internal-draft-plan','vaos-job-1',
    'vaos-internal-plan-20261123-1',approval,'FOUNDER_INTERNAL_ACTION_PLAN',
    'Internal founder action plan','Collect evidence and reconcile simulation baseline.',
    'a'.repeat(64),'VAOS|startup:hourly:2026-11-23T01Z|internal-draft-plan'];
  const insert=async values=>db.query('select persist_vaos_internal_draft($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) as receipt',values);
  const first=(await insert(args)).rows[0].receipt;
  assert.equal(first.status,'DRAFT_PERSISTED');assert.equal(first.replay,false);
  const replay=(await insert(args)).rows[0].receipt;assert.equal(replay.replay,true);
  const saved=await db.query('select classification,state,category,record_revision,approval_ref from vyndi_vaos_internal_drafts');
  assert.equal(saved.rows.length,1);
  assert.deepEqual(saved.rows[0],{classification:'INTERNAL_DRAFT',state:'DRAFT_PREPARED',
    category:'FOUNDER_INTERNAL_ACTION_PLAN',record_revision:1,approval_ref:approval});
  const audits=await db.query('select count(*)::int n from vyndi_vaos_internal_draft_events');
  assert.equal(audits.rows[0].n,1);
  await assert.rejects(insert(args.map((v,i)=>i===7?'Modified content':v)),/IDEMPOTENCY_CONFLICT/);
  await assert.rejects(insert(args.map((v,i)=>i===5?'ISSUE_REAL_PO':v)),/CATEGORY_NOT_ALLOWED|IDEMPOTENCY_CONFLICT/);
  assert.match(sql,/revoke all on vyndi_vaos_internal_drafts from public/i);
  assert.match(sql,/revoke all on function persist_vaos_internal_draft\(/i);
});

test('existing signed bridge remains closed to every real operational effect',async()=>{
 const route=await readFile(new URL('../src/routes/api/vaos/bridge.ts',import.meta.url),'utf8');
 assert.match(route,/write_execution_not_commissioned/);
 assert.match(route,/validateInternalDraftWrite/);
 assert.match(route,/claim_vyndi_vaos_bridge_nonce/);
 assert.match(route,/persist_vaos_internal_draft/);
 assert.doesNotMatch(route,/PRODUCTION\.RELEASE_JOB[\s\S]{0,200}persist_vaos_internal_draft/);
});
