import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const config = JSON.parse(read('opencode.json'));

test('Chrome DevTools is isolated and rejects telemetry, CrUX and attached browser sessions', () => {
  const chrome = config.mcp['chrome-devtools'];
  assert.equal(chrome.type, 'local');
  assert.equal(chrome.enabled, true);
  for (const flag of ['--isolated', '--no-usage-statistics', '--no-performance-crux']) {
    assert.ok(chrome.command.includes(flag), flag);
  }
  assert.ok(!chrome.command.some((arg) => /^--(?:browserUrl|browser-url|wsEndpoint|ws-endpoint)/.test(arg)));
});

test('all additional MCP integrations remain opt-in and do not contact a paid provider', () => {
  assert.deepEqual(config.mcp.plannotator.command, ['plannotator', 'inbox', 'mcp']);
  assert.equal(config.mcp.plannotator.type, 'local');
  assert.equal(config.mcp.plannotator.enabled, false);
  assert.equal(config.mcp.stitch.enabled, false);
  assert.ok(Object.entries(config.mcp)
    .filter(([name, provider]) => name !== 'chrome-devtools' && provider.enabled)
    .length === 0);
});

const skills = [
  ['modern-web-guidance-governed', 'GoogleChrome/modern-web-guidance'],
  ['plannotator-review', 'backnotprop/plannotator'],
  ['open-code-review-delegate', 'alibaba/open-code-review'],
  ['cloudflare-security-audit', 'cloudflare/security-audit-skill'],
];
for (const [name, origin] of skills) {
  test(name + ' exists as an agent-discoverable skill with upstream provenance', () => {
    const content = read('.agents/skills/' + name + '/SKILL.md');
    assert.ok(content.startsWith('---\nname: ' + name + '\n'));
    assert.ok(content.includes('https://github.com/' + origin));
    assert.ok(content.includes('HOLD') || content.includes('hold'));
    assert.ok(content.includes('approval') || content.includes('Approval'));
  });
}

test('delegated code review does not demand an API key or use native OCR mode', () => {
  const skill = read('.agents/skills/open-code-review-delegate/SKILL.md');
  assert.ok(skill.includes('ocr delegate preview'));
  assert.ok(skill.includes('ocr delegate rule'));
  assert.ok(skill.includes('no separate API key'));
});

test('security skill preserves independent verification and sandbox gate', () => {
  const skill = read('.agents/skills/cloudflare-security-audit/SKILL.md');
  assert.ok(skill.includes('independent verifier'));
  assert.ok(skill.includes('sandbox'));
  assert.ok(skill.includes('needs_validation'));
});

test('review workflow documents founder gates and non-production tool scope', () => {
  const doc = read('docs/development/agent-toolchain-batch1.md');
  assert.ok(doc.includes('founder approval'));
  assert.ok(doc.includes('development-only'));
  assert.ok(doc.includes('not an automated deployment'));
});
