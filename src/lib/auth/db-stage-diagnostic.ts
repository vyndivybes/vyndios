import { classifyAuthFailure } from "./safe-error-diagnostic";

const STAGES = new Set(["resolve", "connect", "query", "close"]);

/** Emit only allowlisted auth database failure stages and classified codes. */
export function reportAuthDriverFailure(stage: string, error: unknown): void {
  const safe = classifyAuthFailure(error);
  console.error("[auth] postgres stage failure", {
    stage: STAGES.has(stage) ? stage : "unknown",
    category: safe.category,
    code: safe.code,
    causeDepth: safe.causeDepth,
  });
}
