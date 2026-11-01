import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTallyPrimeTrialBalanceExport } from '../src/lib/finance/tally-native-xml-export.mjs';

test('builds a company-bound read-only TallyPrime Trial Balance XML export', () => {
  const r = buildTallyPrimeTrialBalanceExport({
    company: 'Vayu & Shastr Pvt Ltd', fromDate: '2026-04-01', toDate: '2026-10-31'
  });
  assert.equal(r.mode, 'read_only');
  assert.equal(r.report, 'Trial Balance');
  assert.match(r.xml, /<TALLYREQUEST>Export<\/TALLYREQUEST>/);
  assert.match(r.xml, /<TYPE>Data<\/TYPE>/);
  assert.match(r.xml, /<ID>Trial Balance<\/ID>/);
  assert.match(r.xml, /<SVCURRENTCOMPANY>Vayu &amp; Shastr Pvt Ltd<\/SVCURRENTCOMPANY>/);
  assert.match(r.xml, /<SVFROMDATE TYPE="Date">20260401<\/SVFROMDATE>/);
  assert.match(r.xml, /<SVTODATE TYPE="Date">20261031<\/SVTODATE>/);
  assert.match(r.xml, /<SVEXPORTFORMAT>\$\$SysName:XML<\/SVEXPORTFORMAT>/);
  assert.match(r.xml, /<EXPLODEFLAG>Yes<\/EXPLODEFLAG>/);
  assert.doesNotMatch(r.xml, /<TALLYREQUEST>Import|<TALLYREQUEST>Execute|<ACTION>/i);
});
test('escapes XML metacharacters instead of interpolating markup', () => {
  const r = buildTallyPrimeTrialBalanceExport({
    company: 'A <B> "C" & D', fromDate: '2026-10-01', toDate: '2026-10-31'
  });
  assert.match(r.xml, /A &lt;B&gt; &quot;C&quot; &amp; D/);
  assert.doesNotMatch(r.xml, /<B>/);
});
test('rejects impossible dates, reversed periods and overly wide scope', () => {
  const x = {company: 'Example',fromDate: '2026-10-01',toDate: '2026-10-31'};
  assert.throws(() => buildTallyPrimeTrialBalanceExport({...x,fromDate:'2026-02-30'}), /date|period/i);
  assert.throws(() => buildTallyPrimeTrialBalanceExport({...x,fromDate:'2026-11-01'}), /date|period/i);
  assert.throws(() => buildTallyPrimeTrialBalanceExport({...x,fromDate:'2023-01-01'}), /period|range/i);
});
test('rejects empty, ambiguous or control-character company names', () => {
  const x = {fromDate:'2026-10-01',toDate:'2026-10-31'};
  for (const company of ['', ' Leading', 'Trailing ', 'Bad\nCompany', 'x'.repeat(161)]) {
    assert.throws(() => buildTallyPrimeTrialBalanceExport({...x,company}), /company/i);
  }
});
