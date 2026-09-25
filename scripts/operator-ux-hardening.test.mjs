import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./operator-ux-hardening.mjs", import.meta.url), "utf8");

test("operator UX qualification covers desktop, compact desktop and mobile", () => {
  for (const width of ["1440", "1180", "390"]) assert.match(source, new RegExp(width));
  assert.match(source, /scrollWidth/);
  assert.match(source, /clientWidth/);
  assert.match(source, /financial-cockpit/);
});
