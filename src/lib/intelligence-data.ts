import { createServerFn } from "@tanstack/react-start";
import { requireBusinessActor } from "./business-actor.ts";
import { getSql } from "./db.ts";
import type { IntegratedPlanningResult } from "./integrated-business-planning-engine.ts";
import { buildGovernedIntelligence } from "./intelligence-model.ts";
import { readVibpeOptimizerReleaseClosure } from "./vibpe-optimizer-release-closure.ts";

type IbpeRunRow = {
  id: string;
  source_sha: string;
  snapshot_at: string;
  approved_plan_id: string;
  approved_plan_revision: number | string;
  result_json: IntegratedPlanningResult;
};

export const getGovernedIntelligence = createServerFn({ method: "GET" }).handler(async () => {
  await requireBusinessActor("view");
  const sql = await getSql();
  const rows = await sql.query<IbpeRunRow>(
    `select id,source_sha,snapshot_at::text,approved_plan_id,approved_plan_revision,result_json
       from vyndi_ibpe_runs
      where status='complete'
      order by created_at desc,id desc
      limit 1`,
  );
  const row = rows[0];
  const closure = await readVibpeOptimizerReleaseClosure(sql);
  const deployedSourceSha = (
    process.env.VYNDI_SOURCE_SHA || process.env.WORKERS_CI_COMMIT_SHA
    || process.env.CF_PAGES_COMMIT_SHA || process.env.GITHUB_SHA || ""
  ).trim();

  return buildGovernedIntelligence({
    run: row && row.result_json ? {
      id: row.id,
      sourceSha: row.source_sha,
      snapshotAt: row.snapshot_at,
      approvedPlanId: row.approved_plan_id,
      approvedPlanRevision: Number(row.approved_plan_revision),
      result: row.result_json,
    } : null,
    closure,
    deployedSourceSha,
    readAt: new Date().toISOString(),
  });
});
