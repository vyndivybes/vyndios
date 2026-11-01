/** Strict subset XML inspection for TallyPrime's documented Trial Balance
 * DSPACCNAME/DSPACCINFO display report. This is NOT a general XML parser.
 * It never certifies company, period, ledger-level granularity, or CA accuracy.
 */
/** @typedef {{tag:string,text:string,children:XmlNode[]}} XmlNode */
/** @param {string} value */
function decodeXmlText(value) {
  if (/&(?!(?:amp|lt|gt|quot|apos);)/.test(value)) throw new Error('Unsupported XML entity');
  /** @type {Record<string,string>} */
  const entities={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"};
  return value.replace(/&(amp|lt|gt|quot|apos);/g,(_match,name)=>entities[name]);
}
/** @param {string} source */
function parseStrictXml(source) {
  let input=source.trim();
  input=input.replace(/^<\?xml\s+version=(?:"1\.0"|'1\.0')(?:\s+encoding=(?:"UTF-8"|'UTF-8'))?\s*\?>/i,'').trim();
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(input)) throw new Error('Invalid XML control character');
  /** @type {XmlNode[]} */
  const stack=[];
  /** @type {XmlNode|null} */
  let root=null;
  let offset=0,nodes=0;
  for(const token of input.matchAll(/<[^>]*>|[^<]+/g)) {
    if(token.index!==offset)throw new Error('Malformed XML token');
    const value=token[0];
    offset+=value.length;
    if(!value.startsWith('<')) {
      const decoded=decodeXmlText(value);
      if(!stack.length) {if(decoded.trim())throw new Error('Malformed XML outer text');continue;}
      const parent=stack[stack.length-1];
      if(parent.children.length && decoded.trim())throw new Error('Unsupported XML mixed content');
      parent.text+=decoded;
      continue;
    }
    const raw=value.slice(1,-1);
    if(!raw || raw.startsWith('!') || raw.startsWith('?'))throw new Error('Unsupported XML declaration, DTD or processing instruction');
    if(raw.startsWith('/')) {
      const name=raw.slice(1).trim();
      if(!/^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(name) || !stack.length ||
          stack[stack.length-1].tag!==name)throw new Error('Malformed XML closing tag');
      stack.pop();
      continue;
    }
    const selfClosing=/\/\s*$/.test(raw);
    const tagText=(selfClosing?raw.replace(/\/\s*$/,''):raw).trim();
    const head=/^([A-Za-z_][A-Za-z0-9_.:-]*)([\s\S]*)$/.exec(tagText);
    if(!head)throw new Error('Malformed XML opening tag');
    let attributes=head[2];
    const attributesSeen=new Set();
    while(attributes.trim()) {
      const attr=/^\s+([A-Za-z_][A-Za-z0-9_.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(attributes);
      if(!attr || attributesSeen.has(attr[1]))throw new Error('Malformed XML attribute');
      attributesSeen.add(attr[1]);
      decodeXmlText(attr[2]??attr[3]??'');
      attributes=attributes.slice(attr[0].length);
    }
    if(++nodes>15_000)throw new Error('XML node limit exceeded');
    /** @type {XmlNode} */
    const element={tag:head[1],text:'',children:[]};
    if(stack.length) {
      const parent=stack[stack.length-1];
      if(parent.text.trim())throw new Error('Unsupported XML mixed content');
      parent.children.push(element);
    } else if(root===null)root=element;
    else throw new Error('Malformed XML multiple roots');
    if(!selfClosing) {
      stack.push(element);
      if(stack.length>40)throw new Error('XML depth limit exceeded');
    }
  }
  if(offset!==input.length || stack.length || !root || root.tag!=='ENVELOPE')
    throw new Error('Malformed XML report envelope');
  return root;
}
/** @param {XmlNode} parent @param {string} tag */
function child(parent,tag) {
  const matches=parent.children.filter(node=>node.tag===tag);
  if(matches.length!==1)throw new Error('Malformed XML missing/duplicate '+tag);
  return matches[0];
}
/** @param {XmlNode} node */
function leafText(node) {
  if(node.children.length)throw new Error('Unsupported nested XML value');
  return node.text.trim();
}
/** @param {string} raw */
function displayAmount(raw) {
  if(!raw)return 0;
  if(!/^-?(?:[0-9]+|[0-9]{1,3}(?:,[0-9]{3})+)(?:\.[0-9]{1,2})?$/.test(raw))
    throw new Error('Invalid report amount or precision');
  const n=Number(raw.replaceAll(',',''));
  if(!Number.isFinite(n) || !Number.isSafeInteger(Math.round(n*100)) ||
      Math.abs(n*100-Math.round(n*100))>0.000001)
    throw new Error('Invalid report amount');
  return Math.round(n*100)/100;
}
/** @param {XmlNode} node @param {string} tag */
function anyTag(node,tag) {
  return node.tag===tag || node.children.some(childNode=>anyTag(childNode,tag));
}
/** @param {string} xml @param {{maxChars?:number}} [options] */
export function inspectTallyTrialBalanceXml(xml,options={}) {
  const maxChars=options.maxChars??1_000_000;
  if(typeof xml!=='string' || !xml.trim() || !Number.isSafeInteger(maxChars) ||
     maxChars<1 || xml.length>maxChars)throw new Error('Invalid XML size limit');
  const envelope=parseStrictXml(xml);
  if(anyTag(envelope,'LINEERROR'))throw new Error('Tally report error');
  const headers=envelope.children.filter(node=>node.tag==='HEADER');
  if(headers.length>1)throw new Error('Malformed XML duplicate header');
  if(headers.length) {
    const statuses=headers[0].children.filter(node=>node.tag==='STATUS');
    if(statuses.length>1 || (statuses.length===1 && leafText(statuses[0])!=='1'))
      throw new Error('Tally report status failed');
  }
  /** @type {{displayName:string,debitDisplayInr:number,creditDisplayInr:number}[]} */
  const rows=[];
  const namesSeen=new Set();
  const children=envelope.children;
  for(let index=0;index<children.length;index++){
    const nameNode=children[index];
    if(nameNode.tag==='DSPACCINFO')throw new Error('Unpaired Tally report amount');
    if(nameNode.tag!=='DSPACCNAME')continue;
    const infoNode=children[++index];
    if(!infoNode || infoNode.tag!=='DSPACCINFO')throw new Error('Unpaired Tally report name');
    const displayName=leafText(child(nameNode,'DSPDISPNAME'));
    if(!displayName || displayName.length>200)throw new Error('Invalid report display name');
    if(namesSeen.has(displayName))throw new Error('Duplicate Tally display name');
    namesSeen.add(displayName);
    const debitDisplayInr=displayAmount(leafText(child(child(infoNode,'DSPCLDRAMT'),'DSPCLDRAMTA')));
    const creditDisplayInr=displayAmount(leafText(child(child(infoNode,'DSPCLCRAMT'),'DSPCLCRAMTA')));
    rows.push({displayName,debitDisplayInr,creditDisplayInr});
  }
  if(!rows.length)throw new Error('Empty or unsupported Tally Trial Balance report');
  return {
    format:'tally_trial_balance_display',
    status:'inspection_only',
    rows,
    comparableLedgerRowsReady:false,
    companyVerified:false,
    periodVerified:false,
    caCertified:false,
  };
}
