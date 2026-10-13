import { AsyncLocalStorage } from "node:async_hooks";

type Stage = "request" | "session.verify" | "role.resolve" | "command.beforeLoad" | "route.loader" | "schema.ready" | "db.connect" | "db.query" | "db.close" | "auth.connect" | "auth.query" | "auth.close" | "ssr";
type State = "start" | "end" | "error" | "canceled";
type Timing = { sequence: number; stage: Stage; state: State; elapsedMs: number; durationMs: number };
type Trace = { traceId: string; rayId: string | null; started: number; sequence: number; events: Timing[]; last?: Timing };
const traces = new AsyncLocalStorage<Trace>();
const MAX_EVENTS = 128;

function record(stage: Stage, state: State, started: number) {
  const trace = traces.getStore();
  if (!trace) return;
  const now = Date.now();
  const event = { sequence: ++trace.sequence, stage, state, elapsedMs: now - trace.started, durationMs: now - started };
  trace.last = event;
  if (trace.events.length < MAX_EVENTS) trace.events.push(event);
}

function flush(trace: Trace, reason: "slow" | "error" | "canceled" | "complete") {
  // Fixed stage labels only. No URLs, identities, SQL, credentials or errors.
  console.info(JSON.stringify({ event: "request-stage-summary", traceId: trace.traceId, rayId: trace.rayId,
    reason, events: trace.events, last: trace.last, truncated: trace.sequence > MAX_EVENTS }));
}

export async function timeStage<T>(stage: Stage, work: () => Promise<T>): Promise<T> {
  if (!traces.getStore()) return work();
  const started = Date.now();
  record(stage, "start", started);
  try { const result = await work(); record(stage, "end", started); return result; }
  catch (error) { record(stage, "error", started); throw error; }
}

export async function traceRequest<T>(request: Request, work: () => Promise<T>,
  options: { emitSuccessful?: boolean; slowAfterMs?: number } = {}): Promise<T> {
  const ray = request.headers.get("cf-ray")?.split("-")[0] ?? "";
  const trace: Trace = { traceId: crypto.randomUUID(), rayId: /^[a-f0-9]{16}$/i.test(ray) ? ray : null,
    started: Date.now(), sequence: 0, events: [] };
  return traces.run(trace, async () => {
    // One watchdog captures a stranded stage before the client cancels. Normal
    // requests do no JSON serialization or per-stage logging on the hot path.
    let slow = false;
    let failed = false;
    const watchdog = setTimeout(() => { slow = true; flush(trace, "slow"); }, options.slowAfterMs ?? 2_000);
    const canceled = () => { record("request", "canceled", trace.started); flush(trace, "canceled"); };
    request.signal.addEventListener("abort", canceled, { once: true });
    try { return await timeStage("request", work); }
    catch (error) { failed = true; flush(trace, "error"); throw error; }
    finally {
      clearTimeout(watchdog);
      request.signal.removeEventListener("abort", canceled);
      if (!failed && (slow || options.emitSuccessful)) flush(trace, "complete");
    }
  });
}
