/** Pure read-only TallyPrime report export builder. No network or writes. */
/** @param {string} value */
function xmlEscape(value) {
  /** @type {Record<string,string>} */
  const entities = {'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&apos;'};
  return value.replace(/[&<>"']/g, character => entities[character]);
}
/** @param {string} date */
function parseAccountingDate(date) {
  if (typeof date !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date))
    throw new Error('Invalid accounting date');
  const n = Date.parse(date+'T00:00:00Z');
  if (!Number.isFinite(n) || new Date(n).toISOString().slice(0,10)!==date)
    throw new Error('Invalid accounting date');
  return n;
}
/** @param {{company:string,fromDate:string,toDate:string}} request */
export function buildTallyPrimeTrialBalanceExport(request) {
  if (!request || typeof request !== 'object') throw new Error('Invalid company request');
  const {company,fromDate,toDate} = request;
  if (typeof company !== 'string' || !company || company!==company.trim() ||
      company.length>160 || Array.from(company).some(c=>c.charCodeAt(0)<32))
    throw new Error('Invalid company name');
  const start=parseAccountingDate(fromDate), end=parseAccountingDate(toDate);
  if(start>end || end-start>366*86400000)
    throw new Error('Invalid accounting period range');
  const xml = [
    '<ENVELOPE><HEADER><VERSION>1</VERSION>',
    '<TALLYREQUEST>Export</TALLYREQUEST><TYPE>Data</TYPE><ID>Trial Balance</ID>',
    '</HEADER><BODY><DESC><STATICVARIABLES>',
    '<SVCURRENTCOMPANY>'+xmlEscape(company)+'</SVCURRENTCOMPANY>',
    '<SVFROMDATE TYPE="Date">'+fromDate.replaceAll('-','')+'</SVFROMDATE>',
    '<SVTODATE TYPE="Date">'+toDate.replaceAll('-','')+'</SVTODATE>',
    '<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>',
    '<EXPLODEFLAG>Yes</EXPLODEFLAG>',
    '</STATICVARIABLES></DESC></BODY></ENVELOPE>'
  ].join('');
  return Object.freeze({mode:'read_only',report:'Trial Balance',xml});
}
