/** Read-only voucher-line comparison; caller must provide trusted, normalized source exports. */
const money = value => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 ||
      !Number.isSafeInteger(Math.round(value * 100)) ||
      Math.abs(value * 100 - Math.round(value * 100)) > 0.000001)
    throw new Error('Invalid voucher monetary value');
  return Math.round(value * 100);
};
const canonical = (rows, origin) => {
  if (!Array.isArray(rows)) throw new Error('Invalid voucher records');
  const out = new Map();
  for (const r of rows) {
    if (!r || !['voucherType','voucherNumber','accountCode'].every(k => typeof r[k] === 'string' && r[k].trim()) ||
        typeof r.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(r.date) ||
        !Number.isFinite(Date.parse(r.date + 'T00:00:00Z')) ||
        new Date(r.date + 'T00:00:00Z').toISOString().slice(0,10) !== r.date)
      throw new Error('Invalid voucher identity/date');
    const key = JSON.stringify([r.voucherType.trim(),r.voucherNumber.trim(),r.date,r.accountCode.trim()]);
    if (out.has(key)) throw new Error('Duplicate voucher key in ' + origin);
    out.set(key, {key, voucherType:r.voucherType.trim(), voucherNumber:r.voucherNumber.trim(),
      date:r.date,accountCode:r.accountCode.trim(),debitPaise:money(r.debitInr),creditPaise:money(r.creditInr)});
  }
  return out;
};
export function reconcileTallyVouchers(vyndiRows, tallyRows) {
  const v = canonical(vyndiRows,'VYNDI');
  const t = canonical(tallyRows,'Tally');
  const exceptions = [];
  for (const key of new Set([...v.keys(),...t.keys()])) {
    const a=v.get(key),b=t.get(key);
    let reason;
    if (!a) reason='missing_in_vyndi';
    else if (!b) reason='missing_in_tally';
    else if (a.debitPaise!==b.debitPaise || a.creditPaise!==b.creditPaise) reason='amount_mismatch';
    if (reason) exceptions.push({key,reason,vyndi:a ? {debitInr:a.debitPaise/100,creditInr:a.creditPaise/100}:null,
      tally:b ? {debitInr:b.debitPaise/100,creditInr:b.creditPaise/100}:null});
  }
  exceptions.sort((a,b)=>a.key.localeCompare(b.key));
  return {status: v.size > 0 && t.size > 0 && exceptions.length===0 ? 'reconciled':'blocked',
    vyndiCount:v.size,tallyCount:t.size,exceptions,caCertified:false};
}
