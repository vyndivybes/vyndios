/**
 * VYNDI OS local mitigation for GHSA-fc5q-39xc-vjpf / CVE-2026-112366.
 *
 * Fail closed rather than compiling repeated, ambiguous wildcard extglobs.
 * Only the exact, reviewed picomatch@4.0.7 upstream source blob may be patched.
 * This is NOT an upstream fix and it does NOT clear npm audit.
 *
 * Usage: node scripts/security/picomatch-guard.mjs --apply | --check
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_VERSION = '4.0.7';
const UPSTREAM_GIT_BLOB = '29207512c60183b4bb9bf5112be3b9b5f4a9a9fd';
const FUNCTION_ANCHOR = 'const analyzeRepeatedExtglob = (body, options) => {';
const CALL_ANCHOR = '    const analysis = analyzeRepeatedExtglob(body, opts);';
const MARKER = 'VYNDI_OS_GHSA_fc5q_39xc_vjpf_controlled_patch';

/**
 * Reject ambiguous, unbounded star repetition before picomatch creates RegExp.
 * Ordinary single stars, globstars, @(), ?(), !(), and safe +() repeats
 * continue using the original implementation.
 *
 * This intentionally rejects some legitimate, uncommon repeated extglobs.
 * Denial is a documented compatibility tradeoff, not regex rewriting.
 */
function vulnerableRepeatedWildcardBody(body) {
  let escaped = false;
  let bracket = false;
  for (const ch of body) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '[') {
      bracket = true;
      continue;
    }
    if (ch === ']' && bracket) {
      bracket = false;
      continue;
    }
    if (ch === '*' && !bracket) return true;
  }
  return false;
}

const FUNCTION_INSERT = [
  '// ' + MARKER,
  vulnerableRepeatedWildcardBody.toString(),
  ''
].join('\n');
const CALL_INSERT = [
  '    // ' + MARKER + ': deny unsafe regex construction, regardless of parser options.',
  "    if ((token.type === 'plus' || token.type === 'star') && vulnerableRepeatedWildcardBody(body)) {",
  "      throw new SyntaxError('VYNDI_PICOMATCH_CVE_2026_112366_BLOCKED: repeated wildcard extglob');",
  '    }',
  ''
].join('\n');

function gitBlobSha(text) {
  return createHash('sha1')
    .update('blob ' + Buffer.byteLength(text, 'utf8') + '\0')
    .update(text, 'utf8')
    .digest('hex');
}

function exactlyOnce(text, anchor) {
  if (text.split(anchor).length !== 2) {
    throw new Error('PICOMATCH_PATCH_HOLD: source anchor missing or duplicated');
  }
}

export function qualifyAndPatch(source) {
  const hasFunction = source.includes(FUNCTION_INSERT);
  const hasCall = source.includes(CALL_INSERT);
  if (hasFunction !== hasCall) {
    throw new Error('PICOMATCH_PATCH_HOLD: partial or modified mitigation detected');
  }

  let pristine = source;
  if (hasFunction && hasCall) {
    exactlyOnce(pristine, FUNCTION_INSERT);
    exactlyOnce(pristine, CALL_INSERT);
    pristine = pristine.replace(FUNCTION_INSERT, '').replace(CALL_INSERT, '');
  } else if (pristine.includes(MARKER)) {
    throw new Error('PICOMATCH_PATCH_HOLD: unrecognized existing mitigation');
  }

  if (gitBlobSha(pristine) !== UPSTREAM_GIT_BLOB) {
    throw new Error('PICOMATCH_PATCH_HOLD: upstream source integrity mismatch (' + gitBlobSha(pristine) + ')');
  }

  exactlyOnce(pristine, FUNCTION_ANCHOR);
  exactlyOnce(pristine, CALL_ANCHOR);
  const patched = pristine
    .replace(FUNCTION_ANCHOR, FUNCTION_INSERT + FUNCTION_ANCHOR)
    .replace(CALL_ANCHOR, CALL_INSERT + CALL_ANCHOR);
  if (hasFunction && source !== patched) {
    throw new Error('PICOMATCH_PATCH_HOLD: patched source differs from controlled transform');
  }
  return { patched, alreadyPatched: hasFunction };
}

export function qualifyInstalled(options = {}) {
  const root = resolve(options.root ?? process.cwd());
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
  const locations = Object.entries(lock.packages ?? {})
    .filter(([path]) => path === 'node_modules/picomatch' || path.endsWith('/node_modules/picomatch'));
  assert.equal(locations.length, 1, 'PICOMATCH_PATCH_HOLD: unexpected dependency instances');
  assert.equal(locations[0][0], 'node_modules/picomatch', 'PICOMATCH_PATCH_HOLD: unexpected package location');
  assert.equal(locations[0][1].version, PACKAGE_VERSION, 'PICOMATCH_PATCH_HOLD: lockfile version changed');

  const packageRoot = join(root, 'node_modules', 'picomatch');
  const installed = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
  assert.equal(installed.version, PACKAGE_VERSION, 'PICOMATCH_PATCH_HOLD: installed version changed');

  const sourcePath = join(packageRoot, 'lib', 'parse.js');
  const source = readFileSync(sourcePath, 'utf8');
  return { sourcePath, ...qualifyAndPatch(source) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const action = process.argv[2];
  if (action !== '--apply' && action !== '--check') {
    throw new Error('Usage: picomatch-guard.mjs --apply | --check');
  }
  const result = qualifyInstalled();
  if (action === '--check' && !result.alreadyPatched) {
    throw new Error('PICOMATCH_PATCH_HOLD: dependency is unpatched');
  }
  if (action === '--apply' && !result.alreadyPatched) {
    writeFileSync(result.sourcePath, result.patched, 'utf8');
    if (!qualifyInstalled().alreadyPatched) {
      throw new Error('PICOMATCH_PATCH_HOLD: write did not persist');
    }
  }
  console.log('PICOMATCH_LOCAL_MITIGATION_PASS: controlled guard present; npm audit advisory remains open');
}
