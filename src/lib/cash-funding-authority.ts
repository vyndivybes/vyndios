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

const evidence=z.string().trim().min(3).max(500);
const isoDate=z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const listFundingLifecycle=createServerFn({method:"GET"}).handler(async()=>{
  await requireView();
  const sql=await getSql();
  const [loans,loanLedger,grants,grantReceipts,grantUtilisation,grantConditions]=await Promise.all([
    sql.query("select * from vyndi_funding_loan_balance order by start_on desc,loan_id"),
    sql.query("select * from vyndi_funding_loan_ledger order by effective_on desc,created_at desc,id desc limit 500"),
    sql.query("select * from vyndi_funding_grant_balance order by grant_id"),
    sql.query("select * from vyndi_funding_grant_receipts order by received_on desc,created_at desc,id desc limit 500"),
    sql.query("select * from vyndi_funding_grant_utilisation order by spent_on desc,created_at desc,id desc limit 500"),
    sql.query("select * from vyndi_funding_grant_condition_current order by grant_id,condition_code"),
  ]);
  return {loans,loanLedger,grants,grantReceipts,grantUtilisation,grantConditions};
});

export const createFundingLoan=createServerFn({method:"POST"})
  .validator(z.object({
    lenderName:z.string().trim().min(1).max(300),
    facilityReference:z.string().trim().min(1).max(300),
    principalLimitLakh:z.number().positive().max(100000),
    annualInterestRatePct:z.number().min(0).max(100),
    startOn:isoDate,
    maturityOn:isoDate.nullable().optional(),
    sourceReference:evidence,
    evidenceReference:evidence,
  }))
  .handler(async({data})=>{
    const actor=await requireBusinessActor("approve");
    const sql=await getSql();
    const id=`LOAN-${crypto.randomUUID()}`;
    await sql.query(
      "select create_vyndi_funding_loan($1,$2,$3,$4,$5,$6::date,$7::date,$8,$9,$10,$11)",
      [id,data.lenderName,data.facilityReference,data.principalLimitLakh,data.annualInterestRatePct,
       data.startOn,data.maturityOn??null,data.sourceReference,data.evidenceReference,actor.userId,actor.role],
    );
    return {ok:true,id};
  });

export const registerLoanDrawdown=createServerFn({method:"POST"})
  .validator(z.object({
    loanId:z.string().min(1).max(160),
    fundingReceiptId:z.string().min(1).max(160),
    notes:z.string().max(2000).default(""),
    evidenceReference:evidence,
  }))
  .handler(async({data})=>{
    const actor=await requireBusinessActor("approve");
    const sql=await getSql(); const id=`LOAN-EVT-${crypto.randomUUID()}`;
    const rows=await sql.query<{principal_outstanding_lakh:number|string;accrued_interest_lakh:number|string;total_outstanding_lakh:number|string}>(
      "select * from register_vyndi_loan_drawdown($1,$2,$3,$4,$5,$6,$7)",
      [id,data.loanId,data.fundingReceiptId,data.notes,data.evidenceReference,actor.userId,actor.role],
    );
    const row=rows[0];
    return {ok:true,id,principalOutstandingLakh:Number(row?.principal_outstanding_lakh??0),accruedInterestLakh:Number(row?.accrued_interest_lakh??0),totalOutstandingLakh:Number(row?.total_outstanding_lakh??0)};
  });

export const accrueLoanInterest=createServerFn({method:"POST"})
  .validator(z.object({
    loanId:z.string().min(1).max(160),
    effectiveOn:isoDate,
    interestLakh:z.number().positive().max(100000),
    evidenceReference:evidence,
    notes:z.string().max(2000).default(""),
  }))
  .handler(async({data})=>{
    const actor=await requireBusinessActor("approve");
    const sql=await getSql(); const id=`LOAN-EVT-${crypto.randomUUID()}`;
    const rows=await sql.query<{principal_outstanding_lakh:number|string;accrued_interest_lakh:number|string;total_outstanding_lakh:number|string}>(
      "select * from accrue_vyndi_loan_interest($1,$2,$3::date,$4,$5,$6,$7,$8)",
      [id,data.loanId,data.effectiveOn,data.interestLakh,data.evidenceReference,data.notes,actor.userId,actor.role],
    );
    const row=rows[0];
    return {ok:true,id,principalOutstandingLakh:Number(row?.principal_outstanding_lakh??0),accruedInterestLakh:Number(row?.accrued_interest_lakh??0),totalOutstandingLakh:Number(row?.total_outstanding_lakh??0)};
  });

export const postLoanRepayment=createServerFn({method:"POST"})
  .validator(z.object({
    loanId:z.string().min(1).max(160),
    planMonth:z.number().int().min(1).max(36),
    paidOn:isoDate,
    principalLakh:z.number().min(0).max(100000),
    interestLakh:z.number().min(0).max(100000),
    evidenceReference:evidence,
    notes:z.string().max(2000).default(""),
  }).refine(v=>v.principalLakh+v.interestLakh>0,{message:"Repayment amount must be positive."}))
  .handler(async({data})=>{
    const actor=await requireBusinessActor("approve");
    const sql=await getSql(); const id=`LOAN-PAY-${crypto.randomUUID()}`;
    const rows=await sql.query<{
      principal_outstanding_lakh:number|string;accrued_interest_lakh:number|string;total_outstanding_lakh:number|string;
      new_closing_cash_lakh:number|string;actual_revision:number|string;
    }>(
      "select * from post_vyndi_loan_repayment($1,$2,$3,$4::date,$5,$6,$7,$8,$9,$10)",
      [id,data.loanId,data.planMonth,data.paidOn,data.principalLakh,data.interestLakh,data.evidenceReference,data.notes,actor.userId,actor.role],
    );
    const row=rows[0];
    return {ok:true,id,principalOutstandingLakh:Number(row?.principal_outstanding_lakh??0),accruedInterestLakh:Number(row?.accrued_interest_lakh??0),totalOutstandingLakh:Number(row?.total_outstanding_lakh??0),newClosingCashLakh:Number(row?.new_closing_cash_lakh??0),actualRevision:Number(row?.actual_revision??0)};
  });

export const createFundingGrant=createServerFn({method:"POST"})
  .validator(z.object({
    grantName:z.string().trim().min(1).max(300),
    providerName:z.string().trim().min(1).max(300),
    awardReference:z.string().trim().min(1).max(300),
    awardedLakh:z.number().positive().max(100000),
    awardOn:isoDate,
    validFrom:isoDate.nullable().optional(),
    validUntil:isoDate.nullable().optional(),
    sourceReference:evidence,
    evidenceReference:evidence,
  }))
  .handler(async({data})=>{
    const actor=await requireBusinessActor("approve");
    const sql=await getSql(); const id=`GRANT-${crypto.randomUUID()}`;
    await sql.query(
      "select create_vyndi_funding_grant($1,$2,$3,$4,$5,$6::date,$7::date,$8::date,$9,$10,$11,$12)",
      [id,data.grantName,data.providerName,data.awardReference,data.awardedLakh,data.awardOn,data.validFrom??null,data.validUntil??null,data.sourceReference,data.evidenceReference,actor.userId,actor.role],
    );
    return {ok:true,id};
  });

export const registerGrantReceipt=createServerFn({method:"POST"})
  .validator(z.object({grantId:z.string().min(1).max(160),fundingReceiptId:z.string().min(1).max(160),evidenceReference:evidence}))
  .handler(async({data})=>{
    const actor=await requireBusinessActor("approve"); const sql=await getSql(); const id=`GRANT-REC-${crypto.randomUUID()}`;
    const rows=await sql.query<{received_lakh:number|string;utilised_lakh:number|string;available_to_utilise_lakh:number|string;open_condition_count:number|string}>(
      "select * from register_vyndi_grant_receipt($1,$2,$3,$4,$5,$6)",
      [id,data.grantId,data.fundingReceiptId,data.evidenceReference,actor.userId,actor.role],
    );
    const row=rows[0];
    return {ok:true,id,receivedLakh:Number(row?.received_lakh??0),utilisedLakh:Number(row?.utilised_lakh??0),availableToUtiliseLakh:Number(row?.available_to_utilise_lakh??0),openConditionCount:Number(row?.open_condition_count??0)};
  });

export const postGrantUtilisation=createServerFn({method:"POST"})
  .validator(z.object({
    grantId:z.string().min(1).max(160),planMonth:z.number().int().min(1).max(36),spentOn:isoDate,
    amountLakh:z.number().positive().max(100000),utilisationCategory:z.string().trim().min(1).max(300),
    expenseReference:z.string().trim().max(300).nullable().optional(),evidenceReference:evidence,notes:z.string().max(2000).default(""),
  }))
  .handler(async({data})=>{
    const actor=await requireBusinessActor("approve"); const sql=await getSql(); const id=`GRANT-USE-${crypto.randomUUID()}`;
    const rows=await sql.query<{received_lakh:number|string;utilised_lakh:number|string;available_to_utilise_lakh:number|string;open_condition_count:number|string}>(
      "select * from post_vyndi_grant_utilisation($1,$2,$3,$4::date,$5,$6,$7,$8,$9,$10,$11)",
      [id,data.grantId,data.planMonth,data.spentOn,data.amountLakh,data.utilisationCategory,data.expenseReference??null,data.evidenceReference,data.notes,actor.userId,actor.role],
    );
    const row=rows[0];
    return {ok:true,id,receivedLakh:Number(row?.received_lakh??0),utilisedLakh:Number(row?.utilised_lakh??0),availableToUtiliseLakh:Number(row?.available_to_utilise_lakh??0),openConditionCount:Number(row?.open_condition_count??0)};
  });

export const recordGrantCondition=createServerFn({method:"POST"})
  .validator(z.object({
    grantId:z.string().min(1).max(160),conditionCode:z.string().trim().min(1).max(120),conditionTitle:z.string().trim().min(1).max(300),
    conditionStatus:z.enum(["pending","met","waived","breached"]),dueOn:isoDate.nullable().optional(),evidenceReference:evidence,notes:z.string().max(2000).default(""),
  }))
  .handler(async({data})=>{
    const actor=await requireBusinessActor("approve"); const sql=await getSql(); const id=`GRANT-COND-${crypto.randomUUID()}`;
    const rows=await sql.query<{condition_revision:number|string;open_condition_count:number|string}>(
      "select * from record_vyndi_grant_condition($1,$2,$3,$4,$5,$6::date,$7,$8,$9,$10)",
      [id,data.grantId,data.conditionCode,data.conditionTitle,data.conditionStatus,data.dueOn??null,data.evidenceReference,data.notes,actor.userId,actor.role],
    );
    return {ok:true,id,revision:Number(rows[0]?.condition_revision??0),openConditionCount:Number(rows[0]?.open_condition_count??0)};
  });

