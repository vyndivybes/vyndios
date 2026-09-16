import type { AdvancedPlanningConstraintModel } from "./advanced-planning-constraints.ts";
import type {
  BrowserHighsRawSolution,
  BrowserHighsSolveRequest,
} from "./advanced-planning-browser-offload.ts";

type BrowserSolveResponse =
  | { id: string; ok: true; raw: BrowserHighsRawSolution }
  | { id: string; ok: false; error: string };

export async function solveAdvancedPlanningInBrowserWorker(input: {
  model: AdvancedPlanningConstraintModel;
  request: BrowserHighsSolveRequest;
}) {
  if (typeof window === "undefined" || typeof Worker === "undefined") {
    throw new Error("Governed HiGHS browser offload requires a browser with Web Worker support.");
  }

  const worker = new Worker(
    new URL("./advanced-planning-highs-browser-worker.ts", import.meta.url),
    { type: "module", name: "vyndi-highs-optimizer" },
  );
  const id = `HIGHS-${crypto.randomUUID()}`;
  const timeoutMs = Math.max(30_000, (input.request.maxRuntimeMs ?? 12_000) + 20_000);

  return new Promise<BrowserHighsRawSolution>((resolve, reject) => {
    let settled = false;
    const finish = () => {
      if (settled) return false;
      settled = true;
      worker.terminate();
      return true;
    };
    const timer = window.setTimeout(() => {
      if (!finish()) return;
      reject(new Error(`Browser HiGHS worker exceeded the governed ${timeoutMs} ms operator timeout.`));
    }, timeoutMs);

    worker.onmessage = (event: MessageEvent<BrowserSolveResponse>) => {
      if (event.data.id !== id) return;
      window.clearTimeout(timer);
      if (!finish()) return;
      if (!event.data.ok) {
        reject(new Error(event.data.error));
        return;
      }
      resolve(event.data.raw);
    };
    worker.onerror = (event) => {
      window.clearTimeout(timer);
      if (!finish()) return;
      reject(new Error(event.message || "Browser HiGHS Web Worker failed."));
    };

    worker.postMessage({
      id,
      model: input.model,
      request: input.request,
    });
  });
}
