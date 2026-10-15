import type {Sql} from './db';
import {buildForecastLearning,type ForecastLearningObservation} from './forecast-learning-model.ts';
const MINIMUM_CLOSED_PERIODS=3;
const clean=(v:unknown)=>String(v??'').trim();
const n=(v:unknown)=>Number(v??0);
// Shared canonical forecast-learning reader used by the owning workspace and
// signed BI. Reads immutable pre-period vintages and latest governed closes.
export async function buildForecastLearningFromSql(sql:Sql,period?:{from:string;to:string}){
  const rows=await sql.query<Record<string,unknown>>(
    `with latest_close as (
       select distinct on (period_start)
              id,period_start,plan_month,revision
         from vyndi_learning_period_closes
        where ($1::date is null or period_start >= $1::date)
          and ($2::date is null or (period_end <= $2::date and closed_at < ($2::date+1)::timestamptz))
          and btrim(source_reference)<>''
          and id !~* '^(TEST|UAT|FIXTURE|VAOS-QUAL|VAOS-CANARY)[-_:]'
          and source_reference !~* '^(test:|fixture:|synthetic:|training:|qualification:|canary:)'
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
           join vyndi_plan_revisions p on p.id=v.approved_plan_id and p.revision=v.approved_plan_revision
          where vl.period_start=c.period_start
            and vl.product_id=cp.product_id
            and p.status in ('approved','superseded') and p.approved_at <= v.captured_at and btrim(p.approved_by)<>''
            and v.captured_at < c.period_start::timestamptz
            and v.cutoff_at < c.period_start::timestamptz
            and btrim(v.source_reference)<>''
            and v.id !~* '^(TEST|UAT|FIXTURE|VAOS-QUAL|VAOS-CANARY)[-_:]'
            and v.source_reference !~* '^(test:|fixture:|synthetic:|training:|qualification:|canary:)'
          order by v.captured_at desc,v.id desc
          limit 1
       ) fv on true
      order by c.period_start,cp.product_id`,[period?.from??null,period?.to??null]
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
