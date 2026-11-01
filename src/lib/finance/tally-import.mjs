/** Strict read-only adapter for manually normalized Tally trial-balance CSV.
 * Input format must be Ledger,Debit,Credit; no writes or automated posting.
 */
/** @param {string} input */
function parseCsv(input) {
  if (typeof input !== 'string' || input.length > 2_000_000) throw new Error('Invalid CSV size');
  const rows=[]; let field='', row=[], quoted=false, closed=false;
  for(let i=0;i<input.length;i++) {
    const c=input[i];
    if(quoted){if(c==='"'){if(input[i+1]==='"'){field+='"';i++}else{quoted=false;closed=true}}else{field+=c}continue;}
    if(c==='"'){if(field.length || closed)throw new Error('Invalid CSV quoting');quoted=true;continue;}
    if(c===',' || c==='\n' || c==='\r') {
      row.push(field);field='';closed=false;
      if(c!==','){if(row.some(v=>v.trim()))rows.push(row);row=[];if(c==='\r' && input[i+1]==='\n')i++}
    }else{if(closed)throw new Error('Invalid CSV quoting');field+=c;}
  }
  if(quoted)throw new Error('Invalid CSV unterminated quote');
  if(field.length || row.length){row.push(field);if(row.some(v=>v.trim()))rows.push(row)}
  return rows;
}
/** @param {string} raw */
function amount(raw) {
  const x=raw.trim();
  if(!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(x))throw new Error('Invalid monetary value');
  const v=Number(x.replaceAll(',',''));
  if(!Number.isFinite(v) || !Number.isSafeInteger(Math.round(v*100)))throw new Error('Invalid monetary value');
  return v;
}
/** @param {string} csv @param {Record<string,string>} approvedMapping */
export function importTallyTrialBalanceCsv(csv, approvedMapping) {
  if(!approvedMapping || typeof approvedMapping!=='object' || Array.isArray(approvedMapping))throw new Error('Approved mapping required');
  const parsed=parseCsv(csv.replace(/^\uFEFF/,''));
  if(!parsed.length || parsed[0].join(',')!=='Ledger,Debit,Credit')throw new Error('Invalid CSV header (requires Ledger,Debit,Credit)');
  const rows=[], seen=new Set();
  for(const [index,line] of parsed.slice(1).entries()) {
    if(line.length!==3)throw new Error(`Invalid CSV column count at row ${index+2}`);
    const name=line[0].trim();
    if(!name || /^[=+@\-\t\r]/.test(name))throw new Error('Unsafe ledger name');
    const code=Object.hasOwn(approvedMapping,name)?approvedMapping[name]:undefined;
    if(typeof code!=='string' || !code.trim())throw new Error(`Unmapped ledger: ${name}`);
    if(seen.has(code))throw new Error(`Duplicate mapped account: ${code}`);
    seen.add(code);
    rows.push({code,name,debitInr:amount(line[1]),creditInr:amount(line[2])});
  }
  if(!rows.length)throw new Error('Invalid empty trial balance');
  return {rows,source:'manual_normalized_tally_csv',isCertified:false};
}
