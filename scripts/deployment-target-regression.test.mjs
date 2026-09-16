import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const vite = read("vite.config.ts");
const pkg = JSON.parse(read("package.json"));

test("VYNDI keeps explicit Cloudflare and Vercel deployment adapters", () => {
  assert.equal(pkg.devDependencies["@cloudflare/vite-plugin"], "1.54.7");
  assert.equal(pkg.devDependencies.nitro, "3.0.260610-beta");

  assert.match(vite, /import \{ cloudflare \} from "@cloudflare\/vite-plugin"/);
  assert.match(vite, /import \{ nitro \} from "nitro\/vite"/);
  assert.match(vite, /const isVercel = Boolean\(process\.env\.VERCEL\)/);
  assert.match(vite, /isVercel\s*\? \[\]\s*:\s*\[cloudflare\(/s);
  assert.match(vite, /isVercel \? \[nitro\(\{ preset: "vercel", serverDir: "\.\/server" \}\)\] : \[\]/);
});

test("Vercel adapter is not replaced by an unconditional Cloudflare-only build", () => {
  assert.doesNotMatch(vite, /plugins:\s*\[\s*cloudflare\([^]*tanstackStart\(\)[^]*viteReact\(\)\s*,?\s*\]/);
  assert.match(vite, /Vercel needs a routable Nitro server output/);
  assert.match(vite, /Cloudflare keeps its native/);
});
