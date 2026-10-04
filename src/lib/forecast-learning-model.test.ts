import test from "node:test";
import assert from "node:assert/strict";
import { buildForecastLearning } from "./forecast-learning-model.ts";

test("forecast learning computes WAPE bias attainment and positive FVA from pre-period vintages",()=>{
  const result=buildForecastLearning({
    observations:[
      {productId:"carbon",planMonth:1,planQty:10,forecastQty:11,actualQty:11,vintageId:"V1",closeId:"C1"},
      {productId:"carbon",planMonth:2,planQty:10,forecastQty:8,actualQty:8,vintageId:"V2",closeId:"C2"},
      {productId:"carbon",planMonth:3,planQty:10,forecastQty:10,actualQty:10,vintageId:"V3",closeId:"C3"},
    ],
    minimumClosedPeriods:3,
  });
  assert.equal(result.available,true);
  assert.equal(result.closedPeriods,3);
  assert.equal(result.actualUnits,29);
  assert.equal(result.planUnits,30);
  assert.equal(result.forecastUnits,29);
  assert.equal(result.wapePct,0);
  assert.equal(result.biasPct,0);
  assert.equal(result.planAttainmentPct,96.6667);
  assert.equal(result.forecastAttainmentPct,100);
  assert.equal(result.planAbsoluteErrorUnits,3);
  assert.equal(result.forecastAbsoluteErrorUnits,0);
  assert.equal(result.fvaUnits,3);
  assert.equal(result.fvaPct,100);
});

test("forecast bias is positive for over-forecast and WAPE uses actual demand denominator",()=>{
  const result=buildForecastLearning({
    observations:[
      {productId:"carbon",planMonth:1,planQty:10,forecastQty:12,actualQty:11,vintageId:"V1",closeId:"C1"},
      {productId:"carbon",planMonth:2,planQty:10,forecastQty:9,actualQty:8,vintageId:"V2",closeId:"C2"},
      {productId:"carbon",planMonth:3,planQty:10,forecastQty:11,actualQty:10,vintageId:"V3",closeId:"C3"},
    ],
    minimumClosedPeriods:3,
  });
  assert.equal(result.wapePct,10.3448);
  assert.equal(result.biasPct,10.3448);
  assert.equal(result.fvaUnits,0);
  assert.equal(result.fvaPct,0);
});

test("learning metrics are withheld until enough distinct closed periods exist",()=>{
  const result=buildForecastLearning({
    observations:[
      {productId:"carbon",planMonth:1,planQty:10,forecastQty:11,actualQty:10,vintageId:"V1",closeId:"C1"},
      {productId:"aluminium",planMonth:1,planQty:5,forecastQty:5,actualQty:5,vintageId:"V1",closeId:"C1"},
      {productId:"premiumCarbon",planMonth:2,planQty:3,forecastQty:3,actualQty:3,vintageId:"V2",closeId:"C2"},
    ],
    minimumClosedPeriods:3,
  });
  assert.equal(result.available,false);
  assert.equal(result.closedPeriods,2);
  assert.equal(result.wapePct,null);
  assert.match(result.reason,/at least 3 distinct closed periods/i);
});

test("zero actual denominator withholds percentage learning rather than fabricating WAPE",()=>{
  const result=buildForecastLearning({
    observations:[
      {productId:"carbon",planMonth:1,planQty:10,forecastQty:10,actualQty:0,vintageId:"V1",closeId:"C1"},
      {productId:"carbon",planMonth:2,planQty:10,forecastQty:10,actualQty:0,vintageId:"V2",closeId:"C2"},
      {productId:"carbon",planMonth:3,planQty:10,forecastQty:10,actualQty:0,vintageId:"V3",closeId:"C3"},
    ],
    minimumClosedPeriods:3,
  });
  assert.equal(result.available,false);
  assert.equal(result.wapePct,null);
  assert.match(result.reason,/actual demand denominator/i);
});


test("distinct close evidence counts periods even when relative plan-month numbers repeat after a horizon roll",()=>{
  const result=buildForecastLearning({
    observations:[
      {productId:"carbon",planMonth:1,planQty:1,forecastQty:1,actualQty:1,vintageId:"V1",closeId:"2026-09"},
      {productId:"carbon",planMonth:1,planQty:1,forecastQty:1,actualQty:1,vintageId:"V2",closeId:"2026-10"},
      {productId:"carbon",planMonth:1,planQty:1,forecastQty:1,actualQty:1,vintageId:"V3",closeId:"2026-11"},
    ],
    minimumClosedPeriods:3,
  });
  assert.equal(result.closedPeriods,3);
  assert.equal(result.available,true);
});

test("FVA percentage is withheld when the approved-plan baseline has zero absolute error",()=>{
  const result=buildForecastLearning({
    observations:[
      {productId:"carbon",planMonth:1,planQty:5,forecastQty:5,actualQty:5,vintageId:"V1",closeId:"C1"},
      {productId:"carbon",planMonth:2,planQty:5,forecastQty:5,actualQty:5,vintageId:"V2",closeId:"C2"},
      {productId:"carbon",planMonth:3,planQty:5,forecastQty:5,actualQty:5,vintageId:"V3",closeId:"C3"},
    ],
    minimumClosedPeriods:3,
  });
  assert.equal(result.available,true);
  assert.equal(result.planAbsoluteErrorUnits,0);
  assert.equal(result.fvaPct,null);
});
