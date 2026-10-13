/**
 * Public GitHub Actions diagnostics for SLO failures. This module MUST NOT
 * expose raw exception strings, page contents, cookies, identity or URLs.
 * Full browser evidence remains local/private in the job workspace.
 */
function failureReason(sample) {
  const message = String(sample.error ?? "");
  const status = Number(sample.status);
  if (/lost authenticated access|unauthenticated|redirected? to.*login/i.test(message) || status === 401 || status === 403) {
    return "AUTH_REDIRECT";
  }
  if (Number.isFinite(status) && status >= 500) return "HTTP_5XX";
  if (Number.isFinite(status) && status >= 400) return "HTTP_4XX";
  if (/timeout|timed out/i.test(message)) return "NAVIGATION_TIMEOUT";
  if (Array.isArray(sample.pageErrors) && sample.pageErrors.length) return "BROWSER_EXCEPTION";
  if (/pageerror|browser.*errors/i.test(message)) return "BROWSER_EXCEPTION";
  if (/fatal error|something went wrong|internal server error/i.test(message)) return "RENDER_FAILURE";
  return "ROUTE_ASSERTION_FAILURE";
}

export function summarizePublicFailureDiagnostics(samples) {
  const failed = samples.filter(sample => !sample.ok);
  const grouped = new Map();
  for (const sample of failed) {
    // Route names come from the SLO runner's fixed protectedRoutes array.
    const route = sample.route;
    if (!grouped.has(route)) grouped.set(route, { route, failures: 0, statuses: {}, reasons: {} });
    const group = grouped.get(route);
    group.failures += 1;
    const status = Number.isInteger(sample.status) ? String(sample.status) : "NO_RESPONSE";
    group.statuses[status] = (group.statuses[status] ?? 0) + 1;
    const reason = failureReason(sample);
    group.reasons[reason] = (group.reasons[reason] ?? 0) + 1;
  }
  return {
    samples: samples.length,
    failures: failed.length,
    routeFailures: [...grouped.values()].sort((a, b) => a.route.localeCompare(b.route)),
  };
}
