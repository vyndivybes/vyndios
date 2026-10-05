import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../src/routes/command/operations.tsx", import.meta.url), "utf8");

test("Operations initial SSR stays database-free under the Worker CPU budget", () => {
  const loaderStart = source.indexOf("loader: async () =>");
  const loaderEnd = source.indexOf("component: Operations", loaderStart);
  assert.ok(loaderStart >= 0 && loaderEnd > loaderStart);
  const loader = source.slice(loaderStart, loaderEnd);
  assert.doesNotMatch(loader, /getInventoryMslWarnings\(\)/);
  assert.match(loader, /return \{\}/);
});

test("Operations loads inventory warnings after hydration as a separate governed request", () => {
  assert.match(source, /useEffect\(/);
  assert.match(source, /getInventoryMslWarnings\(\)/);
  assert.match(source, /setWarnings/);
  assert.match(source, /warningsLoaded/);
});
