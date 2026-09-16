import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "./auth/middleware.ts";
import { requireBusinessActor } from "./business-actor.ts";
import { getSql } from "./db.ts";
import { loadPreparedAdvancedOptimizerEnvelope } from "./advanced-optimizer-authority.ts";
import {
  createHighsAdvancedPlanningOptimizer,
  type HighsLegacyLike,
  type HighsLegacySolutionLike,
} from "./advanced-planning-highs-adapter.ts";
import { runGovernedAdvancedOptimizer } from "./advanced-planning-optimizer.ts";
import { applyCashGovernanceToOptimizationRun } from "./advanced-planning-cash-governance.ts";
import { GOVERNED_HARD_CAPITAL_VERSION } from "./advanced-planning-hard-capital.ts";
import { diagnoseAdvancedPlanningInfeasibility } from "./advanced-planning-infeasibility.ts";
import { governedOptimizerRuntimeMs } from "./optimizer-resource-budget.ts";
import {
  VYNDI_BROWSER_SOLVER_OFFLOAD_VERSION,
  verifyBrowserHighsRawSolution,
  type BrowserHighsRawSolution,
  type BrowserHighsSolveRequest,
} from "./advanced-planning-browser-offload.ts";

export type RunAdvancedOptimizerFromPacketInput = {
  packetId: string;
  requestId: string;
  maxRuntimeMs?: number;
  mipGap?: number;
};

export type AdvancedOptimizerExecutionReceipt = {
  optimizationRunId: string;
  parentIbpeRunId: string;
  packetId: string;
  preparationVersion: string;
  readyForGovernedOptimization: boolean;
  mathematicalStatus: string;
  cashGovernanceStatus: string;
  cashPlanningDisposition: string;
  firstFundingNeedLakh: number | null;
  firstFundingNeedPeriod: number | null;
  peakAdditionalFundingLakh: number | null;
  peakFundingPeriod: number | null;
  baselineReserveFundingNeedLakh: number | null;
  fundingEvidenceBasis: string | null;
  authoritativeForFundingDecision: boolean | null;
  accepted: boolean;
  firstInfeasibilityWitness: string | null;
  issueCount: number;
};

type LatestPacketRow = {
  id: string;
  parent_ibpe_run_id: string;
  source_sha: string;
};

type LatestIbpeRow = {
  id: string;
  source_sha: string;
};

type PersistBrowserSolveInput = RunAdvancedOptimizerFromPacketInput & {
  offloadVersion: string;
  rawSolution: BrowserHighsRawSolution;
};

function normalizeOptionalNumber(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function currentDeployedSourceSha() {
  return (
    process.env.VYNDI_SOURCE_SHA
    || process.env.WORKERS_CI_COMMIT_SHA
    || process.env.VERCEL_GIT_COMMIT_SHA
    || process.env.CF_PAGES_COMMIT_SHA
    || process.env.GITHUB_SHA
    || ""
  ).trim();
}

async function assertCurrentExecutionLineage(
  sql: Awaited<ReturnType<typeof getSql>>,
  packetId: string,
  preparedParentIbpeRunId: string,
) {
  const latestPacketRows = await sql.query<LatestPacketRow>(
    `select id,parent_ibpe_run_id,source_sha
       from vyndi_advanced_planning_packets
      where status='complete'
      order by created_at desc,id desc
      limit 1`,
  );
  const latestIbpeRows = await sql.query<LatestIbpeRow>(
    `select id,source_sha
       from vyndi_ibpe_runs
      where status='complete'
      order by created_at desc,id desc
      limit 1`,
  );
  const latestPacket = latestPacketRows[0];
  const latestIbpe = latestIbpeRows[0];
  if (!latestPacket) {
    throw new Error("Governed optimization blocked: latest complete advanced packet is unavailable.");
  }
  if (!latestIbpe) {
    throw new Error("Governed optimization blocked: latest governed IBPE run is unavailable.");
  }
  if (packetId !== latestPacket.id) {
    throw new Error(
      `Governed optimization blocked: requested advanced packet is superseded by latest complete advanced packet ${latestPacket.id}. Refresh the governed optimizer before executing.`,
    );
  }
  if (preparedParentIbpeRunId !== latestIbpe.id || latestPacket.parent_ibpe_run_id !== latestIbpe.id) {
    throw new Error(
      `Governed optimization blocked: advanced packet is not derived from latest governed IBPE run ${latestIbpe.id}. Refresh the governed advanced-planning packet.`,
    );
  }
  if (latestPacket.source_sha !== latestIbpe.source_sha) {
    throw new Error("Governed optimization blocked: latest packet source SHA differs from latest governed IBPE source SHA.");
  }
  const deployedSourceSha = currentDeployedSourceSha();
  if (!deployedSourceSha || deployedSourceSha.length < 7) {
    throw new Error("Governed optimization blocked: deployed source SHA is unavailable.");
  }
  if (deployedSourceSha !== latestPacket.source_sha) {
    throw new Error(
      `Governed optimization blocked: latest packet source ${latestPacket.source_sha} does not match deployed source ${deployedSourceSha}. Run governed IBPE and refresh the advanced packet on the current deployment.`,
    );
  }
}

function hardCapitalEnvelope(prepared: Awaited<ReturnType<typeof loadPreparedAdvancedOptimizerEnvelope>>) {
  return {
    version: GOVERNED_HARD_CAPITAL_VERSION,
    sourceRef: prepared.evidence.cashSourceRef,
    cashAnchorPeriod: prepared.cashTiming.cashAnchorPeriod,
    analysisStartPeriod: prepared.cashTiming.analysisStartPeriod,
    paymentLagBySku: prepared.cashTiming.paymentLagBySku,
    guardrails: prepared.cashGuardrails.map((row) => ({
      period: row.period,
      cumulativeHeadroomLakh: row.cumulativeIncrementalProcurementHeadroomLakh,
      sourceRef: row.sourceRef,
    })),
    fundingPlan: prepared.fundingPlan,
  };
}

function assertReady(prepared: Awaited<ReturnType<typeof loadPreparedAdvancedOptimizerEnvelope>>) {
  if (prepared.readyForGovernedOptimization) return;
  const reasons = prepared.issues
    .filter((issue) => issue.severity === "error")
    .map((issue) => `${issue.code}: ${issue.message}`)
    .join(" ");
  throw new Error(`Governed optimization blocked by preparation gate.${reasons ? ` ${reasons}` : ""}`);
}

function browserSolveRequest(
  prepared: Awaited<ReturnType<typeof loadPreparedAdvancedOptimizerEnvelope>>,
  data: RunAdvancedOptimizerFromPacketInput,
): BrowserHighsSolveRequest {
  const effectiveMaxRuntimeMs = governedOptimizerRuntimeMs(data.maxRuntimeMs);
  if (!Number.isFinite(effectiveMaxRuntimeMs) || effectiveMaxRuntimeMs <= 0) {
    throw new Error("Governed optimization maximum runtime must be a positive finite value.");
  }
  return {
    requestId: data.requestId,
    maxRuntimeMs: effectiveMaxRuntimeMs,
    ...(data.mipGap === undefined ? {} : { mipGap: data.mipGap }),
    hardCapitalEnvelope: hardCapitalEnvelope(prepared),
  };
}

/**
 * Server preparation remains authoritative. It verifies edit authority, the
 * exact latest packet/IBPE/source lineage, readiness, cash timing and the hard
 * capital envelope, then returns the immutable model for one browser Web Worker
 * solve. No HiGHS runtime is instantiated on Cloudflare.
 */
export const prepareAdvancedOptimizerBrowserSolve = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: RunAdvancedOptimizerFromPacketInput) => ({
    packetId: String(input.packetId ?? "").trim().slice(0, 240),
    requestId: String(input.requestId ?? "").trim().slice(0, 240),
    maxRuntimeMs: normalizeOptionalNumber(input.maxRuntimeMs),
    mipGap: normalizeOptionalNumber(input.mipGap),
  }))
  .handler(async ({ data, context }) => {
    await requireBusinessActor("edit", {
      userId: context.userId,
      email: context.userEmail,
    });
    if (!data.packetId) throw new Error("Governed optimization requires an exact advanced packet ID.");
    if (!data.requestId) throw new Error("Governed optimization requires a request ID.");

    const prepared = await loadPreparedAdvancedOptimizerEnvelope(data.packetId);
    assertReady(prepared);
    const sql = await getSql();
    await assertCurrentExecutionLineage(sql, data.packetId, prepared.parentIbpeRunId);
    const request = browserSolveRequest(prepared, data);

    return {
      packetId: prepared.packetId,
      parentIbpeRunId: prepared.parentIbpeRunId,
      preparationVersion: prepared.version,
      model: prepared.model,
      request,
      offloadVersion: VYNDI_BROWSER_SOLVER_OFFLOAD_VERSION,
    };
  });

/**
 * Server persistence never trusts the browser's business interpretation. The
 * submitted HiGHS primal is independently recompiled and checked against every
 * governed model/hard-capital row. Only then is the standard optimizer contract
 * replayed from that verified primal, cash governance applied, lineage rechecked
 * and immutable evidence persisted.
 */
export const persistAdvancedOptimizerBrowserSolve = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: PersistBrowserSolveInput) => ({
    packetId: String(input.packetId ?? "").trim().slice(0, 240),
    requestId: String(input.requestId ?? "").trim().slice(0, 240),
    maxRuntimeMs: normalizeOptionalNumber(input.maxRuntimeMs),
    mipGap: normalizeOptionalNumber(input.mipGap),
    offloadVersion: String(input.offloadVersion ?? "").trim().slice(0, 120),
    rawSolution: input.rawSolution,
  }))
  .handler(async ({ data, context }): Promise<AdvancedOptimizerExecutionReceipt> => {
    const actor = await requireBusinessActor("edit", {
      userId: context.userId,
      email: context.userEmail,
    });
    if (!data.packetId) throw new Error("Governed optimization requires an exact advanced packet ID.");
    if (!data.requestId) throw new Error("Governed optimization requires a request ID.");
    if (data.offloadVersion !== VYNDI_BROWSER_SOLVER_OFFLOAD_VERSION) {
      throw new Error("Governed optimization rejected: browser solver offload contract version is stale.");
    }

    const prepared = await loadPreparedAdvancedOptimizerEnvelope(data.packetId);
    assertReady(prepared);
    const sql = await getSql();
    await assertCurrentExecutionLineage(sql, data.packetId, prepared.parentIbpeRunId);
    const request = browserSolveRequest(prepared, data);

    const verification = verifyBrowserHighsRawSolution(prepared.model, request, data.rawSolution);
    if (!verification.valid) {
      throw new Error(
        `Governed optimization rejected: browser solver result failed server verification. ${verification.issues.slice(0, 8).join(" | ")}`,
      );
    }

    const browserReportedInfeasible = verification.reportedStatus === "infeasible" && !verification.primalValidated;
    const replaySolution: HighsLegacySolutionLike = browserReportedInfeasible
      ? {
          Status: "Browser-reported infeasible without server primal certificate",
          Columns: {},
        }
      : data.rawSolution as HighsLegacySolutionLike;
    const replayRuntime: HighsLegacyLike = {
      solve() {
        return replaySolution;
      },
    };
    const optimizer = createHighsAdvancedPlanningOptimizer(replayRuntime);
    const mathematicalRun = await runGovernedAdvancedOptimizer(prepared.model, optimizer, request);

    if (browserReportedInfeasible && mathematicalRun.result) {
      const diagnosis = diagnoseAdvancedPlanningInfeasibility(prepared.model);
      mathematicalRun.result.diagnostics = [
        ...mathematicalRun.result.diagnostics,
        "BROWSER_REPORTED_INFEASIBLE_UNVERIFIED: no business action may rely on infeasibility without a server-verifiable primal/certificate.",
        ...diagnosis.diagnostics,
      ];
    } else if (mathematicalRun.result?.status === "infeasible") {
      const diagnosis = diagnoseAdvancedPlanningInfeasibility(prepared.model);
      mathematicalRun.result.diagnostics = [
        ...mathematicalRun.result.diagnostics,
        ...diagnosis.diagnostics,
      ];
    }

    const governedRun = applyCashGovernanceToOptimizationRun(
      mathematicalRun,
      prepared.model,
      prepared.cashGuardrails,
      prepared.cashTiming,
    );
    const optimizationStatus = governedRun.result?.status ?? "error";
    const firstInfeasibilityWitness = governedRun.result?.diagnostics.find((line) =>
      line.startsWith("INFEASIBILITY_WITNESS "),
    ) ?? null;
    const fundingRequirement = governedRun.cashGovernance.fundingRequirement;
    const runId = `OPT-${crypto.randomUUID()}`;

    // Re-check immediately before persistence so a packet/IBPE refresh that
    // occurs while the browser is solving cannot persist a superseded run.
    await assertCurrentExecutionLineage(sql, data.packetId, prepared.parentIbpeRunId);

    const rows = await sql.query<{ id: string }>(
      `select persist_vyndi_advanced_optimization_run_v2(
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
         $13::jsonb,$14::jsonb,$15::jsonb,$16::jsonb,$17::jsonb,$18,$19::jsonb,$20,$21
       ) as id`,
      [
        runId,
        prepared.packetId,
        governedRun.requestId,
        governedRun.contractVersion,
        governedRun.optimizer.id,
        governedRun.optimizer.version,
        governedRun.optimizer.engine,
        governedRun.optimizer.solverClass,
        governedRun.optimizer.deterministic,
        governedRun.accepted,
        optimizationStatus,
        governedRun.result?.objectiveValue ?? null,
        JSON.stringify({
          ...request,
          packetId: prepared.packetId,
          preparationVersion: prepared.version,
          lineage: prepared.lineage,
          evidence: prepared.evidence,
          cashTiming: prepared.cashTiming,
          executionLocation: "browser-web-worker",
          browserSolverEvidence: {
            offloadVersion: data.offloadVersion,
            reportedStatus: verification.reportedStatus,
            primalValidated: verification.primalValidated,
            expectedVariableCount: verification.expectedVariableCount,
            constraintCount: verification.constraintCount,
            reconstructedObjectiveValue: verification.reconstructedObjectiveValue,
          },
        }),
        JSON.stringify(governedRun.governance),
        JSON.stringify(governedRun.baseline),
        governedRun.result ? JSON.stringify(governedRun.result) : null,
        JSON.stringify(governedRun.issues),
        governedRun.cashGovernance.status,
        JSON.stringify(governedRun.cashGovernance),
        actor.userId,
        actor.role,
      ],
    );

    return {
      optimizationRunId: rows[0]?.id ?? runId,
      parentIbpeRunId: prepared.parentIbpeRunId,
      packetId: prepared.packetId,
      preparationVersion: prepared.version,
      readyForGovernedOptimization: prepared.readyForGovernedOptimization,
      mathematicalStatus: optimizationStatus,
      cashGovernanceStatus: governedRun.cashGovernance.status,
      cashPlanningDisposition: governedRun.cashGovernance.planningDisposition,
      firstFundingNeedLakh: fundingRequirement?.firstFundingNeedLakh ?? null,
      firstFundingNeedPeriod: fundingRequirement?.firstFundingNeedPeriod ?? null,
      peakAdditionalFundingLakh: fundingRequirement?.peakAdditionalFundingLakh ?? null,
      peakFundingPeriod: fundingRequirement?.peakFundingPeriod ?? null,
      baselineReserveFundingNeedLakh: fundingRequirement?.baselineReserveFundingNeedLakh ?? null,
      fundingEvidenceBasis: fundingRequirement?.evidenceBasis ?? null,
      authoritativeForFundingDecision: fundingRequirement?.authoritativeForFundingDecision ?? null,
      accepted: governedRun.accepted,
      firstInfeasibilityWitness,
      issueCount: governedRun.issues.length,
    };
  });

/**
 * Human-initiated browser orchestration. The expensive HiGHS Wasm solve happens
 * in a dedicated Web Worker, not inside the Cloudflare request. Cloudflare only
 * prepares immutable governed inputs, verifies the returned primal and persists
 * advisory evidence.
 */
export async function runAdvancedOptimizerFromPacket(args: {
  data: RunAdvancedOptimizerFromPacketInput;
}): Promise<AdvancedOptimizerExecutionReceipt> {
  if (typeof window === "undefined" || typeof Worker === "undefined") {
    throw new Error("Governed HiGHS execution requires a browser with Web Worker support.");
  }

  const prepared = await prepareAdvancedOptimizerBrowserSolve({ data: args.data });
  const { solveAdvancedPlanningInBrowserWorker } = await import(
    "./advanced-planning-highs-browser-client.ts"
  );
  const rawSolution = await solveAdvancedPlanningInBrowserWorker({
    model: prepared.model,
    request: prepared.request,
  });

  return persistAdvancedOptimizerBrowserSolve({
    data: {
      ...args.data,
      offloadVersion: prepared.offloadVersion,
      rawSolution,
    },
  });
}
