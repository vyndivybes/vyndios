export type ForecastLearningObservation = {
  productId: string;
  planMonth: number;
  planQty: number;
  forecastQty: number;
  actualQty: number;
  vintageId: string;
  closeId: string;
};

export type ForecastLearningInput = {
  observations: ForecastLearningObservation[];
  minimumClosedPeriods?: number;
};

const round4=(value:number)=>Math.round(value*10000)/10000;

export function buildForecastLearning(input:ForecastLearningInput){
  const minimumClosedPeriods=input.minimumClosedPeriods??3;
  const observations=input.observations.filter((row)=>
    Number.isFinite(row.planQty)&&row.planQty>=0&&
    Number.isFinite(row.forecastQty)&&row.forecastQty>=0&&
    Number.isFinite(row.actualQty)&&row.actualQty>=0
  );
  const closedPeriods=new Set(observations.map((row)=>row.closeId)).size;
  const planUnits=round4(observations.reduce((sum,row)=>sum+row.planQty,0));
  const forecastUnits=round4(observations.reduce((sum,row)=>sum+row.forecastQty,0));
  const actualUnits=round4(observations.reduce((sum,row)=>sum+row.actualQty,0));
  const planAbsoluteErrorUnits=round4(observations.reduce((sum,row)=>sum+Math.abs(row.actualQty-row.planQty),0));
  const forecastAbsoluteErrorUnits=round4(observations.reduce((sum,row)=>sum+Math.abs(row.actualQty-row.forecastQty),0));
  const forecastBiasUnits=round4(observations.reduce((sum,row)=>sum+(row.forecastQty-row.actualQty),0));
  const fvaUnits=round4(planAbsoluteErrorUnits-forecastAbsoluteErrorUnits);

  const enoughPeriods=closedPeriods>=minimumClosedPeriods;
  const validActualDenominator=actualUnits>0;
  const available=enoughPeriods&&validActualDenominator;

  const wapePct=available?round4((forecastAbsoluteErrorUnits/actualUnits)*100):null;
  const biasPct=available?round4((forecastBiasUnits/actualUnits)*100):null;
  const planAttainmentPct=available&&planUnits>0?round4((actualUnits/planUnits)*100):null;
  const forecastAttainmentPct=available&&forecastUnits>0?round4((actualUnits/forecastUnits)*100):null;
  const fvaPct=available&&planAbsoluteErrorUnits>0?round4((fvaUnits/planAbsoluteErrorUnits)*100):null;

  let reason="Forecast learning is available from immutable pre-period vintages and governed closed actuals.";
  if(!enoughPeriods){
    reason=`Forecast learning WITHHELD: at least ${minimumClosedPeriods} distinct closed periods are required; ${closedPeriods} are currently eligible.`;
  }else if(!validActualDenominator){
    reason="Forecast learning WITHHELD: the closed-period actual demand denominator is zero, so WAPE and bias percentages would be misleading.";
  }

  const rows=observations.map((row)=>({
    ...row,
    planErrorUnits:round4(row.actualQty-row.planQty),
    forecastErrorUnits:round4(row.actualQty-row.forecastQty),
    absolutePlanErrorUnits:round4(Math.abs(row.actualQty-row.planQty)),
    absoluteForecastErrorUnits:round4(Math.abs(row.actualQty-row.forecastQty)),
    fvaUnits:round4(Math.abs(row.actualQty-row.planQty)-Math.abs(row.actualQty-row.forecastQty)),
  }));

  return {
    method:"VYNDI_FORECAST_LEARNING_1" as const,
    available,
    reason,
    minimumClosedPeriods,
    closedPeriods,
    samples:observations.length,
    planUnits,
    forecastUnits,
    actualUnits,
    planAbsoluteErrorUnits,
    forecastAbsoluteErrorUnits,
    forecastBiasUnits,
    wapePct,
    biasPct,
    planAttainmentPct,
    forecastAttainmentPct,
    fvaUnits,
    fvaPct,
    rows,
    boundaries:[
      "Only immutable vintages captured before the target period start are eligible for backtesting.",
      "Only the latest governed close revision for each period is used as actual evidence.",
      "WAPE uses actual units as denominator; zero actual demand withholds the percentage.",
      "Positive Forecast Value Added means the governed forecast reduced absolute error versus the approved-plan baseline.",
      "Forecast learning is advisory and does not overwrite approved plans, Sales Orders, Production, Inventory, Procurement or Finance actuals.",
    ],
  };
}
