import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const picomatch = require('picomatch');
const SECURITY_ERROR = /VYNDI_PICOMATCH_CVE_2026_112366_BLOCKED/;

test('CVE-2026-112366 known repeated wildcard extglobs are refused before regex generation', () => {
  const adversarial = [
    '+(*)', '+(*a)', '+(a*)', '+(a*b)', '+(*a*)',
    '*(*)', '*(*a)', 'x+(*a)y', '+(a/*)', '+(@(*))'
  ];
  for (const pattern of adversarial) {
    assert.throws(() => picomatch.makeRe(pattern), SECURITY_ERROR, pattern);
  }
});

test('repeated wildcard protection cannot be disabled using matcher options', () => {
  const options = [
    {}, { maxExtglobRecursion: false }, { maxExtglobRecursion: 100 },
    { bash: true }, { windows: true }, { nocase: true },
    { capture: true }, { contains: true }, { fastpaths: false }
  ];
  for (const opts of options) {
    assert.throws(() => picomatch.makeRe('+(*a)', opts), SECURITY_ERROR, JSON.stringify(opts));
    assert.throws(() => picomatch.isMatch('a', '+(*a)', opts), SECURITY_ERROR, JSON.stringify(opts));
  }
});

test('safe literal, glob and extglob behavior remains intact', () => {
  const cases = [
    ['file.js', '*.js', true],
    ['file.ts', '*.js', false],
    ['index.ts', '**/*.ts', true],
    ['js', '@(js|ts)', true],
    ['jpg', '@(js|ts)', false],
    ['abab', '+(ab)', true],
    ['ab', '+(ab)', false],
    ['a*b', 'a\\*b', true]
  ];
  for (const [value, glob, expected] of cases) {
    assert.equal(picomatch.isMatch(value, glob), expected, JSON.stringify([value, glob]));
  }
});

test('the installation matches the controlled, integrity-checked patch', () => {
  execFileSync(process.execPath, ['scripts/security/picomatch-guard.mjs', '--check'], {
    encoding: 'utf8', timeout: 3000, stdio: 'pipe'
  });
});
