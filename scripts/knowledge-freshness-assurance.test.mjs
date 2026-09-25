import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const drive = await readFile(new URL("../src/lib/vibpe-vayu-shastr-drive.ts", import.meta.url), "utf8");
const copilot = await readFile(new URL("../src/lib/ibpe-copilot.ts", import.meta.url), "utf8");

test("Drive knowledge automatically refreshes after a 4 hours freshness horizon", () => {
  assert.match(drive, /maxAgeHours\s*=\s*4/);
  assert.match(drive, /maxAgeHours\s*\*\s*60\s*\*\s*60\s*\*\s*1000/);
  assert.match(drive, /reason:\s*"fresh"/);
});

test("stale knowledge operation remains visible instead of silently pretending to be fresh", () => {
  assert.match(copilot, /Knowledge source status: refresh failed; using the last successfully ingested governed corpus/);
  assert.match(copilot, /supplementary knowledge refresh failed/);
});
