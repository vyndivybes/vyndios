import { createServerEntry } from "@tanstack/react-start/server-entry";
import { createStartHandler, defaultStreamHandler, defineHandlerCallback } from "@tanstack/react-start/server";
import { timeStage, traceRequest } from "./lib/request-timing.server";

const fetch = createStartHandler(defineHandlerCallback((ctx) =>
  timeStage("ssr", () => defaultStreamHandler(ctx)),
));

export default createServerEntry({
  fetch: (request, options) => traceRequest(request, () => fetch(request, options)),
});
