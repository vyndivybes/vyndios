import test from 'node:test';
import assert from 'node:assert/strict';
import {buildAnalyticsRows, filterAnalyticsRows, aggregateAnalyticsRows, paretoAnalyticsRows, buildKanbanLanes, getNumericMetrics} from './analytics-studio.ts';

const lineage=[
  {salesOrderId:'SO-1',planMonth:2,variantName:'Altitude M',units:2,orderStatus:'confirmed',jobCardId:'JC-1',jobCardStatus:'open',shortageLines:3,shortageUnits:5,purchaseOrderCount:1,goodsReceiptCount:0,invoiceCount:0,collectionCount:0},
  {salesOrderId:'SO-2',planMonth:4,variantName:'Altitude L',units:1,orderStatus:'delivered',jobCardId:'JC-2',jobCardStatus:'released',shortageLines:0,shortageUnits:0,purchaseOrderCount:2,goodsReceiptCount:1,invoiceCount:1,collectionCount:1,collectionAmountLakh:1.2}
];
const report={
 inventory:{
  mslHealth:[{sku:'CARBON-UD',health:'BELOW_MSL',quantity_balance:4},{sku:'EPOXY',health:'OK',quantity_balance:22}],
  procurementNetRequirement:[{sku:'CARBON-UD',net_buy_to_msl:10,net_buy_to_monthly_use:7}],
  receivingExceptions:[{purchase_order_id:'PO-8',exception_class:'LATE'}],
 }, engineeringProduction:{productionReleaseGate:[{job_card_id:'JC-1',gate_status:'HOLD'}]},
 commercial:{orderBacklog:[]},finance:{receivablesAging:[{invoice_id:'INV-5',age_days:21}],payablesAging:[],monthlyTransactionActuals:[]},
};
test('canonical lineage and reports drive supply chain; no synthetic orders or amounts',()=>{
 const rows=buildAnalyticsRows({lineage,report,actuals:{}});
 const flow=rows.filter(r=>r.dataset==='flow');
 assert.equal(flow.length,2);
 assert.equal(flow[0].metrics.shortageLines,3);
 assert.equal(flow[1].metrics.invoices,1);
 assert.equal(flow[0].stage,'Material shortage');
 assert.equal(flow[1].stage,'Collected');
 assert.equal(rows.filter(r=>r.dataset==='materials').length,1);
 assert.equal(rows.filter(r=>r.dataset==='inventory').length,2);
 assert.equal(rows.filter(r=>r.dataset==='receivables').length,1);
 assert.equal(rows.filter(r=>r.dataset==='finance').length,0);
});
test('selectable filters retain only matching canonical data and never change source',()=>{
 const rows=buildAnalyticsRows({lineage,report,actuals:{}});
 assert.equal(filterAnalyticsRows(rows,{dataset:'flow',variant:'Altitude M',from:2,to:2}).length,1);
 assert.equal(filterAnalyticsRows(rows,{dataset:'flow',variant:'Altitude M',from:3,to:36}).length,0);
});
test('Pareto ranks descending with exact cumulative percentages and no fictional data',()=>{
 const rows=buildAnalyticsRows({lineage,report,actuals:{}});
 const flow=filterAnalyticsRows(rows,{dataset:'flow'});
 const result=paretoAnalyticsRows(flow,'variant','purchaseOrders');
 assert.deepEqual(result.map(r=>r.value),[2,1]);
 assert.equal(result.at(-1)?.cumulativePercent,100);
 assert.equal(result.length,2);
});
test('metrics with missing values are not coerced into zero-valued evidence',()=>{
 const rows=buildAnalyticsRows({lineage,report,actuals:{}});
 const metrics=getNumericMetrics(rows.filter(r=>r.dataset==='inventory'));
 assert.ok(metrics.includes('quantity_balance'));
 assert.equal(aggregateAnalyticsRows(rows.filter(r=>r.dataset==='inventory'),'category','revenue').length,0);
});
test('Kanban uses persisted lineage evidence to derive summary stages',()=>{
 const lanes=buildKanbanLanes(buildAnalyticsRows({lineage,report,actuals:{}}).filter(r=>r.dataset==='flow'));
 assert.equal(lanes.reduce((sum,l)=>sum+l.items.length,0),2);
 assert.equal(lanes.find(l=>l.name==='Material shortage')?.items[0].id,'SO-1');
});
test('management actuals preserve explicit missing fields without inventing other amounts',()=>{
 const rows=buildAnalyticsRows({lineage:[],report:{},actuals:{1:{revenue:2.5,units:1,opex:null,transactionDerived:true}}});
 assert.equal(rows.length,1);
 assert.equal(rows[0].dataset,'finance');
 assert.equal(rows[0].metrics.revenue,2.5);
 assert.equal('opex' in rows[0].metrics,false);
});


test('independent full-supply sources become selectable only on qualified readback',()=>{
 const source={coverage:{purchaseOrders:'PASS',salesInvoices:'HOLD',inventoryBalances:'PASS'},records:{
  purchaseOrders:[{id:'PO-9',sku:'RESIN',status:'issued',quantity:8,unit_price_inr:1500}],
  salesInvoices:[{id:'INV-1',status:'issued',amount_lakh:2}],
  inventoryBalances:[{sku:'RESIN',unit:'kg',quantity_balance:11}],
 }};
 const rows=buildAnalyticsRows({lineage:[],report:{},actuals:{},supply:source});
 assert.equal(rows.filter(r=>r.dataset==='purchaseOrders').length,1);
 assert.equal(rows.filter(r=>r.dataset==='salesInvoices').length,0);
 assert.equal(rows.find(r=>r.dataset==='inventoryBalances')?.metrics.quantity_balance,11);
 assert.equal(rows.find(r=>r.dataset==='purchaseOrders')?.metrics.unit_price_inr,1500);
});
