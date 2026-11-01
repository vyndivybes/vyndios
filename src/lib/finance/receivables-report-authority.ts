import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getCommandRole } from "@/lib/command-access";
import { getSql } from "@/lib/db";
import { canPerform } from "@/lib/page-access";
import { getRouteMeta } from "@/lib/page-metadata";
import { loadReceivablesAgingReport } from "@/lib/finance/receivables-report";

export const getReceivablesAgingReport = createServerFn({ method: "GET" })
  .validator(z.object({ asOfDate: z.string().date() }))
  .handler(async ({ data }) => {
    const role = await getCommandRole();
    if (!role || !canPerform(role, "view", getRouteMeta("/command/receivables"))) throw new Error("Receivables ageing report view permission denied.");
    return loadReceivablesAgingReport(await getSql(), data.asOfDate);
  });
