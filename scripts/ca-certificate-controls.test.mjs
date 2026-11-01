import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareExternalCaCertificate, assessCaPortalCheck } from '../src/lib/finance/ca-certificate-controls.mjs';
const draft={
 id:'CA-CERT-2025-26',
 type:'financial_statements',
 periodFrom:'2025-04-01',
 periodTo:'2026-03-31',
 signedOn:'2026-08-01',
 caName:'A. Example',
 membershipNumber:'123456',
 udin:'26123456ABCDEF1234',
 signedDocumentSha256:'a'.repeat(64),
 signedDocumentReference:'CA/SIGNED/2025-26',
};
test('accept external, evidence-bound signed CA certificate without claiming ICAI verification',()=>{
 const a=prepareExternalCaCertificate(draft);
 assert.equal(a.membershipNumber,'123456');
 assert.equal(a.udin,'26123456ABCDEF1234');
 assert.equal(a.certificateIssuedBySystem,false);
 assert.equal(a.portalVerified,false);
 assert.equal(a.status,'recorded_unverified');
});
test('reject invalid/mismatched UDIN, certificate hash, signing date and period',()=>{
 for(const [name,patch] of Object.entries({
    wrongMember:{udin:'26999999ABCDEF1234'},
    invalidUdin:{udin:'111'},
    invalidHash:{signedDocumentSha256:'xyz'},
    mismatchedDate:{signedOn:'2026-02-01'},
    invalidPeriod:{periodFrom:'2025-02-30'},
    blankReference:{signedDocumentReference:' '}
 })){
  assert.throws(()=>prepareExternalCaCertificate({...draft,...patch}),undefined,name);
 }
});
test('approval requires independent reviewer and actual portal observation evidence',()=>{
 const prior={...prepareExternalCaCertificate(draft),recordedBy:'maker-1'};
 assert.throws(()=>assessCaPortalCheck({certificate:prior,checkerId:'maker-1',observedMembershipNumber:'123456',outcome:'match',verificationReference:'ICAI-PORTAL-OBS-1'}),/independent|self/i);
 assert.throws(()=>assessCaPortalCheck({certificate:prior,checkerId:'checker-2',observedMembershipNumber:'123456',outcome:'match',verificationReference:''}),/evidence/i);
 assert.throws(()=>assessCaPortalCheck({certificate:prior,checkerId:'checker-2',observedMembershipNumber:'999999',outcome:'match',verificationReference:'ICAI-PORTAL-OBS-1'}),/member|mismatch/i);
 const out=assessCaPortalCheck({certificate:prior,checkerId:'checker-2',observedMembershipNumber:'123456',outcome:'match',verificationReference:'ICAI-PORTAL-OBS-1'});
 assert.equal(out.status,'portal_check_recorded');
 assert.equal(out.certificateIssuedBySystem,false);
 assert.equal(out.icaiApiVerified,false);
});
test('failed portal verification produces disputed evidence, never certification',()=>{
 const prior={...prepareExternalCaCertificate(draft),recordedBy:'maker-1'};
 const out=assessCaPortalCheck({certificate:prior,checkerId:'checker-2',observedMembershipNumber:'123456',outcome:'not_found',verificationReference:'ICAI-PORTAL-OBS-2'});
 assert.equal(out.status,'disputed');
 assert.equal(out.icaiApiVerified,false);
});
