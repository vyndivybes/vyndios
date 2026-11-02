// @ts-nocheck
// Shared dashboard contract v1. Keep byte-identical with VYNDI public/bi-model.mjs.
export const AGENTS = Object.freeze(['orchestrator','project','vibpe','risk','knowledge','release','qa','commercial','procurement','inventory','production','maintenance','finance','people','engineering-configuration','security']);
export const METRICS = Object.freeze({
 crm: {label:'Dated CRM activities',unit:'activities',meaning:'Dated rows in the canonical VYNDI CRM activity ledger. No sales conversion, revenue or customer performance is inferred.'},
 activity: {label:'Dated source records',unit:'records',meaning:'Count of current source rows whose first available source date falls in the period. Excludes explicitly marked training/fixtures. This is not an event history or AI productivity.'},
 backlog: {label:'Current attention flags',unit:'records',meaning:'Current pending, held or draft source states across all dates. Period filters do not apply. A flag is not a verified defect.'},
 statuses: {label:'Recorded workflow states',unit:'records',meaning:'Current workflow state of dated source rows in the selected period. A completed source state does not prove agent execution.'},
 agents: {label:'Verified agent closures',unit:'work packages',meaning:'Independently verified closures from the existing VAOS workforce evidence. Only supported rolling windows are used; unknown evidence remains unknown.'},
});
const aliases = {finance:'finance',financial:'finance',production:'production',manufacturing:'production',engineering:'vibpe',vedm:'vibpe',procurement:'procurement',purchasing:'procurement',crm:'commercial',sales:'commercial',hr:'people',people:'people',inventory:'inventory',security:'security',maintenance:'maintenance',quality:'qa',projects:'project'};
export const businessDay=(now=new Date())=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
const day = v => typeof v==='string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0,10)===v;
export function validateDefinition(value, now=new Date()) {
 if(!value || value.version!==1 || !Object.hasOwn(METRICS,value.metric) || !['bar','table'].includes(value.chart) || !Array.isArray(value.agents) || !value.agents.length || value.agents.length>16 || new Set(value.agents).size!==value.agents.length || value.agents.some(id=>!AGENTS.includes(id)) || !day(value.from)||!day(value.to)||value.from>value.to||value.to>businessDay(now)||Date.parse(value.to)-Date.parse(value.from)>366*86400000) throw Error('Choose a supported metric, agents and a period of at most 367 days ending today or earlier.');
 if(typeof value.title!=='string'||!value.title.trim()||value.title.length>120) throw Error('Dashboard title must contain 1–120 characters.');
 return {version:1,title:value.title.trim(),metric:value.metric,chart:value.chart,agents:[...value.agents],from:value.from,to:value.to};
}
export function defaultDefinition(now=new Date()) {
 const end=new Date(businessDay(now)+'T00:00:00Z');const start=new Date(end);start.setUTCDate(start.getUTCDate()-29);
 return {version:1,title:'Department evidence',metric:'activity',chart:'bar',agents:[...AGENTS],from:start.toISOString().slice(0,10),to:end.toISOString().slice(0,10)};
}
export function interpretRequest(prompt, previous=defaultDefinition(), now=new Date()) {
 if(typeof prompt!=='string'||!prompt.trim()||prompt.length>1000) throw Error('Enter a request of 1–1000 characters.');
 const text=prompt.toLowerCase();
 if(/\b(?:last|past)\s+\d+\s+days\b/.test(text)&&!/\b(?:last|past) (7|30|90) days\b/.test(text))throw Error('Use last 7, 30 or 90 days, or explicit YYYY-MM-DD to YYYY-MM-DD dates.');
 if(/\b(select|insert|update|delete|drop|alter|grant|truncate|sql)\b|;|--/.test(text)) throw Error('Use a business question. SQL text is never accepted or executed.');
 if(/\b(revenue|profit|margin|salary|yield|roi|forecast|productivity)\b/.test(text)) throw Error('That metric has no qualified definition in this catalog. Use dated records, backlog, workflow states or verified agent closures.');
 const next={...validateDefinition(previous,now),agents:[...previous.agents]};let recognized=false;
 if(/\b(all|consolidated|company|departments)\b/.test(text)){next.agents=[...AGENTS];recognized=true;}
 const selected=new Set();
 for(const id of AGENTS) if(new RegExp('(^|[^a-z-])'+id+'([^a-z-]|$)').test(text))selected.add(id);
 for(const [word,id] of Object.entries(aliases)) if(new RegExp('\\b'+word+'\\b').test(text)) selected.add(id);
 if(selected.size){next.agents=[...selected];recognized=true;}
 const metric=/\bcrm\b/.test(text)?'crm':/\b(closures|verified|agents|agent)\b/.test(text)?'agents':/\b(backlog|attention|pending|held)\b/.test(text)?'backlog':/\b(status|statuses|states)\b/.test(text)?'statuses':/\b(activity|records|dated)\b/.test(text)?'activity':null;
 if(metric){next.metric=metric;recognized=true;}
 const days=text.match(/\b(?:last|past) (7|30|90) days\b/);
 if(days){const d=defaultDefinition(now);next.to=d.to;next.from=new Date(Date.parse(d.to)-(Number(days[1])-1)*86400000).toISOString().slice(0,10);recognized=true;}
 const dates=text.match(/\b(\d{4}-\d{2}-\d{2})\s+(?:to|through)\s+(\d{4}-\d{2}-\d{2})\b/);
 if(dates){next.from=dates[1];next.to=dates[2];recognized=true;}
 if(/\b(table|bars|bar)\b/.test(text)){next.chart=text.includes('table')?'table':'bar';recognized=true;}
 if(!recognized) throw Error('Try “Finance workflow states, last 30 days” or “Consolidated verified agent closures, last 7 days”.');
 next.title=METRICS[next.metric].label+' · '+(next.agents.length===16?'all departments':next.agents.join(', '));
 return validateDefinition(next,now);
}
export function projectEvidence(definition, enterprise, workforce, now=new Date()) {
 const d=validateDefinition(definition,now),meta=METRICS[d.metric];
 const samePeriod=enterprise?.period?.from===d.from&&enterprise?.period?.to===d.to;
 const rows=d.agents.flatMap(id=>{
  if(d.metric==='agents'){
   const employee=workforce?.employees?.find(e=>e.id===id);
   const end=businessDay(now),days=(Date.parse(d.to)-Date.parse(d.from))/86400000+1;
   const age=now.getTime()-Date.parse(workforce?.observedAt);
   const valid=d.to===end&&[7,30,90].includes(days)&&Number.isFinite(age)&&age>=-60000&&age<=300000;
   const value=valid&&employee?.sourceStatus==='RECORDED'?employee.verifiedClosures?.[days+'d']:null;
   return [{agent:id,label:id,value:Number.isSafeInteger(value)&&value>=0?value:null,state:!valid?'UNAVAILABLE_WINDOW_OR_FRESHNESS':Number.isSafeInteger(value)&&value>=0?'REAL':'UNAVAILABLE',source:'vaos_private.work_packages + independent handoff verification',reason:valid?'Rolling 24-hour-day closure window ends at workforce observation time, not calendar midnight.':'Requires a fresh observation and rolling 7, 30 or 90 days ending today.'}];
  }
  const department=samePeriod?enterprise?.departments?.find(e=>e.employeeId===id):null;
  const record=d.metric==='crm'?department?.sources?.find(s=>s.sourceTable==='vyndi_crm_activities'):department;
  if(record?.status!=='OBSERVED')return [{agent:id,label:id,value:null,state:'UNAVAILABLE',source:record?.sourceTable||'Authoritative VYNDI source',reason:'Source not observed for this period. No zero inferred.'}];
  const context={agent:id,source:record.sourceTable,originUnknown:record.unclassifiedOriginCount,excludedTraining:record.excludedTrainingCount};
  if(d.metric==='statuses')return record.statusDistribution?.length?record.statusDistribution.map(s=>({...context,label:id+' / '+s.status,value:s.count,state:'REAL'})):[{...context,label:id,value:0,state:'EMPTY'}];
  const value=d.metric==='backlog'?record.currentAttentionCount:record.periodEventCount;
  return [{...context,label:id,value:Number.isSafeInteger(value)&&value>=0?value:null,state:!Number.isSafeInteger(value)?'UNAVAILABLE':value===0?'EMPTY':'REAL'}];
 });
 return {definition:d,metric:meta,rows,observedAt:d.metric==='agents'?workforce?.observedAt:enterprise?.observedAt,coverage:rows.filter(r=>r.value!==null).length+'/'+rows.length,note:'Department sources overlap. Do not add source records as output or financial performance. No demo performance data is supplied.'};
}
