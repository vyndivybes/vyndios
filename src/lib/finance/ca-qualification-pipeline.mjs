import { reconcileTallyTrialBalance } from './tally-reconciliation.ts';
import { reconcileTallyVouchers } from './tally-voucher-reconciliation.mjs';
import { reconcileGstRegister } from './tally-gst-reconciliation.mjs';
import { buildCaReconciliationDashboard } from './ca-reconciliation-dashboard.mjs';

/** Read-only orchestration of normalized records. Auth, source provenance and CA approval
 * remain mandatory at the API boundary before any external reliance.
 */
/** @typedef {{voucherType:string,voucherNumber:string,date:string,accountCode:string,debitInr:number,creditInr:number}} VoucherRow */
/** @typedef {{invoiceId:string,period:string,gstin:string,taxableInr:number,cgstInr:number,sgstInr:number,igstInr:number,cessInr:number}} GstRow */
/** @typedef {{trialBalance:import('./tally-reconciliation.ts').TrialBalanceInputRow[],vouchers:VoucherRow[],gst:GstRow[]}} CaDataSet */
/** @param {{period:string,vyndi:CaDataSet,external:CaDataSet}} input */
export function qualifyCaReconciliation(input) {
  if (!input || typeof input !== 'object' || typeof input.period !== 'string' ||
      !/^\d{4}-(0[1-9]|1[0-2])$/.test(input.period)) throw new Error('Invalid accounting period');
  for (const origin of /** @type {Array<'vyndi'|'external'>} */ (['vyndi','external'])) {
    const side=input[origin];
    if (!side || typeof side !== 'object') throw new Error('Missing accounting source: '+origin);
    for(const section of /** @type {Array<'trialBalance'|'vouchers'|'gst'>} */ (['trialBalance','vouchers','gst'])) {
      if(!Array.isArray(side[section]))throw new Error('Missing source dataset: '+origin+'.'+section);
    }
    if(side.vouchers.some(v => typeof v?.date!=='string' || v.date.slice(0,7)!==input.period) ||
      side.gst.some(g => g?.period!==input.period))
      throw new Error('Accounting data outside requested period');
  }
  const trialBalance=reconcileTallyTrialBalance(input.vyndi.trialBalance,input.external.trialBalance);
  const vouchers=reconcileTallyVouchers(input.vyndi.vouchers,input.external.vouchers);
  const gst=reconcileGstRegister(input.vyndi.gst,input.external.gst);
  return {...buildCaReconciliationDashboard({trialBalance,vouchers,gst}),period:input.period,
    sourceCompletenessVerified:false,caCertified:false,reviewApproved:false};
}
