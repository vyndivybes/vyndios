import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { scanWorkerBundle } from './worker-dependency-exposure.mjs';

async function withBundle(chunks, cb) {
  const root = await mkdtemp(join(tmpdir(), 'vyndi-worker-exposure-'));
  const server = join(root, 'dist', 'server', 'assets');
  await mkdir(server, { recursive: true });
  try {
    for (const [name, content] of Object.entries(chunks)) {
      await writeFile(join(server, name), typeof content === 'string' ? content : JSON.stringify(content));
    }
    await cb(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const map = (sources) => ({version:3, file:'entry.js', sources, names:[], mappings:''});

test('identifies picomatch module present in worker sourcemap', async () => {
  await withBundle({'entry.js':'export default {};', 'entry.js.map':map(['../../src/server.ts','../../../node_modules/picomatch/lib/picomatch.js'])}, async root => {
    const report=await scanWorkerBundle(root);
    assert.equal(report.verdict,'PRESENT');
    assert.equal(report.matches.length,1);
    assert.match(report.matches[0].source,/picomatch/);
  });
});

test('confirms no picomatch only when every worker JS has source-map evidence', async () => {
  await withBundle({'entry.js':'export default {};', 'entry.js.map':map(['../../src/server.ts'])}, async root => {
    const report=await scanWorkerBundle(root);
    assert.equal(report.verdict,'NOT_DETECTED_IN_COVERED_BUNDLE');
    assert.equal(report.jsCount,1);
    assert.equal(report.mapCount,1);
    assert.deepEqual(report.uncovered,[]);
  });
});

test('reports inconclusive if any JS chunk lacks a map', async () => {
  await withBundle({'entry.js':'export default {};','other.js':'export default {};','entry.js.map':map(['../../src/server.ts'])}, async root => {
    const report=await scanWorkerBundle(root);
    assert.equal(report.verdict,'INCONCLUSIVE');
    assert.ok(report.uncovered.some(name=>name.endsWith('other.js')));
  });
});

test('reports inconclusive if sourcemaps are missing', async () => {
  await withBundle({'entry.js':'export default {};'}, async root => {
    const report=await scanWorkerBundle(root);
    assert.equal(report.verdict,'INCONCLUSIVE');
  });
});

test('reports inconclusive if sourcemap cannot be parsed', async () => {
  await withBundle({'entry.js':'export default {};','entry.js.map':'not json'}, async root => {
    const report=await scanWorkerBundle(root);
    assert.equal(report.verdict,'INCONCLUSIVE');
    assert.equal(report.invalidMaps.length,1);
  });
});
