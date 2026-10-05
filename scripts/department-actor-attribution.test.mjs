import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

// Exercise actual authority handlers with mocked authentication/SQL boundaries.
// This does not qualify database transactions, schema validation or browser flows.
function loadAuthority(file, identity, denied = false) {
  let source = readFileSync(new URL(`../src/lib/${file}.ts`, import.meta.url), 'utf8');
  source = stripTypeScriptTypes(source).replace(/^import .*;\s*$/gm, '');
  source = source.replace('await import("@tanstack/react-start/server")', '({ getRequest: () => null })');
  const names = [...source.matchAll(/export const (\w+)/g)].map(match => match[1]);
  source = source.replaceAll('export const ', 'const ');
  const calls = [];
  const sql = async (strings, ...values) => {
    calls.push({ text: strings.join('?'), values });
    return [];
  };
  const schema = new Proxy(() => {}, { get: () => schema, apply: () => schema });
  const createServerFn = () => ({ validator() { return this; }, handler(fn) { return fn; } });
  const requireBusinessActor = async () => {
    if (denied) throw new Error('Permission denied');
    return identity;
  };
  const handlers = new Function('createServerFn', 'z', 'getSql', 'requireBusinessActor',
    `${source}\nreturn {${names.join(',')}};`)(createServerFn, schema, async () => sql, requireBusinessActor);
  return { handlers, calls };
}

for (const userId of ['quality-user-a', 'quality-user-b']) {
  test(`inspection and audit retain individual identity: ${userId}`, async () => {
    const { handlers, calls } = loadAuthority('quality-authority', { userId, role: 'qa' });
    await handlers.recordQualityInspection({ data: {
      id: 'I-1', inspectionStage: 'incoming', inspectionType: 'visual', sku: 'SKU-1',
      sampleSize: 1, defectQuantity: 0, result: 'pass', disposition: 'accepted',
      criteriaReference: 'CR-1', evidenceReference: 'EV-1',
    } });
    const writes = calls.filter(call => /insert into/.test(call.text));
    assert.equal(writes.length, 2);
    for (const write of writes) {
      assert.ok(write.values.includes(userId));
      assert.ok(!write.values.includes('command:qa'));
    }
  });
}

test('person and audit retain authenticated individual identity', async () => {
  const { handlers, calls } = loadAuthority('people-office-authority', { userId: 'hr-user-a', role: 'finance' });
  await handlers.savePeopleRecordDraft({ data: {
    id: 'P-1', displayName: 'Test Person', functionName: 'Engineering', roleTitle: 'Engineer',
    engagementType: 'employee', sourceReference: 'EV-2',
  } });
  const writes = calls.filter(call => /insert into/.test(call.text));
  assert.equal(writes.length, 2);
  for (const write of writes) {
    assert.ok(write.values.includes('hr-user-a'));
    assert.ok(!write.values.includes('command:finance'));
  }
});

for (const file of ['quality-authority', 'people-office-authority']) {
  test(`${file}: denied identity cannot reach SQL through any exported handler`, async () => {
    const { handlers, calls } = loadAuthority(file, null, true);
    for (const handler of Object.values(handlers)) {
      await assert.rejects(() => handler({ data: {} }), /Permission denied/);
    }
    assert.equal(calls.length, 0);
  });
}
