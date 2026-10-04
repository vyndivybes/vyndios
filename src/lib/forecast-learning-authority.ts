import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getSql, type Sql } from "@/lib/db";
import { requireBusinessActor } from "@/lib/business-actor";
import { canAccessRoute } from "@/lib/page-access";
import { buildModelWithInputs, type FinanceAssumptions, type ProductLineId } from "@/lib/finance/model";
import { normalizeOperatingPlan, type OperatingPlan } from "@/lib/planning/operating-plan";
import { buildForecastLearning, type ForecastLearningObservation } from "@/lib/forecast-learning-model";

const PRODUCTS:ProductLineId[]=["aluminium","carbon","premiumCarbon"];
const MINIMUM_CLOSED_PERIODS=3;
const clean=(value:unknown)=>String(value??"").trim();
const n=(value:unknown)=>Number(value??0);

type ForecastLearningResult = ReturnType<typeof buildForecastLearning>;
type LearningRunRow={
  id:string;
  as_of:string;
  minimum_closed_periods:number|string;
  eligible_closed_periods:number|string;
  available:boolean;
  result_json:ForecastLearningResult;
  source_reference:string;
  created_at:string;
};

type ApprovedPlanRow={
  id:string;
  revision:number|string;
  scenario:"base"|"delayed"|"stress";
  draw_standby:boolean;
  finance_json:FinanceAssumptions;
};

type VintageRow={
  id:string;
  approved_plan_id:string;
  approved_plan_revision:number|string;
  horizon_start:string;
  cutoff_at:string;
  captured_at:string;
  source_sha:string;
  source_reference:string;
};

type CloseRow={
  id:string;
  period_start:string;
  period_end:string;
  plan_month:number|string;
  revision:number|string;
  actual_units:number|string;
  revenue_lakh:number|string;
  procurement_cash_lakh:number|string;
  closing_cash_lakh:number|string|null;
  cash_verified:boolean;
  actual_revision:number|string|null;
  source_reference:string;
  closed_at:string;
};

function sourceSha(){
  const sha=process.env.VYNDI_SOURCE_SHA||process.env.CF_PAGES_COMMIT_SHA||process.env.GITHUB_SHA;
  if(!sha||sha.trim().length<7) throw new Error("Forecast vintage blocked: deployed source SHA is unavailable.");
  return sha.trim();
}

function addMonths(monthText:string,offset:number){
  const [yearText,monthPart]=monthText.split("-");
  const base=Number(yearText)*12+(Number(monthPart)-1)+offset;
  const year=Math.floor(base/12);
  const month=(base%12)+1;
  return `${year}-${String(month).padStart(2,"0")}`;
}
function periodStartFor(plan:OperatingPlan,planMonth:number){
  return addMonths(plan.horizonStart,planMonth-1)+"-01";
}
function periodEndFor(plan:OperatingPlan,planMonth:number){
  const next=addMonths(plan.horizonStart,planMonth)+"-01T00:00:00.000Z";
  const date=new Date(next);
  date.setUTCDate(date.getUTCDate()-1);
  return date.toISOString().slice(0,10);
}
function planQtyFor(row:ReturnType<typeof buildModelWithInputs>[number],productId:ProductLineId){
  if(productId==="aluminium") return row.aluminiumUnits;
  if(productId==="carbon") return row.carbonUnits;
  return row.premiumCarbonUnits;
}
function assertPlanningWrite(role:Parameters<typeof canAccessRoute>[0]){
  if(!canAccessRoute(role,"/command/planning")) throw new Error("Forecast learning planning access denied.");
}
async function approvedPlan(sql:Sql){
  const rows=await sql.query<ApprovedPlanRow>(
    `select id,revision,scenario,draw_standby,finance_json
       from vyndi_plan_revisions
      where status='approved'
      order by revision desc
      limit 2`
  );
  if(rows.length!==1) throw new Error(rows.length?"Forecast learning blocked: more than one approved operating plan exists.":"Forecast learning blocked: no approved operating plan exists.");
  return rows[0];
}

export async function buildForecastLearningFromSql(sql:Sql){
  const rows=await sql.query<Record<string,unknown>>(
    `with latest_close as (
       select distinct on (period_start)
              id,period_start,plan_month,revision
         from vyndi_learning_period_closes
        order by period_start,revision desc
     )
     select cp.product_id,
            c.period_start,
            c.plan_month,
            cp.actual_qty,
            fv.vintage_id,
            fv.plan_qty,
            fv.forecast_qty,
            c.id as close_id
       from latest_close c
       join vyndi_learning_period_close_products cp on cp.close_id=c.id
       join lateral (
         select vl.vintage_id,vl.plan_qty,vl.forecast_qty
           from vyndi_forecast_vintage_lines vl
           join vyndi_forecast_vintages v on v.id=vl.vintage_id
          where vl.period_start=c.period_start
            and vl.product_id=cp.product_id
            and v.captured_at < c.period_start::timestamptz
          order by v.captured_at desc,v.id desc
          limit 1
       ) fv on true
      order by c.period_start,cp.product_id`
  );
  const observations:ForecastLearningObservation[]=rows.map((row)=>({
    productId:clean(row.product_id),
    planMonth:n(row.plan_month),
    planQty:n(row.plan_qty),
    forecastQty:n(row.forecast_qty),
    actualQty:n(row.actual_qty),
    vintageId:clean(row.vintage_id),
    closeId:clean(row.close_id),
  }));
  return buildForecastLearning({observations,minimumClosedPeriods:MINIMUM_CLOSED_PERIODS});
}

async function readForecastLearningState(sql:Sql){
  const plan=await approvedPlan(sql).catch(()=>null);
  const [vintages,closes,runs,learning]=await Promise.all([
    sql.query<VintageRow>(
      `select id,approved_plan_id,approved_plan_revision,horizon_start::text,cutoff_at::text,captured_at::text,source_sha,source_reference
         from vyndi_forecast_vintages order by captured_at desc,id desc limit 20`
    ),
    sql.query<CloseRow>(
      `select id,period_start::text,period_end::text,plan_month,revision,actual_units,revenue_lakh,procurement_cash_lakh,
              closing_cash_lakh,cash_verified,actual_revision,source_reference,closed_at::text
         from vyndi_learning_period_closes order by period_start desc,revision desc limit 36`
    ),
    sql.query<LearningRunRow>(
      `select id,as_of::text,minimum_closed_periods,eligible_closed_periods,available,result_json,source_reference,created_at::text
         from vyndi_forecast_learning_runs order by created_at desc,id desc limit 1`
    ),
    buildForecastLearningFromSql(sql),
  ]);

  let suggestedClosePlanMonth:number|null=null;
  let horizonStart:string|null=null;
  if(plan?.finance_json?.operatingPlan){
    const operatingPlan=normalizeOperatingPlan(plan.finance_json.operatingPlan);
    horizonStart=operatingPlan.horizonStart;
    const today=new Date().toISOString().slice(0,10);
    for(let month=1;month<=36;month++) if(periodEndFor(operatingPlan,month)<today) suggestedClosePlanMonth=month;
  }

  return {
    minimumClosedPeriods:MINIMUM_CLOSED_PERIODS,
    approvedPlan:plan?{id:plan.id,revision:n(plan.revision),horizonStart}:null,
    vintages:vintages.map((row)=>({
      id:row.id,approvedPlanId:row.approved_plan_id,approvedPlanRevision:n(row.approved_plan_revision),
      horizonStart:row.horizon_start,cutoffAt:row.cutoff_at,capturedAt:row.captured_at,sourceSha:row.source_sha,sourceReference:row.source_reference,
    })),
    closes:closes.map((row)=>({
      id:row.id,periodStart:row.period_start,periodEnd:row.period_end,planMonth:n(row.plan_month),revision:n(row.revision),
      actualUnits:n(row.actual_units),revenueLakh:n(row.revenue_lakh),procurementCashLakh:n(row.procurement_cash_lakh),
      closingCashLakh:row.closing_cash_lakh==null?null:n(row.closing_cash_lakh),cashVerified:Boolean(row.cash_verified),
      actualRevision:row.actual_revision==null?null:n(row.actual_revision),sourceReference:row.source_reference,closedAt:row.closed_at,
    })),
    latestRun:runs[0]?{
      id:clean(runs[0].id),asOf:clean(runs[0].as_of),minimumClosedPeriods:n(runs[0].minimum_closed_periods),
      eligibleClosedPeriods:n(runs[0].eligible_closed_periods),available:Boolean(runs[0].available),
      result:runs[0].result_json,sourceReference:clean(runs[0].source_reference),createdAt:clean(runs[0].created_at),
    }:null,
    live:learning,
    suggestedClosePlanMonth,
  };
}

export type ForecastLearningState=Awaited<ReturnType<typeof readForecastLearningState>>;

export const getForecastLearningState=createServerFn({method:"GET"}).handler(async()=>{
  await requireBusinessActor("view");
  const sql=await getSql();
  return readForecastLearningState(sql);
});

export const captureForecastVintage=createServerFn({method:"POST"})
  .validator(z.object({sourceReference:z.string().trim().min(3).max(500)}))
  .handler(async({data})=>{
    const actor=await requireBusinessActor("edit");
    assertPlanningWrite(actor.role);
    const sql=await getSql();
    const plan=await approvedPlan(sql);
    const finance=plan.finance_json;
    if(!finance?.operatingPlan) throw new Error("Forecast vintage blocked: approved plan has no operatingPlan payload.");
    const operatingPlan=normalizeOperatingPlan(finance.operatingPlan);
    const model=buildModelWithInputs(plan.scenario,Boolean(plan.draw_standby),finance);
    const committedRows=await sql.query<{plan_month:number|string;product_id:ProductLineId;units:number|string}>(
      `select plan_month,product_id,coalesce(sum(units),0) as units
         from vyndi_sales_orders
        where status='confirmed'
        group by plan_month,product_id
        order by plan_month,product_id`
    );
    const committed=new Map(committedRows.map((row)=>[`${n(row.plan_month)}|${row.product_id}`,n(row.units)]));
    const lines=model.flatMap((row)=>PRODUCTS.map((productId)=>{
      const planQty=planQtyFor(row,productId);
      const committedQty=committed.get(`${row.m}|${productId}`)??0;
      return {
        period_start:periodStartFor(operatingPlan,row.m),
        plan_month:row.m,
        product_id:productId,
        plan_qty:planQty,
        committed_qty:committedQty,
        forecast_qty:Math.max(planQty,committedQty),
      };
    }));
    const id="FCST-"+crypto.randomUUID();
    const cutoffAt=new Date().toISOString();
    const rows=await sql.query<{capture_vyndi_forecast_vintage:string}>(
      `select capture_vyndi_forecast_vintage($1,$2,$3,$4::date,$5::timestamptz,$6,$7,$8::jsonb,$9,$10)`,
      [id,plan.id,n(plan.revision),operatingPlan.horizonStart+"-01",cutoffAt,sourceSha(),data.sourceReference,JSON.stringify(lines),actor.userId,actor.role]
    );
    return {id:rows[0]?.capture_vyndi_forecast_vintage??id,lineCount:lines.length,cutoffAt};
  });

export const closeLearningPeriod=createServerFn({method:"POST"})
  .validator(z.object({planMonth:z.number().int().min(1).max(36),sourceReference:z.string().trim().min(3).max(500)}))
  .handler(async({data})=>{
    const actor=await requireBusinessActor("edit");
    assertPlanningWrite(actor.role);
    const sql=await getSql();
    const plan=await approvedPlan(sql);
    if(!plan.finance_json?.operatingPlan) throw new Error("Learning close blocked: approved plan has no operatingPlan payload.");
    const operatingPlan=normalizeOperatingPlan(plan.finance_json.operatingPlan);
    const periodStart=periodStartFor(operatingPlan,data.planMonth);
    const periodEnd=periodEndFor(operatingPlan,data.planMonth);

    const [actualRows,productRows,paymentRows,managementRows]=await Promise.all([
      sql.query<{revenue:number|string;units:number|string}>(
        `select revenue,units from vyndi_monthly_transaction_actuals where plan_month=$1`,[data.planMonth]
      ),
      sql.query<{product_id:ProductLineId;actual_qty:number|string}>(
        `select o.product_id,coalesce(sum(i.units),0) as actual_qty
           from vyndi_invoices i
           join vyndi_sales_orders o on o.id=i.sales_order_id
          where i.status='issued' and i.sale_type='bicycle' and i.plan_month=$1
          group by o.product_id order by o.product_id`,[data.planMonth]
      ),
      sql.query<{procurement_cash_lakh:number|string}>(
        `select coalesce(sum(amount_inr),0)/100000.0 as procurement_cash_lakh
           from vyndi_supplier_payments where status='posted' and plan_month=$1`,[data.planMonth]
      ),
      sql.query<{revision:number|string;closing_cash:number|string|null;verified:boolean}>(
        `select revision,closing_cash,verified from vyndi_monthly_actuals where plan_month=$1`,[data.planMonth]
      ),
    ]);
    const actual=actualRows[0]??{revenue:0,units:0};
    const actualByProduct=new Map(productRows.map((row)=>[row.product_id,n(row.actual_qty)]));
    const products=PRODUCTS.map((productId)=>({product_id:productId,actual_qty:actualByProduct.get(productId)??0}));
    const management=managementRows[0];
    const id="FCLOSE-"+crypto.randomUUID();
    const rows=await sql.query<{close_id:string;revision:number|string}>(
      `select * from close_vyndi_learning_period($1,$2::date,$3::date,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14)`,
      [
        id,periodStart,periodEnd,data.planMonth,n(actual.units),n(actual.revenue),n(paymentRows[0]?.procurement_cash_lakh),
        management?.closing_cash==null?null:n(management.closing_cash),Boolean(management?.verified),
        management? n(management.revision):null,data.sourceReference,JSON.stringify(products),actor.userId,actor.role
      ]
    );
    return {id:rows[0]?.close_id??id,revision:n(rows[0]?.revision),periodStart,periodEnd};
  });

export const captureForecastLearningSnapshot=createServerFn({method:"POST"})
  .validator(z.object({sourceReference:z.string().trim().min(3).max(500)}))
  .handler(async({data})=>{
    const actor=await requireBusinessActor("edit");
    assertPlanningWrite(actor.role);
    const sql=await getSql();
    const result=await buildForecastLearningFromSql(sql);
    const id="FLEARN-"+crypto.randomUUID();
    const asOf=new Date().toISOString();
    await sql.query(
      `select save_vyndi_forecast_learning_run($1,$2::timestamptz,$3,$4,$5,$6::jsonb,$7,$8,$9)`,
      [id,asOf,MINIMUM_CLOSED_PERIODS,result.closedPeriods,result.available,JSON.stringify(result),data.sourceReference,actor.userId,actor.role]
    );
    return {id,asOf,available:result.available,closedPeriods:result.closedPeriods};
  });
