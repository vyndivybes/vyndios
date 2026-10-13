import { createRequestMemoizer } from "./request-memo.server.ts";

/** Only completed readiness may be shared across Worker requests. */
export function createRequestReadinessGate() {
  let ready = false;
  const memoize = createRequestMemoizer<void>();
  return async (request: Request | undefined, check: () => Promise<void>): Promise<void> => {
    if (ready) return;
    const verify = async () => {
      await check();
      ready = true;
    };
    if (request) await memoize(request, "schema", verify);
    else await verify();
  };
}
