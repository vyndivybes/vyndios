import { AsyncLocalStorage } from "node:async_hooks";

type Stage = "request" | "session.verify" | "role.resolve" | "command.beforeLoad" | "route.loader" | "schema.ready" | "db.connect" | "db.query" | "db.close" | "auth.connect" | "auth.query" | "auth.close" | "ssr";
type Trace = { traceId: string; rayId: string | null; started: number; sequence: number };
const traces = new AsyncLocalStorage<Trace>();

function emit(stage: Stage, state: "start" | "end" | "error" | "canceled", started: number) {
  const trace = traces.getStore();
  if (!trace) return;
  console.log(JSON.stringify({ event: "request-stage", traceId: trace.traceId, rayId: trace.rayId,
    sequence: ++trace.sequence, stage, state, elapsedMs: Date.now() - trace.started,
    durationMs: Date.now() - started }));
}

// No URLs, user identities, SQL, parameters, cookies or error messages enter logs.
export async function timeStage<T>(stage: Stage, work: () => Promise<T>): Promise<T> {
  const started = Date.now();
  emit(stage, "start", started);
  try { const result = await work(); emit(stage, "end", started); return result; }
  catch (error) { emit(stage, "error", started); throw error; }
}

export async function traceRequest<T>(request: Request, work: () => Promise<T>): Promise<T> {
  const ray = request.headers.get("cf-ray")?.split("-")[0] ?? "";
  const trace: Trace = { traceId: crypto.randomUUID(), rayId: /^[a-f0-9]{16}$/i.test(ray) ? ray : null,
    started: Date.now(), sequence: 0 };
  return traces.run(trace, async () => {
    const canceled = () => emit("request", "canceled", trace.started);
    request.signal.addEventListener("abort", canceled, { once: true });
    try { return await timeStage("request", work); }
    finally { request.signal.removeEventListener("abort", canceled); }
  });
}
