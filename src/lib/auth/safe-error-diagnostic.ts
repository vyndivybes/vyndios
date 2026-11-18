export type SafeAuthFailureCategory =
  | "worker-request-io"
  | "database-connection"
  | "database-permission"
  | "database-schema"
  | "cookie-verification"
  | "unknown";

const SAFE_ERROR_CODES = new Set([
  "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EPIPE", "EAI_AGAIN",
  "28P01", "42501", "42P01", "42703", "53300", "57P01",
]);

/** Never return an exception's message, stack, URL, query, or arbitrary code. */
export function classifyAuthFailure(value: unknown): {
  category: SafeAuthFailureCategory;
  code: string | null;
  causeDepth: number;
} {
  const messages: string[] = [];
  let code: string | null = null;
  let causeDepth = 0;

  function collect(candidate: unknown, depth: number): void {
    if (depth > 3) return;
    if (Array.isArray(candidate)) {
      for (const item of candidate.slice(0, 5)) collect(item, depth);
      return;
    }
    if (typeof candidate === "string") {
      messages.push(candidate.slice(0, 1000));
      return;
    }
    if (!candidate || typeof candidate !== "object") return;
    try {
      const record = candidate as { message?: unknown; code?: unknown; cause?: unknown };
      if (typeof record.message === "string") messages.push(record.message.slice(0, 1000));
      if (!code && typeof record.code === "string" && SAFE_ERROR_CODES.has(record.code)) {
        code = record.code;
      }
      if (record.cause !== undefined && record.cause !== candidate) {
        causeDepth = Math.max(causeDepth, depth + 1);
        collect(record.cause, depth + 1);
      }
    } catch {
      // A broken error getter must not create a second authentication failure.
    }
  }
  collect(value, 0);
  const message = messages.join(" ").toLowerCase();
  const category: SafeAuthFailureCategory =
    /i\/o on behalf of a different request|i\/o.*different request|request.owned.*socket|request context.*(expired|lost|different)/.test(message)
      ? "worker-request-io"
      : /econnreset|econnrefused|etimedout|connection.*(closed|reset|refused|terminated)|socket.*(hang up|closed)|too many clients|remaining connection slots/.test(message) ||
        (code !== null && ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EPIPE", "EAI_AGAIN", "53300", "57P01"].includes(code))
        ? "database-connection"
        : /permission denied|authentication failed for user|insufficient privilege/.test(message) || code === "28P01" || code === "42501"
          ? "database-permission"
          : /relation .*does not exist|column .*does not exist|schema.*mismatch/.test(message) || code === "42P01" || code === "42703"
            ? "database-schema"
            : /cookie.*(invalid|expired|signature)|signature.*verification|decrypt.*failed|invalid.*session token/.test(message)
              ? "cookie-verification"
              : "unknown";
  return { category, code, causeDepth };
}
