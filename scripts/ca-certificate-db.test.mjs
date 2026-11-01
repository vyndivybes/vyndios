import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('CA certificate migration enforces immutable external signature, UDIN membership and maker-checker',async t=>{
  const {PGlite}=await import('@electric-sql/pglite');
  const db=new PGlite();
  t.after(()=>db.close());
  const migration=readFileSync(new URL('../migrations/0194_ca_certificate_evidence_register.sql',import.meta.url),'utf8');
  await db.exec(migration);
  const add=async(id,udin='26123456ABCDEF1234',membership='123456')=>
    db.query(`insert into epr_finance_ca_signed_certificates
      (certificate_id,document_type,period_from,period_to,signed_on,ca_name,
       ca_membership_number,udin,signed_document_sha256,signed_document_reference,recorded_by)
      values($1,'financial_statements','2025-04-01','2026-03-31','2026-08-01',
       'Independent CA',$3,$2,$4,'signed-original-pdf','maker')`,[id,udin,membership,'a'.repeat(64)]);
  await add('CERT-A');
  await assert.rejects(add('CERT-B','26999999ABCDEF1234','123456'));
  await assert.rejects(add('CERT-C','26123456ABCDEF1234','123456'));
  await assert.rejects(db.query(`update epr_finance_ca_signed_certificates
    set signed_document_sha256=$1 where certificate_id='CERT-A'`,['b'.repeat(64)]));
  await assert.rejects(db.query(`update epr_finance_ca_signed_certificates
    set status='portal_check_recorded',checked_by='maker',checked_at=now(),
        observed_membership_number='123456',checker_recorded_outcome='match',
        portal_check_evidence_reference='ICAI-PORTAL-REF'
    where certificate_id='CERT-A'`));
  await assert.rejects(db.query(`update epr_finance_ca_signed_certificates
    set status='portal_check_recorded',checked_by='checker',checked_at=now(),
        observed_membership_number='999999',checker_recorded_outcome='match',
        portal_check_evidence_reference='ICAI-PORTAL-REF'
    where certificate_id='CERT-A'`));
  await db.query(`update epr_finance_ca_signed_certificates
    set status='portal_check_recorded',checked_by='checker',checked_at=now(),
        observed_membership_number='123456',checker_recorded_outcome='match',
        portal_check_evidence_reference='ICAI-PORTAL-REF'
    where certificate_id='CERT-A'`);
  await assert.rejects(db.query(`update epr_finance_ca_signed_certificates
    set status='recorded_unverified' where certificate_id='CERT-A'`));
  const result=await db.query(`select status,checked_by from epr_finance_ca_signed_certificates where certificate_id='CERT-A'`);
  assert.equal(result.rows[0].status,'portal_check_recorded');
  assert.equal(result.rows[0].checked_by,'checker');
  await db.query(`insert into epr_finance_ca_certificate_events
     (certificate_id,event_type,actor_user_id,evidence_reference)
     values('CERT-A','portal_check_recorded','checker','ICAI-PORTAL-REF')`);
  await assert.rejects(db.query(`update epr_finance_ca_certificate_events set actor_user_id='someone' where certificate_id='CERT-A'`));
  await assert.rejects(db.query(`delete from epr_finance_ca_certificate_events where certificate_id='CERT-A'`));
});
