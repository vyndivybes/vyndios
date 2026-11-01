/** External Chartered Accountant certificate controls.
 * This module NEVER signs, issues, or verifies certificates with ICAI.
 */
/** @param {unknown} value */
const dateOk = value => typeof value==='string' && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value) &&
  Number.isFinite(Date.parse(value+'T00:00:00Z')) &&
  new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
/** @param {unknown} value */
const safeReference = value => typeof value==='string' && value.trim().length>=5 &&
  value.trim().length<=500 && !/[\x00-\x1f]/.test(value);
/** @typedef {{id:string,type:'financial_statements'|'tax_audit'|'gst_audit'|'other_certificate',periodFrom:string,periodTo:string,signedOn:string,caName:string,membershipNumber:string,udin:string,signedDocumentSha256:string,signedDocumentReference:string}} CaCertificateInput */
/** @param {CaCertificateInput} data */
export function prepareExternalCaCertificate(data) {
  if(!data || typeof data!=='object')throw new Error('Invalid CA certificate');
  const {id,type,periodFrom,periodTo,signedOn,caName,membershipNumber,udin,signedDocumentSha256,signedDocumentReference}=data;
  if(!/^[A-Za-z0-9][A-Za-z0-9_.:-]{2,159}$/.test(id))throw new Error('Invalid certificate reference ID');
  if(!['financial_statements','tax_audit','gst_audit','other_certificate'].includes(type))throw new Error('Invalid document type');
  if(!dateOk(periodFrom)||!dateOk(periodTo)||!dateOk(signedOn)||periodFrom>periodTo||signedOn<periodTo||
      signedOn>new Date().toISOString().slice(0,10))throw new Error('Invalid certificate signing date or accounting period');
  if(typeof caName!=='string'||caName.trim().length<3||caName.trim().length>160)throw new Error('Invalid CA name');
  if(typeof membershipNumber!=='string'||!/^[0-9]{6}$/.test(membershipNumber))throw new Error('Invalid CA membership number');
  if(typeof udin!=='string'||!/^[0-9]{8}[A-Z0-9]{10}$/.test(udin)||
      udin.slice(2,8)!==membershipNumber)throw new Error('Invalid or mismatched UDIN and CA membership number');
  if(typeof signedDocumentSha256!=='string'||!/^[a-f0-9]{64}$/i.test(signedDocumentSha256))
    throw new Error('Invalid externally signed document SHA-256 hash');
  if(!safeReference(signedDocumentReference))throw new Error('Missing signed document evidence reference');
  return {id,type,periodFrom,periodTo,signedOn,caName:caName.trim(),membershipNumber,udin,
    signedDocumentSha256:signedDocumentSha256.toLowerCase(),
    signedDocumentReference:signedDocumentReference.trim(),
    status:'recorded_unverified',portalVerified:false,certificateIssuedBySystem:false,documentBytesVerified:false};
}
/** @typedef {ReturnType<typeof prepareExternalCaCertificate>&{recordedBy:string}} RecordedCertificate */
/** @param {{certificate:RecordedCertificate,checkerId:string,observedMembershipNumber:string,outcome:'match'|'not_found'|'mismatch',verificationReference:string}} input */
export function assessCaPortalCheck(input) {
  const {certificate,checkerId,observedMembershipNumber,outcome,verificationReference}=input;
  if(!certificate || certificate.status!=='recorded_unverified')throw new Error('Certificate not awaiting independent review');
  if(typeof checkerId!=='string'||!checkerId.trim()||checkerId===certificate.recordedBy)throw new Error('Independent reviewer required; self-check prohibited');
  if(!safeReference(verificationReference))throw new Error('Independent portal verification evidence required');
  if(!/^[0-9]{6}$/.test(observedMembershipNumber))throw new Error('Invalid observed member number');
  if(outcome==='match' && observedMembershipNumber!==certificate.membershipNumber)throw new Error('Membership mismatch');
  if(!['match','not_found','mismatch'].includes(outcome))throw new Error('Invalid portal verification result');
  return {status:outcome==='match'?'portal_check_recorded':'disputed',
    checkedBy:checkerId,verificationReference:verificationReference.trim(),observedMembershipNumber,
    checkerRecordedOutcome:outcome,certificateIssuedBySystem:false,icaiApiVerified:false};
}
