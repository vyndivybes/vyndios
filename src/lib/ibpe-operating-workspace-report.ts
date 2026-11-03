/** Authenticated, read-only IBPE evidence projection.
 * Kept off the route's SSR critical path so database report latency cannot
 * block the protected page from rendering or masquerade as missing navigation.
 * Existing getAllErpSuiteReports() enforces the request's view authority.
 */
import { createServerFn } from "@tanstack/react-start";
import { getAllErpSuiteReports } from "./erp-suite-reports";
import { buildIbpeOperatingWorkspace, type IbpeErpReportPack } from "./ibpe-operating-workspace";

export const getIbpeOperatingWorkspaceReport = createServerFn({ method: "GET" }).handler(async () => {
  const report = await getAllErpSuiteReports();
  return buildIbpeOperatingWorkspace(report as IbpeErpReportPack);
});
