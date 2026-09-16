import {
  createHighsAdvancedPlanningOptimizer,
  type HighsLegacyLike,
} from "./advanced-planning-highs-adapter.ts";

let cachedNodeRuntime: Promise<HighsLegacyLike> | undefined;

/**
 * Vercel runs the governed optimizer in a Node server function. The pinned
 * `highs` package is externalized by the Vercel Vite/Nitro configuration so
 * its Emscripten loader can resolve its sibling `highs.wasm` exactly as the
 * package intends. Keep the package import inside this function so neither the
 * HiGHS JavaScript runtime nor Wasm is loaded until a human explicitly starts
 * governed optimisation.
 */
export async function createDeploymentHighsOptimizer() {
  if (!cachedNodeRuntime) {
    cachedNodeRuntime = import("highs").then(async ({ default: loadHighs }) => {
      const runtime = await loadHighs();
      return runtime as unknown as HighsLegacyLike;
    });
  }
  const runtime = await cachedNodeRuntime;
  return createHighsAdvancedPlanningOptimizer(runtime);
}
