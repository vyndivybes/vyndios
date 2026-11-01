/** Offline, read-only GST source-register comparison. Does not access GSTN or file returns.
 * The caller must verify that the source export is authentic and period complete.
 */
/** @param {number} value */
function paise(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 ||
      !Number.isSafeInteger(Math.round(value*100)) ||
      Math.abs(value*100-Math.round(value*100)) > 0.000001)
    throw new Error('Invalid GST monetary value');
  return Math.round(value*100);
}
/** @type {Array<'taxableInr'|'cgstInr'|'sgstInr'|'igstInr'|'cessInr'>} */
const taxFields=['taxableInr','cgstInr','sgstInr','igstInr','cessInr'];
/** @typedef {{invoiceId:string,period:string,gstin:string,taxableInr:number,cgstInr:number,sgstInr:number,igstInr:number,cessInr:number}} GstRow */
/** @param {GstRow[]} records @param {string} source */
function normalize(records,source){
  if (!Array.isArray(records)) throw new Error('Invalid GST register');
  const result=new Map();
  for(const row of records){
    if (!row || typeof row.invoiceId!=='string' || !row.invoiceId.trim() ||
      typeof row.gstin!=='string' || !/^[0-9]{2}[A-Z0-9]{10}[0-9A-Z]{3}$/.test(row.gstin) ||
      typeof row.period!=='string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(row.period))
      throw new Error('Invalid invoice identifier, GSTIN or period');
    const key=JSON.stringify([row.invoiceId.trim(),row.period,row.gstin]);
    if(result.has(key)) throw new Error('Duplicate GST invoice key in '+source);
    const amounts=Object.fromEntries(taxFields.map(field=>[field,paise(row[field])]));
    result.set(key,{key,amounts});
  }
  return result;
}
/** @param {GstRow[]} vyndiRows @param {GstRow[]} externalRows */
export function reconcileGstRegister(vyndiRows,externalRows){
  const vyndi=normalize(vyndiRows,'VYNDI'),external=normalize(externalRows,'external register');
  const exceptions=[];
  for(const key of new Set([...vyndi.keys(),...external.keys()])){
    const a=vyndi.get(key),b=external.get(key);
    const differing=a && b ? taxFields.filter(field=>a.amounts[field]!==b.amounts[field]) : [];
    const reason=!a?'missing_in_vyndi':!b?'missing_in_external_register':differing.length?'tax_mismatch':null;
    if(reason) exceptions.push({key,reason,differingFields:differing});
  }
  exceptions.sort((a,b)=>a.key.localeCompare(b.key));
  return {
    status:vyndi.size>0 && external.size>0 && exceptions.length===0?'reconciled':'blocked',
    vyndiCount:vyndi.size,externalCount:external.size,exceptions,
    caCertified:false,
    filingValidated:false,
  };
}
