export class SessionVerificationTimeoutError extends Error {
  readonly status = 503;
  readonly code = "SESSION_VERIFICATION_TIMEOUT";
  constructor() {
    super("Sign-in verification took too long. Please try again.");
    this.name = "SessionVerificationTimeoutError";
  }
}

/** Bound the caller's wait; never substitute an identity or retry auth work.
 * The underlying operation may finish later; its result is deliberately ignored.
 */
export async function withSessionDeadline<T>(
  work: () => Promise<T>,
  timeoutMs = 15_000,
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new RangeError("Invalid session deadline");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(work),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new SessionVerificationTimeoutError()), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
