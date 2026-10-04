export type EngineeringEffectivityType = "variant" | "date" | "serial" | "sales_order" | "job_card";

export type EngineeringEffectivityRule = {
  id: string;
  type: EngineeringEffectivityType;
  valueFrom: string | null;
  valueTo: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
};

export type EngineeringEffectivityContext = {
  date: string | null;
  variantId: string | null;
  serialNumber: string | null;
  salesOrderId: string | null;
  jobCardId: string | null;
};

export type EngineeringBaselineSnapshot = {
  id: string;
  familyCode: string;
  variantId: string | null;
  revisionCode: string;
  geometryRef: string;
  materialSpec: string;
  layupRef: string | null;
  alloySpec: string | null;
  toolingRef: string | null;
  drawingRef: string;
  bomRevision: string | null;
};

export type EngineeringBomLine = {
  mappingId: string;
  sku: string;
  quantity: number;
  unit: string;
  bomLineKey: string;
  configurationOptionId: string | null;
};

function lexicalInRange(value:string, from:string, to:string|null){
  return value >= from && (to == null || value <= to);
}

function matchesRule(rule:EngineeringEffectivityRule, context:EngineeringEffectivityContext){
  if(rule.type==="variant") return context.variantId!=null && rule.valueFrom!=null && context.variantId===rule.valueFrom;
  if(rule.type==="sales_order") return context.salesOrderId!=null && rule.valueFrom!=null && context.salesOrderId===rule.valueFrom;
  if(rule.type==="job_card") return context.jobCardId!=null && rule.valueFrom!=null && context.jobCardId===rule.valueFrom;
  if(rule.type==="serial") return context.serialNumber!=null && rule.valueFrom!=null && lexicalInRange(context.serialNumber,rule.valueFrom,rule.valueTo);
  if(rule.type==="date"){
    if(context.date==null || rule.effectiveFrom==null) return false;
    return context.date>=rule.effectiveFrom && (rule.effectiveTo==null || context.date<=rule.effectiveTo);
  }
  return false;
}

export function evaluateEngineeringChangeEffectivity(
  rules:EngineeringEffectivityRule[],
  context:EngineeringEffectivityContext,
){
  if(!rules.length) return {effective:false,matchedRuleIds:[] as string[],reason:"WITHHELD: no governed effectivity rule exists."};
  const byType=new Map<EngineeringEffectivityType,EngineeringEffectivityRule[]>();
  for(const rule of rules){
    const list=byType.get(rule.type)??[];
    list.push(rule);
    byType.set(rule.type,list);
  }
  const matchedRuleIds:string[]=[];
  // PLM semantics: OR inside one effectivity dimension, AND across represented dimensions.
  for(const group of byType.values()){
    const matched=group.filter((rule)=>matchesRule(rule,context));
    if(!matched.length) return {effective:false,matchedRuleIds,reason:"Effectivity failed because one governed dimension did not match."};
    matchedRuleIds.push(...matched.map((rule)=>rule.id));
  }
  return {effective:true,matchedRuleIds,reason:"Effectivity matched every represented dimension."};
}

const baselineFields:[keyof EngineeringBaselineSnapshot,string][]=[
  ["geometryRef","geometryRef"],["materialSpec","materialSpec"],["layupRef","layupRef"],
  ["alloySpec","alloySpec"],["toolingRef","toolingRef"],["drawingRef","drawingRef"],["bomRevision","bomRevision"],
];

function bomKey(line:EngineeringBomLine){
  return [line.bomLineKey,line.configurationOptionId??"",line.sku].join("|");
}

export function compareEngineeringBaselines(input:{
  from:EngineeringBaselineSnapshot;
  to:EngineeringBaselineSnapshot;
  fromBom:EngineeringBomLine[];
  toBom:EngineeringBomLine[];
}){
  const changedFields=baselineFields
    .filter(([field])=>input.from[field]!==input.to[field])
    .map(([field,label])=>({field:label,from:input.from[field],to:input.to[field]}));

  const fromMap=new Map(input.fromBom.map((line)=>[bomKey(line),line]));
  const toMap=new Map(input.toBom.map((line)=>[bomKey(line),line]));
  const addedBomLines:EngineeringBomLine[]=[];
  const removedBomLines:EngineeringBomLine[]=[];
  const changedBomLines:Array<EngineeringBomLine & {fromQuantity:number;toQuantity:number;fromUnit:string;toUnit:string}>=[];

  for(const [key,line] of toMap){
    const previous=fromMap.get(key);
    if(!previous){addedBomLines.push(line);continue;}
    if(previous.quantity!==line.quantity || previous.unit!==line.unit){
      changedBomLines.push({...line,fromQuantity:previous.quantity,toQuantity:line.quantity,fromUnit:previous.unit,toUnit:line.unit});
    }
  }
  for(const [key,line] of fromMap) if(!toMap.has(key)) removedBomLines.push(line);

  const bySku=(a:EngineeringBomLine,b:EngineeringBomLine)=>a.sku.localeCompare(b.sku)||a.bomLineKey.localeCompare(b.bomLineKey);
  addedBomLines.sort(bySku);
  removedBomLines.sort(bySku);
  changedBomLines.sort(bySku);

  const materialFields=new Set(["materialSpec","layupRef","alloySpec"]);
  return {
    changedFields,
    addedBomLines,
    removedBomLines,
    changedBomLines,
    materialChange:changedFields.some((row)=>materialFields.has(row.field)),
    geometryChange:changedFields.some((row)=>row.field==="geometryRef"),
    toolingChange:changedFields.some((row)=>row.field==="toolingRef"),
    drawingChange:changedFields.some((row)=>row.field==="drawingRef"),
    bomChange:input.from.bomRevision!==input.to.bomRevision || addedBomLines.length>0 || removedBomLines.length>0 || changedBomLines.length>0,
  };
}
