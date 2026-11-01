import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getCommandRole } from "@/lib/command-access";
import { getSql } from "@/lib/db";
import { canPerform } from "@/lib/page-access";
import { getRouteMeta } from "@/lib/page-metadata";
import { loadPayablesAgingReport } from "@/lib/finance/payables-report";

/** Read-only report. A diagnostic match does not authorize payment or financial close. */
export const getPayablesAgingReport = createServerFn({ method: "GET" })
  .validator(z.object({ asOfDate: z.string().date() }))
  .handler(async ({ data }) => {
    const role = await getCommandRole();
    if (!role || !canPerform(role, "view", getRouteMeta("/command/payables"))) {
      throw new Error("Payables ageing report view permission denied.");
    }
    const sql = await getSql();
    return loadPayablesAgingReport(sql, data.asOfDate);
  });
