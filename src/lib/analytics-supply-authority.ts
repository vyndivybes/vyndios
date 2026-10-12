import {createServerFn} from '@tanstack/react-start';
import {getCommandRole} from '@/lib/command-access';
import {getSql} from '@/lib/db';
import {canPerform} from '@/lib/page-access';
import {getRouteMeta} from '@/lib/page-metadata';
import {GROUP_AGGREGATE_QUERIES,validateAggregateRows} from './analytics-crm-hr';

type RecordRow=Record<string,string|number|boolean|null>;
const scalar=(value:unknown):string|number|boolean|null=>{
 if(value===null||value===undefined)return null;
 if(typeof value==='string'||typeof value==='boolean')return value;
 if(typeof value==='number')return Number.isFinite(value)?value:null;
 if(value instanceof Date)return value.toISOString();
 return null;
};
const SOURCES={
  demand:{table:'vyndi_sales_orders',sort:'plan_month,id',keys:['id','status','plan_month','variant_name','units']},
  jobCards:{table:'epr_production_job_cards',sort:'id',keys:['id','status','sales_order_id']},
  purchaseOrders:{table:'vyndi_purchase_order_status',sort:'id',keys:['id','status','sku','unit','quantity','quantity_accepted','unit_price_inr','expected_receipt_on']},
  salesInvoices:{table:'vyndi_invoices',sort:'id',keys:['id','status','sales_order_id','plan_month','amount_lakh']},
  supplierInvoices:{table:'vyndi_supplier_invoices',sort:'id',keys:['id','status','purchase_order_id','invoice_number','amount_ex_gst_inr','gst_inr','quantity_invoiced']},
  inventoryBalances:{table:'vyndi_inventory_balance',sort:'sku',keys:['sku','unit','quantity_balance']},
} as const;
export type AnalyticsSource=(keyof typeof SOURCES)|(keyof typeof GROUP_AGGREGATE_QUERIES);
export type AnalyticsSupplySnapshot={generatedAt:string;coverage:Record<AnalyticsSource,'PASS'|'HOLD'>;records:Record<AnalyticsSource,RecordRow[]>};
const MAX=1000;
/** Isolated, read-only, permission checked projections. Never return * columns.
 * A missing table, permission or truncated result remains HOLD, never an invented zero.
 */
export const getAnalyticsSupplySnapshot=createServerFn({method:'GET'}).handler(async():Promise<AnalyticsSupplySnapshot>=>{
 const role=await getCommandRole();
 if(!role||!canPerform(role,'view',getRouteMeta('/command/analytics-studio'))||!['admin','management','board'].includes(role)){
   throw new Error('Enterprise analytics role denied');
 }
 const sql=await getSql();
 const entries=await Promise.all(Object.entries(SOURCES).map(async([key,source])=>{
   try{
     // Whitelisted static table names and sort expressions only; no user SQL.
     const rows=await sql.query<Record<string,unknown>>('select * from '+source.table+' order by '+source.sort+' limit '+(MAX+1));
     if(rows.length>MAX)return [key,'HOLD',[]] as const;
     const projected=rows.map(row=>Object.fromEntries(source.keys.filter(k=>Object.hasOwn(row,k)).map(k=>[k,scalar(row[k])])) as RecordRow);
     return [key,'PASS',projected] as const;
   }catch{return [key,'HOLD',[]] as const;}
 }));
 // Aggregate the CRM/HR data inside Postgres. Never load contacts, names, salary
 // amounts or employee records into the analytics transport or CSV export.
 const leadership=await Promise.all(Object.entries(GROUP_AGGREGATE_QUERIES).map(async([key,spec])=>{
   try{
     const rows=await sql.query<Record<string,unknown>>(spec.query);
     const validated=validateAggregateRows(rows);
     return [key,'PASS',validated] as const;
   }catch{
     return [key,'HOLD',[]] as const;
   }
 }));
 const all=[...entries,...leadership];
 return {
   generatedAt:new Date().toISOString(),
   coverage:Object.fromEntries(all.map(([k,status])=>[k,status])) as AnalyticsSupplySnapshot['coverage'],
   records:Object.fromEntries(all.map(([k,,rows])=>[k,rows])) as AnalyticsSupplySnapshot['records'],
 };
});
