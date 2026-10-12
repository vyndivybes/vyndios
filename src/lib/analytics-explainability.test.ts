import test from 'node:test';
import assert from 'node:assert/strict';
import {describeAnalyticsMetric,interpretAnalyticsSelection,buildFounderReading} from './analytics-explainability.ts';
import {aggregateAnalyticsRows,paretoAnalyticsRows,type AnalyticsDatum} from './analytics-studio.ts';
const item=(id:string,metrics:Record<string,number>):AnalyticsDatum=>({
 id,dataset:'purchaseOrders',category:'Resin',variant:'',status:'ordered',stage:'ordered',month:1,source:'VYNDI:purchaseOrders',metrics,
});
test('explains database record count as number of rows rather than physical stock',()=>{
 const result=describeAnalyticsMetric('recordCount','inventoryBalances');
 assert.equal(result.unit,'records');
 assert.match(result.description,/records/i);
 assert.match(result.description,/not.*stock/i);
});
test('distinguishes money units, physical units and non-additive prices and cash',()=>{
 assert.equal(describeAnalyticsMetric('revenue','finance').unit,'₹ lakh');
 assert.equal(describeAnalyticsMetric('unit_price_inr','purchaseOrders').unit,'₹ per unit');
 assert.equal(describeAnalyticsMetric('unit_price_inr','purchaseOrders').aggregation,'average');
 assert.equal(describeAnalyticsMetric('closingCash','finance').aggregation,'average');
 assert.equal(describeAnalyticsMetric('units','flow').aggregation,'sum');
});
test('prevents summing unit prices and disables Pareto shares of prices',()=>{
 const rows=[item('1',{unit_price_inr:100,recordCount:1}),item('2',{unit_price_inr:200,recordCount:1})];
 assert.equal(aggregateAnalyticsRows(rows,'category','unit_price_inr')[0].value,150);
 assert.equal(paretoAnalyticsRows(rows,'category','unit_price_inr').length,0);
 assert.equal(aggregateAnalyticsRows(rows,'category','recordCount')[0].value,2);
});
test('interprets empty and HOLD sources conservatively without implying no shortages',()=>{
 const blank=interpretAnalyticsSelection({dataset:'inventoryBalances',metric:'recordCount',dimension:'category',visual:'bar',rowsCount:0,sourceState:'HOLD'});
 assert.match(blank.caution,/unavailable|HOLD/i);
 assert.doesNotMatch(blank.title+' '+blank.what+' '+blank.caution,/no shortages|all clear|healthy/i);
 const empty=interpretAnalyticsSelection({dataset:'materials',metric:'recordCount',dimension:'category',visual:'pie',rowsCount:0,sourceState:'PASS'});
 assert.match(empty.caution,/no matching recorded rows/i);
});
test('time trends require month dimension, and bars by status show categories not chronology',()=>{
 const a=interpretAnalyticsSelection({dataset:'flow',metric:'units',dimension:'stage',visual:'line',rowsCount:3,sourceState:'PASS'});
 assert.match(a.chartExplanation,/not a time series/i);
 const b=interpretAnalyticsSelection({dataset:'flow',metric:'units',dimension:'month',visual:'line',rowsCount:3,sourceState:'PASS'});
 assert.match(b.chartExplanation,/month/i);
});
test('group view is never represented as consolidated where independent group units are missing',()=>{
 const r=buildFounderReading({scope:'group',linkedOrders:2,committedUnits:3,shortageLines:0,
  jobCards:1,sourceCoverage:{demand:'PASS',purchaseOrders:'HOLD'}});
 assert.match(r.groupCaution,/not consolidated/i);
 assert.match(r.supplyCaution,/HOLD/);
 assert.match(r.shortageExplanation,/linked orders/i);
 assert.doesNotMatch(r.shortageExplanation,/no material shortages/i);
});
test('illustrative cash forecasts are explicitly distinct from posted actuals',()=>{
 const r=buildFounderReading({scope:'vyndi',linkedOrders:0,committedUnits:0,shortageLines:0,
   jobCards:0,sourceCoverage:{}});
 assert.match(r.forecastCaution,/scenario|illustrative/i);
 assert.match(r.forecastCaution,/not.*posted/i);
});
