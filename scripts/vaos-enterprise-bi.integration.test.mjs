import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {pendingMigrations} from './migration-plan.mjs';
import {readEnterpriseBi} from '../src/lib/vaos-enterprise-bi-read.ts';

test('BI executes against the complete historical schema and queries old periods beyond latest 100 rows',async t=>{
 const db=new PGlite();t.after(()=>db.close());await db.waitReady;
 const dir=new URL('../migrations/',import.meta.url);
 for(const {path} of pendingMigrations(await readdir(dir),[]))await db.exec(await readFile(new URL(path,dir),'utf8'));
 const sql={query:async(text,params=[])=> (await db.query(text,params)).rows};
 const all=await readEnterpriseBi(sql,{employeeId:'all',from:'2026-09-01',to:'2026-10-15'});
 assert.equal(all.departments.length,16);
 const unavailable=all.departments.flatMap(d=>d.sources.filter(s=>s.status!=='OBSERVED').map(s=>s.sourceTable));
 assert.deepEqual(unavailable,[],'all governed source queries must execute against actual migrations');
 await db.query(`insert into vyndi_risk_register(id,risk,likelihood,impact,mitigation,source_reference,updated_by,updated_at)
  select 'BI-'||g,'Business risk','Low','Low','Recorded mitigation','business:board-review','operator',
   case when g=1 then '2026-09-01'::timestamptz else '2026-10-10'::timestamptz end
   from generate_series(1,125) g`);
 await db.query(`insert into vyndi_risk_register(id,risk,likelihood,impact,mitigation,source_reference,updated_by,updated_at)
  values ('VAOS-QUAL-RISK','Training','Low','Low','Drill','fixture:qualification','operator','2026-09-01')`);
 const old=await readEnterpriseBi(sql,{employeeId:'risk',from:'2026-09-01',to:'2026-09-01',limit:1});
 const r=old.departments[0];assert.equal(r.periodEventCount,1);assert.equal(r.records[0].fields.id,'BI-1');
 assert.equal(r.excludedTrainingCount,1);assert.equal(r.forecast.status,'UNAVAILABLE');
 const current=await readEnterpriseBi(sql,{employeeId:'risk',from:'2026-10-10',to:'2026-10-10',limit:1,offset:1});
 assert.equal(current.departments[0].periodEventCount,124);assert.equal(current.departments[0].records.length,1);
 assert.equal(current.departments[0].detailPage.hasMore,true);
 // Isolated local source for nullable dates; production schemas remain untouched.
 await db.exec(`create temporary table vyndi_quality_releases(id text,decision text,decided_at timestamptz);
  insert into vyndi_quality_releases values ('R-1','blocked','2026-09-01'),('R-2','released',null)`);
 const release=(await readEnterpriseBi(sql,{employeeId:'release',from:'2026-09-01',to:'2026-09-01'})).departments[0];
 assert.equal(release.periodRecordedStates.blocked,1);assert.equal(release.currentRecordedStates.finished,1);
 assert.equal(release.records[0].date,"2026-09-01");assert.equal(release.records[0].dateField,"decided_at");
 assert.equal(release.undatedCount,1);assert.equal(release.periodEventCount,1);
 // Real vintage/close tables prove plan-vs-actual provenance and maturity gates.
 await db.query(`insert into vyndi_plan_revisions(id,revision,status,scenario,finance_json,accounting_json,created_by,approved_by,approved_at)
  values ('BI-PLAN',999,'superseded','base','{}','{}','operator','reviewer','2026-01-01')`);
 await db.query(`insert into vyndi_forecast_vintages(id,approved_plan_id,approved_plan_revision,horizon_start,cutoff_at,captured_at,source_sha,source_reference,captured_by,captured_role)
  values ('BI-VINTAGE','BI-PLAN',999,'2026-01-01','2026-01-01','2026-01-01','abcdef123','business:approved-plan','operator','admin')`);
 for(const [month,units] of [[2,11],[3,8],[4,10]]){
  const start=`2026-0${month}-01`,end=month===2?'2026-02-28':`2026-0${month}-${month===3?31:30}`;
  await db.query(`insert into vyndi_forecast_vintage_lines(vintage_id,period_start,plan_month,product_id,plan_qty,committed_qty,forecast_qty,source_reference)
   values ('BI-VINTAGE',$1,$2,'carbon',10,0,$3,'business:approved-plan')`,[start,month,units]);
  await db.query(`insert into vyndi_learning_period_closes(id,period_start,period_end,plan_month,revision,actual_units,revenue_lakh,procurement_cash_lakh,source_reference,closed_by,closed_role,closed_at)
   values ($1,$2,$3,$4,1,$5,0,0,'business:closed-actuals','operator','admin',$3::date+1)`,['BI-CLOSE-'+month,start,end,month,units]);
  await db.query(`insert into vyndi_learning_period_close_products(close_id,product_id,actual_qty,source_reference)
   values ($1,'carbon',$2,'business:closed-actuals')`,['BI-CLOSE-'+month,units]);
 }
 const period=await readEnterpriseBi(sql,{employeeId:'commercial',from:'2026-02-01',to:'2026-05-01'});
 const comparison=period.businessPlanComparison;
 assert.equal(comparison.status,'CLOSED_PERIOD_COMPARISON');assert.equal(comparison.planUnits,30);
 assert.equal(comparison.actualUnits,29);assert.equal(comparison.varianceUnits,-1);
 assert.equal(comparison.forecastAssessment.status,'BACKTEST_AVAILABLE');assert.equal(comparison.forecastAssessment.wapePct,0);
 const early=(await readEnterpriseBi(sql,{employeeId:'commercial',from:'2026-02-01',to:'2026-03-01'})).businessPlanComparison;
 assert.equal(early.forecastAssessment.status,'UNAVAILABLE');assert.equal(early.forecastAssessment.closedPeriods,1);
 assert.equal(early.forecastAssessment.wapePct,null);
 console.log(JSON.stringify({departments:all.departments.length,sources:all.departments.reduce((n,d)=>n+d.sources.length,0),oldPeriodCount:r.periodEventCount}));
});
