import { forecastDefectProbability } from "./manufacturing-quality-model.ts";

const round1=(value:number)=>Math.round(value*10)/10;

function betaBernoulliForecast(events:boolean[],minEvents:number){
  if(events.length<minEvents){
    return {
      available:false as const,
      eventCount:events.length,
      adverseCount:events.filter(Boolean).length,
      observedLatePct:null as number|null,
      expectedLatePct:null as number|null,
      lower90Pct:null as number|null,
      upper90Pct:null as number|null,
      reason:`At least ${minEvents} completed PO/receipt events are required before empirical late-delivery probability is reported.`,
    };
  }
  const adverse=events.filter(Boolean).length;
  const alpha=adverse+1;
  const beta=events.length-adverse+1;
  const total=alpha+beta;
  const mean=alpha/total;
  const variance=(alpha*beta)/(total*total*(total+1));
  const sd=Math.sqrt(Math.max(0,variance));
  const z=1.644854;
  return {
    available:true as const,
    eventCount:events.length,
    adverseCount:adverse,
    observedLatePct:round1((adverse/events.length)*100),
    expectedLatePct:round1(mean*100),
    lower90Pct:round1(Math.max(0,mean-z*sd)*100),
    upper90Pct:round1(Math.min(1,mean+z*sd)*100),
    reason:"Posterior-predictive late-delivery probability from completed PO/GRN outcomes using a uniform Beta(1,1) prior.",
  };
}

function empiricalP80(values:number[]){
  if(!values.length) return null;
  const sorted=[...values].sort((a,b)=>a-b);
  const position=(sorted.length-1)*0.8;
  const low=Math.floor(position);
  const high=Math.ceil(position);
  if(low===high) return round1(sorted[low]!);
  const weight=position-low;
  return round1(sorted[low]!*(1-weight)+sorted[high]!*weight);
}

export function analyzeSupplierRiskEvidence(input:{
  approvedLaneCount:number;
  governedLeadTimeDays:number|null;
  governedReliability:number|null;
  qualityRating:number|null;
  deliveryRating:number|null;
  deliveryDelaysDays:number[];
  actualLeadTimeDays:number[];
  receivedQuantity:number;
  rejectedQuantity:number;
}){
  const leadTimes=input.actualLeadTimeDays.filter((value)=>Number.isFinite(value)&&value>=0);
  const leadTimeAvailable=leadTimes.length>=5;
  const meanLeadTime=leadTimeAvailable
    ? leadTimes.reduce((sum,value)=>sum+value,0)/leadTimes.length
    : null;
  const governedLeadTime=input.governedLeadTimeDays!=null&&Number.isFinite(input.governedLeadTimeDays)
    ? input.governedLeadTimeDays
    : null;

  const reliability=input.governedReliability;
  const governedReliabilityPct=reliability==null||!Number.isFinite(reliability)
    ? null
    : round1((reliability<=1?reliability:reliability/100)*100);

  return {
    singleSource:input.approvedLaneCount===1,
    approvedLaneCount:Math.max(0,Math.trunc(input.approvedLaneCount)),
    singleSourceProbability:null as null,
    governedLeadTimeDays:governedLeadTime,
    governedReliabilityPct,
    qualityRating:input.qualityRating,
    deliveryRating:input.deliveryRating,
    deliveryForecast:betaBernoulliForecast(
      input.deliveryDelaysDays
        .filter((value)=>Number.isFinite(value))
        .map((delay)=>delay>0),
      5,
    ),
    actualLeadTime:leadTimeAvailable
      ? {
          available:true as const,
          eventCount:leadTimes.length,
          meanDays:round1(meanLeadTime!),
          p80Days:empiricalP80(leadTimes),
          meanDriftDays:governedLeadTime==null?null:round1(meanLeadTime!-governedLeadTime),
          reason:"Actual PO order-date to GRN receipt-date evidence.",
        }
      : {
          available:false as const,
          eventCount:leadTimes.length,
          meanDays:null as number|null,
          p80Days:null as number|null,
          meanDriftDays:null as number|null,
          reason:"At least 5 completed PO/receipt lead-time observations are required before empirical lead-time drift is reported.",
        },
    incomingQuality:forecastDefectProbability({
      sampleSize:Math.max(0,input.receivedQuantity),
      defectQuantity:Math.max(0,input.rejectedQuantity),
      minSampleSize:20,
    }),
    boundaries:[
      "Single-source exposure is a configuration fact, not a probability.",
      "Governed supplier reliability and supplier quality/delivery ratings remain separate from empirical PO/GRN performance.",
      "Late-delivery probability is derived only from completed expected-vs-actual receipt events.",
      "Incoming quality probability is derived only from received/rejected quantity evidence.",
      "No geographic or geopolitical supplier risk is inferred unless such evidence is explicitly governed.",
    ],
  };
}
