import assert from "node:assert/strict";
import { test } from "node:test";
import { calculateProcessCapability, forecastDefectProbability } from "./manufacturing-quality-model.ts";

test("defect forecast is withheld below the governed sample threshold",()=>{
  const result=forecastDefectProbability({sampleSize:10,defectQuantity:1,minSampleSize:20});
  assert.equal(result.available,false);
  assert.equal(result.expectedDefectPct,null);
  assert.match(result.reason,/sample/i);
});

test("defect forecast uses transparent beta-binomial evidence when sample is sufficient",()=>{
  const result=forecastDefectProbability({sampleSize:100,defectQuantity:5,minSampleSize:20});
  assert.equal(result.available,true);
  assert.equal(result.method,"BETA_BINOMIAL_UNIFORM_PRIOR_NORMAL_APPROX_V1");
  assert.ok((result.expectedDefectPct??0)>0);
  assert.ok((result.expectedDefectPct??0)<10);
  assert.ok((result.upper90Pct??0)>(result.expectedDefectPct??0));
  assert.equal(result.expectedYieldPct,Math.round((100-(result.expectedDefectPct??0))*10)/10);
});

test("process capability requires at least 30 actual measurements and both spec limits",()=>{
  const insufficient=calculateProcessCapability({
    values:[1,2,3],lowerSpecLimit:0,upperSpecLimit:4,minSampleSize:30,
  });
  assert.equal(insufficient.available,false);

  const missingLimit=calculateProcessCapability({
    values:Array.from({length:30},(_,i)=>85.45+(i%5)*0.02),
    lowerSpecLimit:null,upperSpecLimit:85.7,minSampleSize:30,
  });
  assert.equal(missingLimit.available,false);
});

test("Cp and Cpk are calculated from actual measurement dispersion",()=>{
  const values=Array.from({length:40},(_,i)=>85.48+((i%8)-3.5)*0.01);
  const result=calculateProcessCapability({
    values,lowerSpecLimit:85.3,upperSpecLimit:85.7,minSampleSize:30,
  });
  assert.equal(result.available,true);
  assert.ok((result.cp??0)>1);
  assert.ok((result.cpk??0)>1);
  assert.ok((result.stdDev??0)>0);
  assert.equal(result.sampleSize,40);
});

test("zero variation is not converted into infinite process capability",()=>{
  const result=calculateProcessCapability({
    values:Array(30).fill(85.5),lowerSpecLimit:85.3,upperSpecLimit:85.7,minSampleSize:30,
  });
  assert.equal(result.available,false);
  assert.match(result.reason,/variation/i);
});
