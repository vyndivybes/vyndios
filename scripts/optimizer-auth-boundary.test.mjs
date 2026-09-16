import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

function assertAuthenticatedServerFn(execution, exportName) {
  const serverFn = execution.indexOf(`export const ${exportName}`);
  const middleware = execution.indexOf(".middleware([authMiddleware])", serverFn);
  const handler = execution.indexOf(".handler(async ({ data, context })", serverFn);
  const actor = execution.indexOf('requireBusinessActor("edit", {', handler);

  assert.ok(serverFn >= 0, `${exportName} server function is missing`);
  assert.ok(middleware > serverFn, `${exportName} must use required auth middleware`);
  assert.ok(handler > middleware, `verified auth context must reach ${exportName}`);
  assert.ok(actor > handler, `${exportName} actor must be derived from middleware-verified identity`);
  assert.match(execution.slice(actor, actor + 180), /userId: context\.userId/);
  assert.match(execution.slice(actor, actor + 180), /email: context\.userEmail/);
  assert.doesNotMatch(execution.slice(handler, actor + 180), /requireBusinessActor\("edit"\);/);
}

test("governed browser solver preparation and persistence carry verified auth identity", async () => {
  const execution = await source("src/lib/advanced-optimizer-execution.ts");
  assert.match(execution, /import \{ authMiddleware \} from "\.\/auth\/middleware\.ts";/);
  assertAuthenticatedServerFn(execution, "prepareAdvancedOptimizerBrowserSolve");
  assertAuthenticatedServerFn(execution, "persistAdvancedOptimizerBrowserSolve");
  assert.match(execution, /export async function runAdvancedOptimizerFromPacket/);
});
