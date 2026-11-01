/** Read-only evidence inventory. Hashes are supplied by a trusted collector;
 * this module does not verify file bytes, sign audit opinions or mutate books.
 */
const required=['trial_balance','voucher_register','gst_register'];
export function buildCaEvidenceManifest({period,report,evidence}) {
  if(typeof period!=='string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(period))
    throw new Error('Invalid accounting period');
  if(!report || typeof report!=='object' || !['review_candidate','blocked'].includes(report.status) ||
     !Number.isSafeInteger(report.totalExceptions) || report.totalExceptions<0 ||
     !report.sections || typeof report.sections!=='object')
    throw new Error('Invalid reconciliation report');
  if(!Array.isArray(evidence))throw new Error('Invalid evidence list');
  const seen=new Set(), verified=[];
  for(const row of evidence) {
    if(!row || typeof row.type!=='string' || typeof row.reference!=='string' ||
       !row.reference.trim() || typeof row.sha256!=='string' || !/^[a-fA-F0-9]{64}$/.test(row.sha256))
      throw new Error('Invalid evidence reference or SHA-256 hash');
    const key=row.type+':'+row.reference.trim();
    if(seen.has(key) || (required.includes(row.type) && verified.some(x=>x.type===row.type)))
      throw new Error('Duplicate evidence reference/type');
    seen.add(key);
    verified.push({type:row.type,reference:row.reference.trim(),sha256:row.sha256.toLowerCase()});
  }
  const missing=required.filter(x=>!verified.some(row=>row.type===x));
  const sectionsComplete=required.every(x=>{
    const key=x==='trial_balance'?'trialBalance':x==='voucher_register'?'vouchers':'gst';
    const s=report.sections[key];
    return s && s.status==='reconciled' && s.exceptionCount===0;
  });
  const ready=report.status==='review_candidate' && report.totalExceptions===0 &&
    sectionsComplete && missing.length===0;
  return {period,status:ready?'review_ready':'blocked',missingEvidence:missing,
    evidence:verified,caCertified:false,approved:false,hashesVerifiedAgainstBytes:false};
}
