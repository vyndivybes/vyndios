import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getSql } from "@/lib/db";
import { getCommandRole } from "@/lib/command-access";
import { canPerform } from "@/lib/page-access";
import { requireBusinessActor } from "@/lib/business-actor";

export const CASH_FUNDING_SOURCES = [
  "founder_funding",
  "bridge_funding",
  "grant",
  "share_subscription",
  "loan",
  "other_funding",
] as const;

export const CASH_ACCOUNTING_CLASSIFICATIONS = [
  "pending",
  "share_capital",
  "founder_loan",
  "grant_income",
  "debt",
  "other",
] as const;

export type CashFundingReceiptRow = {
  id: string;
  plan_month: number | string;
  received_on: string;
  amount_lakh: number | string;
  funding_source: string;
  accounting_classification: string;
  evidence_reference: string;
  notes: string;
  verified: boolean;
  created_by: string;
  created_at: string;
};

const fundingReceiptSchema = z.object({
  planMonth: z.number().int().min(1).max(36),
  receivedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amountLakh: z.number().finite().positive().max(10000),
  fundingSource: z.enum(CASH_FUNDING_SOURCES),
  accountingClassification: z.enum(CASH_ACCOUNTING_CLASSIFICATIONS).default("pending"),
  evidenceReference: z.string().trim().min(3).max(500),
  notes: z.string().trim().max(2000).default(""),
});

async function requireView() {
  const role = await getCommandRole();
  if (!role || !canPerform(role, "view")) throw new Error("Cash funding authority view permission denied.");
}

export const listCashFundingReceipts = createServerFn({ method: "GET" }).handler(async () => {
  await requireView();
  const sql = await getSql();
  return sql.query<CashFundingReceiptRow>(`
    select id,plan_month,received_on::text,amount_lakh,funding_source,
           accounting_classification,evidence_reference,notes,verified,
           created_by,created_at::text
      from vyndi_cash_funding_receipts
     order by received_on desc,created_at desc,id desc
  `);
});

export const postCashFundingReceipt = createServerFn({ method: "POST" })
  .validator(fundingReceiptSchema)
  .handler(async ({ data }) => {
    const actor = await requireBusinessActor("approve");
    const sql = await getSql();
    const id = `CASH-${crypto.randomUUID()}`;
    const rows = await sql.query<{
      receipt_id: string;
      new_closing_cash_lakh: number | string;
      actual_revision: number | string;
    }>(
      `select * from post_vyndi_cash_funding_receipt($1,$2,$3::date,$4,$5,$6,$7,$8,$9,$10)`,
      [
        id,
        data.planMonth,
        data.receivedOn,
        data.amountLakh,
        data.fundingSource,
        data.accountingClassification,
        data.evidenceReference,
        data.notes,
        actor.userId,
        actor.role,
      ],
    );
    const posted = rows[0];
    if (!posted) throw new Error("Cash funding receipt did not return a posted authority record.");
    return {
      ok: true,
      receiptId: posted.receipt_id,
      newClosingCashLakh: Number(posted.new_closing_cash_lakh),
      actualRevision: Number(posted.actual_revision),
      accountingClassification: data.accountingClassification,
      note:
        data.accountingClassification === "pending"
          ? "Receipt is verified as cash evidence; legal/accounting classification remains pending."
          : "Receipt is verified and linked to its selected accounting classification.",
    };
  });
