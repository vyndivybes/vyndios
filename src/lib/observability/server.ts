export type OperationalOutcome = "success" | "failure";

export type OperationalEventInput = {
  component: string;
  operation: string;
  outcome: OperationalOutcome;
  durationMs: number;
  statusCode?: number;
  failureCategory?: string;
  errorName?: string;
  route?: string;
  sourceSha?: string | null;
};

const shaPattern = /^[0-9a-f]{7,64}$/i;

export function currentRuntimeSourceSha(): string | null {
  const value = typeof process !== "undefined" ? process.env?.VYNDI_SOURCE_SHA?.trim() ?? "" : "";
  return shaPattern.test(value) ? value : null;
}

export async function runtimeSourceSha(): Promise<string | null> {
  const processSha = currentRuntimeSourceSha();
  if (processSha) return processSha;
  try {
    const cloudflareWorkersModule = "cloudflare:workers";
    const workers = await import(/* @vite-ignore */ cloudflareWorkersModule);
    const runtimeEnv = workers.env as Record<string, unknown> | undefined;
    const workerSha = typeof runtimeEnv?.VYNDI_SOURCE_SHA === "string" ? runtimeEnv.VYNDI_SOURCE_SHA.trim() : "";
    return shaPattern.test(workerSha) ? workerSha : null;
  } catch {
    return null;
  }
}

export function emitOperationalEvent(input: OperationalEventInput): void {
  const payload = {
    event: "vyndi.operational",
    timestamp: new Date().toISOString(),
    component: input.component,
    operation: input.operation,
    outcome: input.outcome,
    durationMs: Math.max(0, Math.round(input.durationMs)),
    statusCode: input.statusCode ?? null,
    failureCategory: input.failureCategory ?? null,
    errorName: input.errorName ?? null,
    route: input.route ?? null,
    sourceSha: input.sourceSha ?? currentRuntimeSourceSha(),
  };
  const line = JSON.stringify(payload);
  if (input.outcome === "failure") console.error("[observability]", line);
  else console.info("[observability]", line);
}

export async function observeOperation<T>(
  input: Pick<OperationalEventInput, "component" | "operation" | "route">,
  run: () => Promise<T>,
): Promise<T> {
  const started = Date.now();
  try {
    const result = await run();
    emitOperationalEvent({
      ...input,
      outcome: "success",
      durationMs: Date.now() - started,
    });
    return result;
  } catch (error) {
    emitOperationalEvent({
      ...input,
      outcome: "failure",
      durationMs: Date.now() - started,
      errorName: error instanceof Error ? error.name : typeof error,
    });
    throw error;
  }
}
