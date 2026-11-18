/**
 * Build-derived dependency exposure check for the emitted Cloudflare SSR Worker.
 * It does not replace `npm audit`, source-to-sink review, or scanning the deployed version.
 * A clean finding applies only to the source-mapped output under dist/server.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const workerJs = /\.(?:js|mjs|cjs)$/i;
const workerMap = /\.(?:js|mjs|cjs)\.map$/i;
const vulnerableModule = /(?:^|[/\\])picomatch(?:[/\\]|$|@)/i;

async function walk(dir) {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); }
  catch (err) {
    if (err?.code === 'ENOENT') return [];
    throw err;
  }
  const all = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) all.push(...await walk(path));
    else if (entry.isFile()) all.push(path);
  }
  return all;
}

/**
 * @returns {Promise<{verdict:string,jsCount:number,mapCount:number,uncovered:string[],invalidMaps:string[],matches:Array<{chunk:string,source:string}>}>}
 */
export async function scanWorkerBundle(repositoryRoot = process.cwd()) {
  const output = join(resolve(repositoryRoot), 'dist', 'server');
  const files = await walk(output);
  const scripts = files.filter(f => workerJs.test(f));
  const maps = files.filter(f => workerMap.test(f));
  const mapSet = new Set(maps);
  const uncovered = scripts.filter(f => !mapSet.has(`${f}.map`)).map(f => relative(output, f).replaceAll('\\', '/'));
  const invalidMaps = [];
  const matches = [];
  for (const file of maps) {
    let parsed;
    try { parsed = JSON.parse(await readFile(file, 'utf8')); }
    catch { invalidMaps.push(relative(output, file).replaceAll('\\','/')); continue; }
    if (!Array.isArray(parsed.sources) || !parsed.sources.every(s => typeof s === 'string')) {
      invalidMaps.push(relative(output, file).replaceAll('\\','/'));
      continue;
    }
    for (const source of parsed.sources) {
      if (vulnerableModule.test(source.replaceAll('\\','/'))) {
        matches.push({chunk: relative(output, file).replaceAll('\\','/'), source});
      }
    }
  }
  const verdict = matches.length ? 'PRESENT' : !scripts.length || !maps.length || invalidMaps.length || uncovered.length ? 'INCONCLUSIVE' : 'NOT_DETECTED_IN_COVERED_BUNDLE';
  return { verdict, jsCount: scripts.length, mapCount: maps.length, uncovered, invalidMaps, matches };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await scanWorkerBundle();
  console.log('[worker-dependency-exposure]', JSON.stringify({
    ...report,
    sourceSha: process.env.GITHUB_SHA ?? null,
    warning: 'Source-map provenance only. This is not an npm-audit pass or proof that the deployed version is safe.',
  }));
  if (report.verdict !== 'NOT_DETECTED_IN_COVERED_BUNDLE') process.exitCode = 1;
}
