/** Immutable read-only summary of three independently produced reconciliation reports.
 * This view cannot approve a period or certify statutory accounts.
 */
const configs={trialBalance:'differences',vouchers:'exceptions',gst:'exceptions'};
export function buildCaReconciliationDashboard(input) {
  if (!input || typeof input!=='object' || Array.isArray(input)) throw new Error('Invalid audit report');
  const sections={};
  let totalExceptions=0;
  let ready=true;
  for(const [name,key] of Object.entries(configs)) {
    const report=input[name];
    if(report===undefined || report===null) {
      sections[name]={status:'not_provided',exceptionCount:0,exceptions:[]};
      ready=false;continue;
    }
    if(typeof report!=='object' || !['reconciled','blocked'].includes(report.status) || !Array.isArray(report[key]))
      throw new Error('Invalid audit comparison: '+name);
    if(report.status==='reconciled' && report[key].length!==0)
      throw new Error('Inconsistent reconciliation and exception records: '+name);
    if(name==='trialBalance' && report.status==='reconciled' &&
      (report.vyndiBalanced!==true || report.tallyBalanced!==true))
      throw new Error('Inconsistent balanced-trial-balance evidence');
    const exceptions=report[key].map(e=>{
      if(!e || typeof e!=='object' || typeof e.reason!=='string' || !e.reason.trim())
        throw new Error('Invalid audit exception');
      return {reason:e.reason,reference:typeof e.key==='string'?e.key:typeof e.code==='string'?e.code:null};
    });
    totalExceptions+=exceptions.length;
    sections[name]={status:report.status,exceptionCount:exceptions.length,exceptions};
    if(report.status!=='reconciled')ready=false;
  }
  return {status:ready?'review_candidate':'blocked',totalExceptions,sections,
    caCertified:false,reviewApproved:false,statutoryFiled:false};
}
