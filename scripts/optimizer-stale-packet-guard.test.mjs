import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("optimizer execution rejects superseded packet and IBPE lineage at the server boundary", async () => {
  const execution = await source("src/lib/advanced-optimizer-execution.ts");
  assert.match(execution, /order by created_at desc,id desc/);
  assert.match(execution, /latest complete advanced packet/i);
  assert.match(execution, /latest governed IBPE/i);
  assert.match(execution, /packetId !== latestPacket\.id/);
  assert.match(execution, /preparedParentIbpeRunId !== latestIbpe\.id/);
  assert.match(execution, /latestPacket\.parent_ibpe_run_id !== latestIbpe\.id/);
  assert.match(execution, /latestPacket\.source_sha !== latestIbpe\.source_sha/);
  assert.match(execution, /deployedSourceSha !== latestPacket\.source_sha/);
  assert.match(execution, /superseded/i);
});

test("optimizer freshness is checked before browser solve, before replay and immediately before persistence", async () => {
  const execution = await source("src/lib/advanced-optimizer-execution.ts");
  const matches = execution.match(/assertCurrentExecutionLineage\(sql, data\.packetId, prepared\.parentIbpeRunId\)/g) ?? [];
  assert.equal(matches.length, 3);

  const prepareFn = execution.indexOf("export const prepareAdvancedOptimizerBrowserSolve");
  const first = execution.indexOf("assertCurrentExecutionLineage(sql, data.packetId, prepared.parentIbpeRunId)", prepareFn);
  const persistFn = execution.indexOf("export const persistAdvancedOptimizerBrowserSolve");
  const second = execution.indexOf("assertCurrentExecutionLineage(sql, data.packetId, prepared.parentIbpeRunId)", persistFn);
  const replay = execution.indexOf("runGovernedAdvancedOptimizer(prepared.model, optimizer, request)", persistFn);
  const third = execution.lastIndexOf("assertCurrentExecutionLineage(sql, data.packetId, prepared.parentIbpeRunId)");
  const persist = execution.indexOf("persist_vyndi_advanced_optimization_run_v2", persistFn);

  assert.ok(first > prepareFn, "lineage must be checked before model leaves the server for browser solve");
  assert.ok(second > persistFn && second < replay, "lineage must be rechecked when browser result returns");
  assert.ok(third > replay && third < persist, "lineage must be rechecked immediately before persistence");
});
