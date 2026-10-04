export type DefectForecastInput={
  sampleSize:number;
  defectQuantity:number;
  minSampleSize?:number;
};

const round1=(value:number)=>Math.round(value*10)/10;
const round3=(value:number)=>Math.round(value*1000)/1000;

export function forecastDefectProbability(input:DefectForecastInput){
  const minSampleSize=Math.max(1,Math.trunc(input.minSampleSize??20));
  const n=Number(input.sampleSize);
  const defects=Number(input.defectQuantity);
  const unavailable=(reason:string)=>({
    available:false as const,
    method:"BETA_BINOMIAL_UNIFORM_PRIOR_NORMAL_APPROX_V1" as const,
    sampleSize:Number.isFinite(n)?n:0,
    defectQuantity:Number.isFinite(defects)?defects:0,
    observedDefectPct:null as number|null,
    expectedDefectPct:null as number|null,
    lower90Pct:null as number|null,
    upper90Pct:null as number|null,
    expectedYieldPct:null as number|null,
    reason,
  });

  if(!Number.isFinite(n)||!Number.isFinite(defects)||n<=0||defects<0||defects>n){
    return unavailable("Inspection sample and defect quantities are invalid.");
  }
  if(n<minSampleSize){
    return unavailable(`At least ${minSampleSize} inspected units are required in the sample before VYNDI publishes a defect/yield probability estimate.`);
  }

  const alpha=defects+1;
  const beta=n-defects+1;
  const total=alpha+beta;
  const mean=alpha/total;
  const variance=(alpha*beta)/(total*total*(total+1));
  const sd=Math.sqrt(Math.max(0,variance));
  const z=1.644854;
  const lower=Math.max(0,mean-z*sd);
  const upper=Math.min(1,mean+z*sd);
  const expectedDefectPct=round1(mean*100);

  return {
    available:true as const,
    method:"BETA_BINOMIAL_UNIFORM_PRIOR_NORMAL_APPROX_V1" as const,
    sampleSize:n,
    defectQuantity:defects,
    observedDefectPct:round1((defects/n)*100),
    expectedDefectPct,
    lower90Pct:round1(lower*100),
    upper90Pct:round1(upper*100),
    expectedYieldPct:round1(100-expectedDefectPct),
    reason:"Posterior-predictive defect probability from canonical inspection counts using a uniform Beta(1,1) prior and normal-approximation 90% interval.",
  };
}

export function calculateProcessCapability(input:{
  values:number[];
  lowerSpecLimit:number|null;
  upperSpecLimit:number|null;
  minSampleSize?:number;
}){
  const minSampleSize=Math.max(2,Math.trunc(input.minSampleSize??30));
  const values=input.values.filter((value)=>Number.isFinite(value));
  const unavailable=(reason:string)=>({
    available:false as const,
    sampleSize:values.length,
    mean:null as number|null,
    stdDev:null as number|null,
    cp:null as number|null,
    cpk:null as number|null,
    lowerSpecLimit:input.lowerSpecLimit,
    upperSpecLimit:input.upperSpecLimit,
    reason,
  });

  if(values.length<minSampleSize){
    return unavailable(`At least ${minSampleSize} actual measurements are required before Cp/Cpk is reported.`);
  }
  const lsl=input.lowerSpecLimit;
  const usl=input.upperSpecLimit;
  if(
    lsl==null||usl==null||
    !Number.isFinite(lsl)||!Number.isFinite(usl)||
    usl<=lsl
  ){
    return unavailable("Both valid lower and upper specification limits are required for Cp/Cpk.");
  }

  const mean=values.reduce((sum,value)=>sum+value,0)/values.length;
  const variance=values.reduce((sum,value)=>sum+Math.pow(value-mean,2),0)/(values.length-1);
  const stdDev=Math.sqrt(Math.max(0,variance));
  if(stdDev<=Number.EPSILON){
    return unavailable("Observed measurement variation is zero; VYNDI will not report infinite process capability.");
  }

  const cp=(usl-lsl)/(6*stdDev);
  const cpu=(usl-mean)/(3*stdDev);
  const cpl=(mean-lsl)/(3*stdDev);
  const cpk=Math.min(cpu,cpl);

  return {
    available:true as const,
    sampleSize:values.length,
    mean:round3(mean),
    stdDev:round3(stdDev),
    cp:round3(cp),
    cpk:round3(cpk),
    lowerSpecLimit:lsl,
    upperSpecLimit:usl,
    reason:"Cp/Cpk calculated from actual persisted measurements using sample standard deviation.",
  };
}
