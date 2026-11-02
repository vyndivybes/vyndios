// @ts-nocheck
import {AGENTS,METRICS,defaultDefinition,interpretRequest,validateDefinition,projectEvidence} from './bi-model.mjs';
const element=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=String(text);if(cls)n.className=cls;return n;};
// Mountable in the existing Command Centre and VAOS Intelligence workspace.
export function mountBiStudio(host,adapter) {
 let definition=defaultDefinition(),enterprise=null,workforce=null,savedId=null,revision=0,generation=0,disposed=false;
 const root=element('section',undefined,'bi-studio');root.setAttribute('aria-label','Conversational business intelligence');host.append(root);
 const heading=element('header');heading.append(element('p','BUSINESS INTELLIGENCE','bi-eyebrow'),element('h2','Ask. Inspect. Keep the evidence.'));
 heading.append(element('p','Create and edit a report using department names, dated records, backlog, workflow states or verified agent closures. Requests use a bounded metric catalog.'));
 const form=element('form'),input=element('textarea');input.rows=2;input.maxLength=1000;input.placeholder='Finance and production workflow states, last 30 days';input.setAttribute('aria-label','Dashboard request');
 const ask=element('button','Create / edit dashboard');ask.type='submit';form.append(input,ask);
 const examples=element('div',undefined,'bi-controls');
 for(const text of ['Finance records, last 30 days','Production backlog','Engineering and HR states',...(adapter.supportsAgents===false?[]:['Consolidated verified agent closures, last 7 days'])]){const b=element('button',text);b.type='button';b.addEventListener('click',()=>{input.value=text;form.requestSubmit();});examples.append(b);}
 const controls=element('div',undefined,'bi-controls');
 const select=element('select');select.setAttribute('aria-label','Metric');for(const [id,m]of Object.entries(METRICS).filter(([id])=>adapter.supportsAgents!==false||id!=='agents'))select.append(new Option(m.label,id));
 const from=element('input'),to=element('input');from.type=to.type='date';from.setAttribute('aria-label','Period from');to.setAttribute('aria-label','Period to');
 const chart=element('select');chart.setAttribute('aria-label','Chart type');chart.append(new Option('Interactive bars','bar'),new Option('Data table','table'));
 const refresh=element('button','Refresh evidence');refresh.type='button';controls.append(select,from,to,chart,refresh);
 const department=element('select');department.setAttribute('aria-label','Department drill-down');department.append(new Option('All permitted departments','all'));for(const id of AGENTS)department.append(new Option(id,id));controls.append(department);
 const notice=element('p','No evidence loaded. Choose a question or refresh.','bi-notice');notice.setAttribute('role','status');
 const transcript=element('div',undefined,'bi-transcript');transcript.setAttribute('aria-label','Conversation');
 const result=element('div'),inspector=element('details'),summary=element('summary','Metric definition & read-only SQL');inspector.append(summary);
 const explanation=element('div');inspector.append(explanation);
 const persist=element('div',undefined,'bi-controls'),title=element('input');title.maxLength=120;title.setAttribute('aria-label','Dashboard title');
 const save=element('button','Save dashboard definition'),share=element('button','Copy permitted link'),saved=element('select');saved.setAttribute('aria-label','Saved dashboards');saved.append(new Option('Open saved dashboard',''));
 const visibility=element('select');visibility.setAttribute('aria-label','Sharing');visibility.append(new Option('Private','private'),new Option('Existing authorized audience','authorized'));
 persist.append(title,visibility,save,share,saved);save.type=share.type='button';share.disabled=true;
 root.append(heading,form,examples,controls,notice,transcript,result,inspector,persist);
 function syncUrl(id){const u=new URL(location.href);if(id)u.searchParams.set('dashboard',id);else u.searchParams.delete('dashboard');history.replaceState(null,'',u);}
 function sync(){select.value=definition.metric;from.value=definition.from;to.value=definition.to;chart.value=definition.chart;title.value=definition.title;department.value=definition.agents.length===1?definition.agents[0]:'all';}
 function render(){
  const p=projectEvidence(definition,enterprise,workforce);result.replaceChildren();explanation.replaceChildren();
  result.append(element('p','Reporting day: Asia/Kolkata. Source dates retain their recorded meaning.'),element('h3',definition.title),element('p',p.metric.meaning),element('p','Observed: '+(p.observedAt||'not observed')+' · Coverage '+p.coverage));
  const rows=p.rows,max=Math.max(1,...rows.map(r=>r.value||0));
  if(definition.chart==='bar')for(const r of rows){
   const b=element('button',undefined,'bi-bar');b.type='button';b.setAttribute('aria-label','Inspect '+r.label);
   b.append(element('span',r.label),element('strong',r.value===null?r.state:r.value+' '+p.metric.unit),element('small',r.state));const meter=element('meter');meter.min=0;meter.max=max;meter.value=r.value??0;meter.setAttribute('aria-label',r.label+' count');b.append(meter);
   b.addEventListener('click',()=>{definition={...definition,agents:[r.agent]};sync();render();inspector.open=true;});result.append(b);
  }else{const table=element('table'),head=element('tr');for(const t of ['Department / state','Value','Evidence state','Source'])head.append(element('th',t));const thead=element('thead');thead.append(head);table.append(thead);const body=element('tbody');for(const r of rows){const tr=element('tr');for(const v of [r.label,r.value??'Unknown',r.state,r.source])tr.append(element('td',v));body.append(tr);}table.append(body);result.append(table);}
  result.append(element('p',p.note));
  for(const r of rows){explanation.append(element('p',r.label+' · '+r.source+' · '+r.state+(r.reason?' · '+r.reason:'' )+(r.originUnknown?' · '+r.originUnknown+' rows have unclassified origin.':'')+(Number.isSafeInteger(r.excludedTraining)?' · '+r.excludedTraining+' explicit training rows excluded.':'')));}
  if(definition.metric!=='agents')for(const d of enterprise?.departments||[]){if(!definition.agents.includes(d.employeeId))continue;for(const s of d.sources||[]){if(!s.query)continue;const details=element('details');details.append(element('summary',s.sourceTable+' executed query'),element('pre',s.query.sql),element('pre','Parameters: '+JSON.stringify(s.query.parameters)));details.append(element('p','First '+(s.records?.length||0)+' dated rows, bounded detail sample. Counts cover the full source.'));for(const r of s.records||[])details.append(element('pre',JSON.stringify(r,null,2)));explanation.append(details);}}
  else {explanation.append(element('p','Source: existing vaos_founder_workforce_overview function; independently verified closure evidence only. Open Workforce Analytics for underlying work packages and handoffs.'));if(workforce?.query)explanation.append(element('pre',workforce.query.sql),element('pre',JSON.stringify(workforce.query.parameters)));}
 }
 async function load(){const ticket=++generation;refresh.disabled=ask.disabled=true;notice.textContent='Reading authorized source evidence…';enterprise=workforce=null;result.replaceChildren();try{const data=await adapter.read(definition);if(disposed||ticket!==generation)return;if(data.permittedAgents){definition={...definition,agents:data.permittedAgents};sync();for(const option of department.options)if(option.value!=='all')option.disabled=!(data.allowedAgents||data.permittedAgents).includes(option.value);}
 enterprise=data.enterprise;workforce=data.workforce;notice.textContent='Source response received. Unavailable and empty sources remain labeled separately.';render();}catch(e){if(!disposed&&ticket===generation){notice.textContent=e.message||'Evidence unavailable';render();}}finally{if(!disposed&&ticket===generation)refresh.disabled=ask.disabled=false;}}
 form.addEventListener('submit',async e=>{e.preventDefault();try{const next=interpretRequest(input.value,definition);const line=element('p','You: '+input.value);transcript.append(line,element('p','Report: '+next.title+'. '+METRICS[next.metric].meaning));while(transcript.children.length>8)transcript.firstChild.remove();definition=next;savedId=null;revision=0;share.disabled=true;syncUrl(null);sync();await load();}catch(error){notice.textContent=error.message;}});
 for(const control of [select,from,to,chart,department])control.addEventListener('change',async()=>{try{definition=validateDefinition({...definition,metric:select.value,from:from.value,to:to.value,chart:chart.value,agents:select.value==='crm'?['commercial']:department.value==='all'?[...AGENTS]:[department.value]});savedId=null;revision=0;share.disabled=true;await load();}catch(error){notice.textContent=error.message;sync();}});
 refresh.addEventListener('click',load);
 async function list(){try{const rows=await adapter.list();saved.replaceChildren(new Option('Open saved dashboard',''));for(const r of rows)saved.append(new Option(r.title,r.id));}catch(e){notice.textContent='Saved dashboards unavailable: '+e.message;}}
 save.addEventListener('click',async()=>{save.disabled=true;try{definition=validateDefinition({...definition,title:title.value});const r=await adapter.save({id:savedId,revision,visibility:visibility.value,definition});savedId=r.id;revision=r.revision;share.disabled=false;syncUrl(savedId);notice.textContent='Definition saved. Source results are read again on opening.';await list();}catch(e){notice.textContent='Save failed: '+e.message;}finally{save.disabled=false;}});
 async function open(id){try{const r=await adapter.open(id);definition=validateDefinition(r.definition);savedId=r.id;revision=r.revision;visibility.value=r.visibility;share.disabled=false;syncUrl(savedId);sync();await load();}catch(e){notice.textContent='Dashboard unavailable or access denied: '+e.message;}}
 saved.addEventListener('change',()=>{if(saved.value)open(saved.value);});
 share.addEventListener('click',async()=>{try{const u=new URL(location.href);u.searchParams.set('dashboard',savedId);u.hash='business-intelligence';await navigator.clipboard.writeText(u.href);notice.textContent='Link copied. Sign-in and current source permissions are required; private reports remain owner-only.';}catch{notice.textContent='Clipboard unavailable. Open this saved report and copy the page address.';}});
 sync();list();const id=new URL(location.href).searchParams.get('dashboard');if(id)open(id);
 return ()=>{disposed=true;++generation;root.remove();};
}
