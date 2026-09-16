import loadHighs from "highs";
import {
  encodeAdvancedMathModelToCplexLp,
  type HighsLegacyLike,
  type HighsLegacySolutionLike,
} from "./advanced-planning-highs-adapter.ts";
import { compileAdvancedPlanningMathematicalModel } from "./advanced-planning-math-model.ts";
import { compileGovernedHardCapitalConstraints } from "./advanced-planning-hard-capital.ts";
import type { AdvancedPlanningConstraintModel } from "./advanced-planning-constraints.ts";
import type {
  BrowserHighsRawSolution,
  BrowserHighsSolveRequest,
} from "./advanced-planning-browser-offload.ts";

let cachedRuntime: Promise<HighsLegacyLike> | undefined;

type BrowserSolveMessage = {
  id: string;
  model: AdvancedPlanningConstraintModel;
  request: BrowserHighsSolveRequest;
};

type BrowserSolveResponse =
  | { id: string; ok: true; raw: BrowserHighsRawSolution }
  | { id: string; ok: false; error: string };

function loadBrowserHighs(): Promise<HighsLegacyLike> {
  if (!cachedRuntime) {
    const wasmUrl = new URL("../generated/highs.wasm", import.meta.url).href;
    const options = {
      locateFile(path: string) {
        return path.endsWith(".wasm") ? wasmUrl : path;
      },
    } as unknown as Parameters<typeof loadHighs>[0];
    cachedRuntime = loadHighs(options).then((runtime) => runtime as unknown as HighsLegacyLike);
  }
  return cachedRuntime;
}

function compactSolution(solution: HighsLegacySolutionLike): BrowserHighsRawSolution {
  const columns = solution.Columns
    ? Object.fromEntries(
        Object.entries(solution.Columns).map(([id, row]) => [id, { Primal: Number(row.Primal) }]),
      )
    : undefined;
  return {
    Status: String(solution.Status ?? ""),
    ...(Number.isFinite(solution.ObjectiveValue) ? { ObjectiveValue: Number(solution.ObjectiveValue) } : {}),
    ...(columns ? { Columns: columns } : {}),
  };
}

async function solve(model: AdvancedPlanningConstraintModel, request: BrowserHighsSolveRequest) {
  const compiled = compileAdvancedPlanningMathematicalModel(model);
  if (!compiled.valid || !compiled.model) {
    throw new Error(
      `Browser HiGHS compilation failed. ${compiled.issues.map((issue) => `${issue.code}: ${issue.message}`).join(" ")}`,
    );
  }
  const hardCapital = request.hardCapitalEnvelope
    ? compileGovernedHardCapitalConstraints(model, request.hardCapitalEnvelope)
    : { valid: true, variables: [], constraints: [], issues: [], semantics: [] };
  if (!hardCapital.valid) {
    throw new Error(
      `Browser HiGHS hard-capital compilation failed. ${hardCapital.issues.map((issue) => `${issue.code}: ${issue.message}`).join(" ")}`,
    );
  }

  const lp = encodeAdvancedMathModelToCplexLp(compiled.model, hardCapital.constraints);
  const highs = await loadBrowserHighs();
  const solution = highs.solve(lp, {
    output_flag: false,
    log_to_console: false,
    parallel: "off",
    threads: 1,
    random_seed: 0,
    ...(request.maxRuntimeMs ? { time_limit: request.maxRuntimeMs / 1000 } : {}),
    ...(request.mipGap !== undefined ? { mip_rel_gap: request.mipGap } : {}),
  });
  return compactSolution(solution);
}

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<BrowserSolveMessage>) => void) | null;
  postMessage(message: BrowserSolveResponse): void;
};

workerScope.onmessage = (event) => {
  const message = event.data;
  void (async () => {
    try {
      const raw = await solve(message.model, message.request);
      workerScope.postMessage({ id: message.id, ok: true, raw });
    } catch (error) {
      workerScope.postMessage({
        id: message.id,
        ok: false,
        error: error instanceof Error ? error.message : "Browser HiGHS worker failed.",
      });
    }
  })();
};
