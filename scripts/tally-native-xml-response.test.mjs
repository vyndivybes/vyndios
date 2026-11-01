import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectTallyTrialBalanceXml } from '../src/lib/finance/tally-native-xml-response.mjs';

const row=(name,dr='',cr='') =>
  '<DSPACCNAME><DSPDISPNAME>'+name+'</DSPDISPNAME></DSPACCNAME>'+
  '<DSPACCINFO><DSPCLDRAMT><DSPCLDRAMTA>'+dr+'</DSPCLDRAMTA></DSPCLDRAMT>'+
  '<DSPCLCRAMT><DSPCLCRAMTA>'+cr+'</DSPCLCRAMTA></DSPCLCRAMT></DSPACCINFO>';

test('accepts documented TallyPrime display report without pretending group totals are ledgers',()=>{
  const xml='<?xml version="1.0" encoding="UTF-8"?>'+'<ENVELOPE>'+
    row('Current Liabilities','','1526292.00')+
    row('Current Assets','-43092.00','')+'</ENVELOPE>';
  const result=inspectTallyTrialBalanceXml(xml);
  assert.equal(result.format,'tally_trial_balance_display');
  assert.equal(result.status,'inspection_only');
  assert.equal(result.rows.length,2);
  assert.deepEqual(result.rows[1],{displayName:'Current Assets',debitDisplayInr:-43092,creditDisplayInr:0});
  assert.equal(result.comparableLedgerRowsReady,false);
  assert.equal(result.companyVerified,false);
  assert.equal(result.periodVerified,false);
  assert.equal(result.caCertified,false);
});

test('accepts status 1; preserves XML-escaped company/ledger names',()=>{
  const xml='<ENVELOPE><HEADER><STATUS>1</STATUS></HEADER>'+
    row('Bank &amp; Cash','123.45','')+'</ENVELOPE>';
  assert.equal(inspectTallyTrialBalanceXml(xml).rows[0].displayName,'Bank & Cash');
});

test('rejects status 0 and Tally business errors before any reconciliation',()=>{
  const failure='<ENVELOPE><HEADER><STATUS>0</STATUS></HEADER><BODY><DATA>Request failed</DATA></BODY></ENVELOPE>';
  assert.throws(()=>inspectTallyTrialBalanceXml(failure),/status|failed/i);
  assert.throws(()=>inspectTallyTrialBalanceXml('<ENVELOPE><LINEERROR>Bad report</LINEERROR></ENVELOPE>'),/error/i);
});

test('rejects DTD, arbitrary entity expansion and processing instructions',()=>{
  assert.throws(()=>inspectTallyTrialBalanceXml('<!DOCTYPE ENVELOPE [<!ENTITY x SYSTEM "file:///x">]><ENVELOPE>&x;</ENVELOPE>'),/xml|unsupported|doctype|entity/i);
  assert.throws(()=>inspectTallyTrialBalanceXml('<ENVELOPE>'+row('A &xx;',1,0)+'</ENVELOPE>'),/entity|xml/i);
  assert.throws(()=>inspectTallyTrialBalanceXml('<?bad instruction?><ENVELOPE></ENVELOPE>'),/xml|unsupported/i);
});

test('rejects partial, duplicated or malformed report sections',()=>{
  assert.throws(()=>inspectTallyTrialBalanceXml('<ENVELOPE><DSPACCNAME><DSPDISPNAME>Bank</DSPDISPNAME></DSPACCNAME></ENVELOPE>'),/pair|unpaired/i);
  assert.throws(()=>inspectTallyTrialBalanceXml('<ENVELOPE>'+row('Bank','10','')+row('Bank','20','')+'</ENVELOPE>'),/duplicate/i);
  assert.throws(()=>inspectTallyTrialBalanceXml('<ENVELOPE>'+row('Bank','10','')+'</ENVELOPE'),/xml|tag|malformed/i);
});

test('rejects invalid currency without silently correcting it',()=>{
  assert.throws(()=>inspectTallyTrialBalanceXml('<ENVELOPE>'+row('Bank','1.234','')+'</ENVELOPE>'),/amount|precision/i);
  assert.throws(()=>inspectTallyTrialBalanceXml('<ENVELOPE>'+row('Bank','NaN','')+'</ENVELOPE>'),/amount/i);
});

test('rejects empty and oversized responses',()=>{
  assert.throws(()=>inspectTallyTrialBalanceXml('<ENVELOPE></ENVELOPE>'),/empty|report/i);
  assert.throws(()=>inspectTallyTrialBalanceXml('<ENVELOPE>'+row('Bank','0','')+'</ENVELOPE>',{maxChars:20}),/size|limit/i);
});

test('rejects XML response with unexpected mixed content in amount fields',()=>{
  const xml='<ENVELOPE><DSPACCNAME><DSPDISPNAME>Bank</DSPDISPNAME></DSPACCNAME><DSPACCINFO>'+
    '<DSPCLDRAMT><DSPCLDRAMTA><VALUE>100</VALUE></DSPCLDRAMTA></DSPCLDRAMT>'+
    '<DSPCLCRAMT><DSPCLCRAMTA></DSPCLCRAMTA></DSPCLCRAMT></DSPACCINFO></ENVELOPE>';
  assert.throws(()=>inspectTallyTrialBalanceXml(xml),/xml|amount|nested/i);
});
