import {createFileRoute,Link,useRouter} from '@tanstack/react-router';
import {useMemo,useState} from 'react';
import {Activity,BarChart3,CheckCircle2,Download,ExternalLink,Layers3,RefreshCw,TrendingUp} from 'lucide-react';
import {Area,AreaChart,Bar,BarChart,CartesianGrid,Cell,ComposedChart,Legend,Line,LineChart,Pie,PieChart,ResponsiveContainer,Scatter,ScatterChart,Tooltip,XAxis,YAxis,ReferenceLine} from 'recharts';
import {getOperatingLineage} from '@/lib/operating-lineage';
import {getAllErpSuiteReports} from '@/lib/erp-suite-reports';
import {getOperatingPlanState} from '@/lib/operating-plan-authority';
import {listMonthlyActuals} from '@/lib/actuals-authority';
import {getAnalyticsSupplySnapshot} from '@/lib/analytics-supply-authority';
import {buildModelWithInputs,type ScenarioId} from '@/lib/finance/model';
import {buildAnalyticsRows,filterAnalyticsRows,aggregateAnalyticsRows,paretoAnalyticsRows,buildKanbanLanes,getNumericMetrics,DATASETS,DIMENSIONS,type AnalyticsDatum} from '@/lib/analytics-studio';

export const Route=createFileRoute('/command/analytics-studio')({
  loader:async()=>{
    const [lineage,report,plan,actuals,supply]=await Promise.all([
      getOperatingLineage(),getAllErpSuiteReports(),getOperatingPlanState(),listMonthlyActuals(),getAnalyticsSupplySnapshot(),
    ]);
    return {lineage,report,approvedPlan:plan.approved,actuals,supply};
  },
  component:AnalyticsStudio,
});
type Visual='bar'|'line'|'area'|'pie'|'scatter'|'pareto'|'kanban';
const VISUALS:readonly {id:Visual;label:string}[]=[
  {id:'bar',label:'Bar'},{id:'line',label:'Trend'},{id:'area',label:'Area'},
  {id:'pie',label:'Pie'},{id:'scatter',label:'Scatter'},{id:'pareto',label:'Pareto'},{id:'kanban',label:'Kanban'},
];
const COLOR=['#F9AB55','#97CB8A','#5BA6DD','#D78CD8','#ECC86F','#75C7BB','#E98E92','#8E9EBE'];
const number=(v:number)=>v.toLocaleString('en-IN',{maximumFractionDigits:2});
const currency=(v:number)=>'₹'+number(v)+'L';
const pretty=(s:string)=>s.replace(/([a-z])([A-Z])/g,'$1 $2').replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
const card='rounded-2xl border border-border bg-surface/60 shadow-sm';
const control='w-full min-w-0 rounded-xl border border-border bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent';
function Filter({label,children}:{label:string;children:React.ReactNode}){
  return <label className="flex min-w-0 flex-col gap-1.5"><span className="text-[10px] font-semibold uppercase tracking-[.13em] text-muted">{label}</span>{children}</label>;
}
function chartAxis(v:unknown){const s=String(v??'');return s.length>18?s.slice(0,17)+'…':s;}
function Empty({text}:{text:string}){return <div className="flex min-h-60 items-center justify-center rounded-xl border border-dashed border-border px-6 text-center text-sm text-muted">{text}</div>}
function Stat({label,value,hint}:{label:string;value:string;hint:string}){
  return <div className={card+' p-4'}><p className="text-[10px] font-semibold uppercase tracking-[.14em] text-muted">{label}</p>
    <strong className="mt-2 block text-2xl font-semibold tabular-nums text-fg">{value}</strong><p className="mt-1 text-xs text-subtle">{hint}</p></div>;
}
function ChartSurface({rows,metric,dimension,visual}:{rows:AnalyticsDatum[];metric:string;dimension:string;visual:Visual}){
 const aggregated=aggregateAnalyticsRows(rows,dimension,metric);
 const ranked=paretoAnalyticsRows(rows,dimension,metric);
 const plotted=visual==='pareto'?ranked:aggregated;
 const readable=pretty(metric);
 if(!plotted.length)return <Empty text="No sourced observations for this metric and filter. Change the variable or date range."/>;
 if(visual==='kanban'){
   const lanes=buildKanbanLanes(rows);
   if(!rows.some(r=>r.dataset==='flow'))return <Empty text="Kanban requires the Demand → cash dataset. Select it above."/>;
   return <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
     {lanes.map((lane,i)=><div key={lane.name} className="min-h-44 rounded-xl border border-border bg-bg/65 p-3">
       <div className="mb-3 flex items-center justify-between gap-2"><h3 className="text-sm font-semibold text-fg">{lane.name}</h3><span className="rounded-full border border-border px-2 py-0.5 text-xs text-accent">{lane.items.length}</span></div>
       <div className="space-y-2">{lane.items.slice(0,100).map(item=><div key={item.id} className="rounded-lg border border-border bg-surface p-3 text-xs shadow-sm">
         <div className="font-semibold text-fg">{item.id}</div><div className="mt-1 text-muted">{item.variant||'Unspecified variant'} · {item.month===null?'Month unspecified':'M'+item.month}</div>
         <div className="mt-2 text-muted">{item.metrics.units??'—'} units · {item.metrics.shortageLines??'—'} shortage lines</div>
       </div>)}{lane.items.length>100&&<p className="text-xs text-muted">{lane.items.length-100} further sourced records not shown</p>}</div>
     </div>)}
   </div>;
 }
 return <div className="h-[340px] w-full sm:h-[390px]" role="img" aria-label={visual+' chart of '+readable+' by '+pretty(dimension)}>
  <ResponsiveContainer width="100%" height="100%">
   {visual==='pie'?<PieChart><Pie data={plotted} dataKey="value" nameKey="name" innerRadius="38%" outerRadius="72%" label={({name,percent})=>String(name).slice(0,15)+' '+number((percent||0)*100)+'%'} labelLine={false}>
    {plotted.map((p,i)=><Cell key={p.name} fill={COLOR[i%COLOR.length]}/>)}</Pie><Tooltip formatter={(value)=>number(Number(value))}/><Legend/></PieChart>
   :visual==='pareto'?<ComposedChart data={plotted} margin={{top:14,right:22,left:4,bottom:32}}>
     <CartesianGrid strokeDasharray="3 5" opacity={.14}/><XAxis dataKey="name" angle={-20} textAnchor="end" height={65} tickFormatter={chartAxis} tick={{fontSize:11}}/>
     <YAxis yAxisId="left" tick={{fontSize:11}}/><YAxis yAxisId="right" orientation="right" domain={[0,100]} tick={{fontSize:11}} unit="%"/>
     <Tooltip/><Legend verticalAlign="top" height={30}/><Bar yAxisId="left" dataKey="value" name={readable} fill={COLOR[0]} radius={[5,5,0,0]}/>
     <Line yAxisId="right" type="monotone" dataKey="cumulativePercent" name="Cumulative %" stroke={COLOR[1]} strokeWidth={3} dot/>
     <ReferenceLine yAxisId="right" y={80} stroke={COLOR[3]} strokeDasharray="5 5"/>
     </ComposedChart>
   :visual==='line'?<LineChart data={plotted} margin={{top:10,right:16,bottom:32,left:2}}><CartesianGrid strokeDasharray="3 5" opacity={.13}/>
      <XAxis dataKey="name" tickFormatter={chartAxis} angle={-20} textAnchor="end" height={65} tick={{fontSize:11}}/><YAxis tick={{fontSize:11}}/>
      <Tooltip/><Line type="monotone" dataKey="value" name={readable} stroke={COLOR[0]} strokeWidth={3} dot/></LineChart>
   :visual==='area'?<AreaChart data={plotted} margin={{top:10,right:16,bottom:32,left:2}}><CartesianGrid strokeDasharray="3 5" opacity={.13}/>
      <XAxis dataKey="name" tickFormatter={chartAxis} angle={-20} textAnchor="end" height={65} tick={{fontSize:11}}/><YAxis tick={{fontSize:11}}/>
      <Tooltip/><Area type="monotone" dataKey="value" name={readable} stroke={COLOR[1]} fill={COLOR[1]} fillOpacity={.25}/></AreaChart>
   :visual==='scatter'?<ScatterChart margin={{top:10,right:16,bottom:32,left:2}}><CartesianGrid strokeDasharray="3 5" opacity={.13}/>
      <XAxis dataKey="records" name="Records" type="number" tick={{fontSize:11}}/><YAxis dataKey="value" name={readable} type="number" tick={{fontSize:11}}/><Tooltip cursor={{strokeDasharray:'3 3'}}/>
      <Scatter name={readable+' by records'} data={plotted} fill={COLOR[2]}/></ScatterChart>
   :<BarChart data={plotted} margin={{top:10,right:16,bottom:32,left:2}}><CartesianGrid strokeDasharray="3 5" opacity={.13}/>
      <XAxis dataKey="name" tickFormatter={chartAxis} angle={-20} textAnchor="end" height={65} tick={{fontSize:11}}/><YAxis tick={{fontSize:11}}/>
      <Tooltip/><Bar dataKey="value" name={readable} radius={[5,5,0,0]}>{plotted.map((p,i)=><Cell key={p.name} fill={COLOR[i%COLOR.length]}/>)}</Bar></BarChart>}
  </ResponsiveContainer>
 </div>;
}
function csv(rows:AnalyticsDatum[],metric:string){
 const cols=['dataset','id','category','variant','stage','status','month','source',metric];
 const escape=(value:unknown)=>{let s=String(value??'');if(/^[=+@-]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
 const lines=[cols.map(escape).join(',')];
 for(const row of rows)lines.push([row.dataset,row.id,row.category,row.variant,row.stage,row.status,row.month??'',row.source,row.metrics[metric]??''].map(escape).join(','));
 const url=URL.createObjectURL(new Blob([lines.join('\n')],{type:'text/csv;charset=utf-8'}));
 const a=document.createElement('a');a.href=url;a.download='vyndi-analytics-sourced.csv';a.click();URL.revokeObjectURL(url);
}
function AnalyticsStudio(){
 const {lineage,report,approvedPlan,actuals,supply}=Route.useLoaderData();
 const router=useRouter();
 const [scope,setScope]=useState<'vyndi'|'group'>('vyndi');
 const [dataset,setDataset]=useState('flow');
 const [variant,setVariant]=useState('');
 const [status,setStatus]=useState('');
 const [from,setFrom]=useState(1),[to,setTo]=useState(36);
 const [dimension,setDimension]=useState('stage'),[metric,setMetric]=useState('units'),[visual,setVisual]=useState<Visual>('bar');
 const [scenario,setScenario]=useState<ScenarioId>('base');
 const [financeView,setFinanceView]=useState<'revenue'|'spend'|'cash'>('revenue');
 const [demandSensitivity,setDemandSensitivity]=useState(100);
 const [costSensitivity,setCostSensitivity]=useState(0);
 const rows=useMemo(()=>buildAnalyticsRows({lineage,report,actuals,supply}),[lineage,report,actuals,supply]);
 const allDatasetRows=useMemo(()=>filterAnalyticsRows(rows,{dataset}),[rows,dataset]);
 const variants=useMemo(()=>[...new Set(allDatasetRows.map(r=>r.variant).filter(Boolean))].sort(),[allDatasetRows]);
 const statuses=useMemo(()=>[...new Set(allDatasetRows.map(r=>r.stage).filter(Boolean))].sort(),[allDatasetRows]);
 const filtered=useMemo(()=>filterAnalyticsRows(rows,{dataset,variant,status,from,to}),[rows,dataset,variant,status,from,to]);
 const metrics=useMemo(()=>getNumericMetrics(allDatasetRows),[allDatasetRows]);
 const currentMetric=metrics.includes(metric)?metric:(metrics.includes(DATASETS.find(d=>d.id===dataset)?.defaultMetric||'')?DATASETS.find(d=>d.id===dataset)!.defaultMetric:metrics[0]||'recordCount');
 const actualsByMonth=actuals as Record<number,{revenue?:number|null;cogs?:number|null;opex?:number|null;closingCash?:number|null}>;
 const projections=useMemo(()=>approvedPlan?buildModelWithInputs(scenario,approvedPlan.drawStandby,approvedPlan.finance):[],[approvedPlan,scenario]);
 const comparison=useMemo(()=>projections.filter(row=>row.m>=from&&row.m<=to).map(row=>{
   const actual=actualsByMonth[row.m];
   return {month:'M'+row.m,plannedRevenue:row.revenue,actualRevenue:actual?.revenue??null,
     whatIfRevenue:row.revenue*demandSensitivity/100,
     actualOperatingSpend:actual?.cogs!==null&&actual?.cogs!==undefined&&actual?.opex!==null&&actual?.opex!==undefined?actual.cogs+actual.opex:null,
     actualClosingCash:actual?.closingCash??null,
     plannedOperatingSpend:row.cogs+row.opex,
     sensitivityOperatingSpend:(row.cogs*demandSensitivity/100+row.opex)*(1+costSensitivity/100),
     plannedClosingCash:row.closing};
 }),[projections,actualsByMonth,demandSensitivity,costSensitivity,from,to]);
 const kpi=useMemo(()=>({orders:lineage.length,units:lineage.reduce((v,r)=>v+Number(r.units||0),0),
   jobCards:lineage.filter(r=>Boolean(r.jobCardId)).length,shortage:lineage.reduce((v,r)=>v+Number(r.shortageLines||0),0),
   ordersLinked:lineage.reduce((v,r)=>v+Number(r.purchaseOrderCount||0),0),
   invoices:lineage.reduce((v,r)=>v+Number(r.invoiceCount||0),0),grn:lineage.reduce((v,r)=>v+Number(r.goodsReceiptCount||0),0)}),[lineage]);
 const incompleteGroup=scope==='group';
 const datasetCoverage=(supply.coverage as Record<string,string>)[dataset];
 const qualifiedSource=datasetCoverage!=='HOLD';
 const totalDemand=supply.coverage.demand==='PASS'?supply.records.demand.length:null;
 const totalJobCards=supply.coverage.jobCards==='PASS'?supply.records.jobCards.length:null;
 const totalPOs=supply.coverage.purchaseOrders==='PASS'?supply.records.purchaseOrders.length:null;
 const totalSalesInvoices=supply.coverage.salesInvoices==='PASS'?supply.records.salesInvoices.length:null;
 const details=DATASETS.find(x=>x.id===dataset);
 const dataCount=allDatasetRows.length;
 const totalSelected=filtered.filter(r=>Object.hasOwn(r.metrics,currentMetric)).reduce((n,r)=>n+r.metrics[currentMetric],0);
 const showKanban=visual==='kanban';
 return <div className="min-w-0 space-y-5 pb-12">
   <section className="relative overflow-hidden rounded-3xl border border-border bg-gradient-to-br from-surface via-surface to-accent/10 p-5 shadow-md sm:p-7">
     <div className="absolute -right-20 -top-24 size-72 rounded-full bg-accent/10 blur-3xl" aria-hidden="true"/>
     <div className="relative flex flex-wrap items-start justify-between gap-4">
       <div className="max-w-3xl"><div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[.18em] text-green"><Activity size={16}/> Vāyū Shastr · Intelligence and analytics</div>
         <h1 className="mt-2 font-display text-3xl font-semibold text-accent sm:text-4xl">Enterprise Analytics Studio</h1>
         <p className="mt-2 text-sm leading-6 text-muted">Live read-only source reports · selectable metrics · Kanban · Pareto · scenarios · interactive charts · audit-aware planning.</p>
       </div>
       <div className="flex flex-wrap gap-2">
         <button type="button" onClick={()=>{void router.invalidate()}} className="inline-flex items-center gap-2 rounded-xl border border-border bg-bg px-3 py-2 text-xs text-fg"><RefreshCw size={15}/> Refresh</button>
         <button type="button" onClick={()=>csv(filtered,currentMetric)} className="inline-flex items-center gap-2 rounded-xl bg-accent px-3 py-2 text-xs font-bold text-accent-fg"><Download size={15}/> Export CSV</button>
       </div>
     </div>
     <div className="mt-4 flex flex-wrap gap-2">
       <button type="button" onClick={()=>setScope('vyndi')} aria-pressed={scope==='vyndi'} className={'rounded-lg border px-3 py-2 text-xs font-semibold '+(scope==='vyndi'?'border-accent bg-accent/15 text-accent':'border-border text-muted')}>VYNDI OS</button>
       <button type="button" onClick={()=>setScope('group')} aria-pressed={scope==='group'} className={'rounded-lg border px-3 py-2 text-xs font-semibold '+(scope==='group'?'border-accent bg-accent/15 text-accent':'border-border text-muted')}>Vāyū Shastr Group</button>
       <span className="rounded-lg border border-border px-3 py-2 text-xs text-muted">Sources: VYNDI canonical data · Plan: {approvedPlan?'Approved R'+approvedPlan.revision:'No approved baseline'}</span>
     </div>
     {incompleteGroup&&<div role="status" className="mt-4 rounded-xl border border-warn/40 bg-warn/10 p-3 text-sm text-fg">Group consolidation is PARTIAL. Only VYNDI OS is currently a qualified source in this board; other Vāyū Shastr group entities are not yet connected. These figures must not be represented as consolidated group totals.</div>}
   </section>

   <section aria-label="Key operating indicators" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
     <Stat label="Committed demand" value={number(kpi.units)+' units'} hint={(totalDemand===null?number(kpi.orders)+' committed linked orders':number(totalDemand)+' total sales orders · '+number(kpi.orders)+' committed linked')}/>
     <Stat label="Production job cards" value={number(totalJobCards??kpi.jobCards)} hint={totalJobCards===null?'Order-linked job cards only':'All persisted job cards'}/>
     <Stat label="Material shortage lines" value={number(kpi.shortage)} hint="Across committed job requirements"/>
     <Stat label="Supply chain execution" value={number(totalPOs??kpi.ordersLinked)+' POs'} hint={(totalPOs===null?'Linked only · ':'All orders · ')+kpi.grn+' linked receipts · '+(totalSalesInvoices===null?kpi.invoices+' linked invoices':totalSalesInvoices+' sales invoices')}/>
   </section>

   <section className={card+' p-4 sm:p-5'} aria-label="Analytics variable selectors">
     <div className="mb-4 flex items-center gap-2"><Layers3 className="text-accent" size={18}/><h2 className="text-lg font-semibold text-fg">Explore variables</h2><span className="ml-auto text-xs text-muted">{number(filtered.length)} of {number(dataCount)} records</span></div>
     <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
       <Filter label="Business dataset"><select aria-label="Business dataset" className={control} value={dataset} onChange={e=>{const next=e.target.value;setDataset(next);setVariant('');setStatus('');setMetric(DATASETS.find(d=>d.id===next)?.defaultMetric||'recordCount');setDimension(next==='flow'?'stage':'category');}}>
          {DATASETS.map(d=><option key={d.id} value={d.id}>{d.label}</option>)}</select></Filter>
       <Filter label="Measure (Y)"><select aria-label="Measure" className={control} value={currentMetric} onChange={e=>setMetric(e.target.value)}>
          {metrics.map(x=><option key={x} value={x}>{pretty(x)}</option>)}</select></Filter>
       <Filter label="Dimension (X)"><select aria-label="Dimension" className={control} value={dimension} onChange={e=>setDimension(e.target.value)}>
          {DIMENSIONS.map(x=><option key={x} value={x}>{pretty(x)}</option>)}</select></Filter>
       <Filter label="Variant"><select aria-label="Variant" className={control} value={variant} onChange={e=>setVariant(e.target.value)}>
          <option value="">All variants</option>{variants.map(x=><option key={x} value={x}>{x}</option>)}</select></Filter>
       <Filter label="Status"><select aria-label="Status" className={control} value={status} onChange={e=>setStatus(e.target.value)}>
          <option value="">All statuses</option>{statuses.map(x=><option key={x} value={x}>{x}</option>)}</select></Filter>
       <Filter label="Period start"><select aria-label="Period start" className={control} value={from} onChange={e=>setFrom(Math.min(Number(e.target.value),to))}>
          {Array.from({length:36},(_,i)=><option key={i} value={i+1}>M{i+1}</option>)}</select></Filter>
       <Filter label="Period end"><select aria-label="Period end" className={control} value={to} onChange={e=>setTo(Math.max(Number(e.target.value),from))}>
          {Array.from({length:36},(_,i)=><option key={i} value={i+1}>M{i+1}</option>)}</select></Filter>
       <div className="flex items-end"><button type="button" onClick={()=>{setVariant('');setStatus('');setFrom(1);setTo(36);}} className="w-full rounded-xl border border-border px-4 py-2 text-sm text-muted hover:text-fg">Reset filters</button></div>
     </div>
     <p className="mt-3 text-xs text-subtle">Source: {details?.source}. Readback: {datasetCoverage||'Existing ERP report'}. Month filters apply to dated records; undated records remain visible and explicitly marked as unassigned.</p>
   </section>

   <section className={card+' p-4 sm:p-5'}>
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div><p className="text-[10px] uppercase tracking-[.16em] text-green">Interactive statistical board</p><h2 className="mt-1 text-lg font-semibold text-fg">{pretty(currentMetric)} by {pretty(dimension)}</h2>
        <p className="text-xs text-muted">Sourced records: {number(filtered.length)} · Selected metric total: {number(totalSelected)} · No estimated data in actual observations.</p></div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Visualization">
        {VISUALS.map(v=><button key={v.id} type="button" aria-pressed={visual===v.id} onClick={()=>setVisual(v.id)} className={'rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition '+(visual===v.id?'border-accent bg-accent/15 text-accent':'border-border bg-bg text-muted hover:text-fg')}>{v.label}</button>)}
      </div>
    </div>
    {!qualifiedSource?<Empty text="Canonical source read is on HOLD; no numerical conclusion can be drawn for this dataset."/>:<ChartSurface rows={filtered} metric={currentMetric} dimension={dimension} visual={showKanban?'kanban':visual}/>} 
    {visual==='pareto'&&<p className="mt-2 text-xs text-muted">Cumulative share is calculated from nonnegative category totals. The 80% reference identifies the most influential contributors.</p>}
   </section>

   <div className="grid gap-4 xl:grid-cols-2">
     <section className={card+' p-4 sm:p-5'}><h2 className="text-lg font-semibold text-fg">Material shortage Pareto</h2><p className="mt-1 text-xs text-muted">Based on committed orders and recorded shortage lines, grouped by variant.</p>
       <ChartSurface rows={filterAnalyticsRows(rows,{dataset:'flow',from,to})} metric="shortageLines" dimension="variant" visual="pareto"/></section>
     <section className={card+' p-4 sm:p-5'}><h2 className="text-lg font-semibold text-fg">Inventory health distribution</h2><p className="mt-1 text-xs text-muted">Canonical minimum-stock-level health categories; number of SKU records, not quantity of stock.</p>
       <ChartSurface rows={filterAnalyticsRows(rows,{dataset:'inventory'})} metric="recordCount" dimension="status" visual="pie"/></section>
   </div>

   <section className={card+' p-4 sm:p-5'}>
     <div className="flex flex-wrap items-center justify-between gap-3"><div><div className="flex items-center gap-2"><TrendingUp size={18} className="text-accent"/><h2 className="text-lg font-semibold text-fg">Forecast, planning and budget sensitivity</h2></div>
       <p className="mt-1 text-xs text-muted">Existing 36-month approved VYNDI operating-plan model. Scenario and sensitivity sliders are illustrative, read-only and never revise the approved plan.</p></div>
       <Link to="/command/financial-cockpit" className="inline-flex items-center gap-1 text-xs font-semibold text-accent">Finance authority <ExternalLink size={14}/></Link>
     </div>
     {approvedPlan?<>
       <div className="mt-4 grid gap-3 sm:grid-cols-3">
         <Filter label="Plan scenario"><select className={control} aria-label="Plan scenario" value={scenario} onChange={e=>setScenario(e.target.value as ScenarioId)}>
           <option value="base">Base</option><option value="delayed">Delayed</option><option value="stress">Stress</option></select></Filter>
         <Filter label={'Demand sensitivity · '+demandSensitivity+'%'}><input className="h-10 w-full accent-orange-500" aria-label="Demand sensitivity" type="range" min="70" max="130" step="5" value={demandSensitivity} onChange={e=>setDemandSensitivity(Number(e.target.value))}/></Filter>
         <Filter label={'Operating cost sensitivity · +'+costSensitivity+'%'}><input className="h-10 w-full accent-orange-500" aria-label="Operating cost sensitivity" type="range" min="0" max="25" step="5" value={costSensitivity} onChange={e=>setCostSensitivity(Number(e.target.value))}/></Filter>
       </div>
       <div className="mt-4 grid gap-3 sm:grid-cols-3"><Stat label="Scenario revenue" value={currency(comparison.reduce((n,r)=>n+r.plannedRevenue,0))} hint={scenario+' plan · selected months'}/>
          <Stat label="Modeled operating spend" value={currency(comparison.reduce((n,r)=>n+r.plannedOperatingSpend,0))} hint="COGS + Opex · not posted actual"/>
          <Stat label="Illustrative adjusted revenue" value={currency(comparison.reduce((n,r)=>n+r.whatIfRevenue,0))} hint="Demand sensitivity, not an approved forecast"/></div>
       <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Financial metric view">
       {([{id:'revenue',label:'Revenue vs actual'},{id:'spend',label:'Budget vs actual spend'},{id:'cash',label:'Cash trajectory'}] as const).map(v=><button type="button" key={v.id} aria-pressed={financeView===v.id} onClick={()=>setFinanceView(v.id)} className={'rounded-lg border px-3 py-2 text-xs font-semibold '+(financeView===v.id?'border-accent bg-accent/15 text-accent':'border-border text-muted')}>{v.label}</button>)}
     </div>
     <div className="mt-4 h-[330px] w-full"><ResponsiveContainer width="100%" height="100%">
        <LineChart data={comparison} margin={{top:10,right:15,left:2,bottom:5}}>
          <CartesianGrid strokeDasharray="3 5" opacity={.15}/><XAxis dataKey="month" tick={{fontSize:10}}/><YAxis tick={{fontSize:10}}/><Tooltip formatter={(v)=>v===null?'Unavailable':currency(Number(v))}/>
          <Legend/>{financeView==='revenue'?<>
            <Line type="monotone" dataKey="plannedRevenue" name="Approved plan revenue ₹L" stroke={COLOR[0]} strokeWidth={2} dot={false}/>
            <Line type="monotone" dataKey="actualRevenue" name="Recorded actual revenue ₹L" stroke={COLOR[1]} strokeWidth={3} connectNulls={false}/>
            <Line type="monotone" dataKey="whatIfRevenue" name="Illustrative demand what-if ₹L" stroke={COLOR[2]} strokeDasharray="5 4" dot={false}/>
          </>:financeView==='spend'?<>
            <Line type="monotone" dataKey="plannedOperatingSpend" name="Plan COGS + Opex ₹L" stroke={COLOR[0]} strokeWidth={2} dot={false}/>
            <Line type="monotone" dataKey="actualOperatingSpend" name="Recorded actual COGS + Opex ₹L" stroke={COLOR[1]} strokeWidth={3} connectNulls={false}/>
            <Line type="monotone" dataKey="sensitivityOperatingSpend" name="Illustrative cost what-if ₹L" stroke={COLOR[2]} strokeDasharray="5 4" dot={false}/>
          </>:<>
            <Line type="monotone" dataKey="plannedClosingCash" name="Scenario modeled cash ₹L" stroke={COLOR[0]} strokeWidth={2} dot={false}/>
            <Line type="monotone" dataKey="actualClosingCash" name="Recorded closing cash ₹L" stroke={COLOR[1]} strokeWidth={3} connectNulls={false}/>
          </>}
        </LineChart></ResponsiveContainer></div>
       <p className="mt-2 text-xs text-muted">Approved operating plan revision {approvedPlan.revision}. Financial actuals appear only for recorded months. Demand slider scales modeled revenue only; cost slider changes the illustrative spend calculation, not canonical cash or engineering BOM.</p>
     </>:<Empty text="Forecast unavailable: an approved Integrated Operating Plan has not been established. No simulated revenue or budget is shown as actual."/>}
   </section>

   <section className={card+' p-4 sm:p-5'}>
     <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-semibold text-fg">Demand → job card → supply order → invoice</h2><Link to="/command/control-tower" className="inline-flex items-center gap-1 text-xs text-accent">ERP Control Tower <ExternalLink size={13}/></Link></div>
     <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
     {[
       ['01 · Demand','/command/sales',kpi.orders+' orders'],
       ['02 · Job cards','/command/production',kpi.jobCards+' job cards'],
       ['03 · Purchase & GRN','/command/purchase-execution',kpi.ordersLinked+' POs · '+kpi.grn+' receipts'],
       ['04 · Invoice','/command/receivables',kpi.invoices+' invoices'],
     ].map(([label,to,value])=><Link key={to} to={to as never} className="rounded-xl border border-border bg-bg p-4 transition hover:border-accent">
       <p className="text-xs text-muted">{label}</p><p className="mt-2 text-base font-semibold text-fg">{value}</p><p className="mt-2 text-xs text-accent">Open governed workspace →</p>
     </Link>)}</div>
     <p className="mt-3 text-xs text-muted">Order-lineage totals reflect linked canonical records, not all unlinked company-wide purchases, invoices or budgets. Drill into each authoritative workspace for full reconciliation.</p>
   </section>
   <section className={card+' p-4 sm:p-5'}>
     <div className="mb-3 flex items-center gap-2"><BarChart3 size={18} className="text-accent"/><h2 className="text-lg font-semibold text-fg">Selected evidence records</h2></div>
     {filtered.length?<div className="max-h-[370px] overflow-auto rounded-xl border border-border">
       <table className="w-full text-left text-xs"><thead className="sticky top-0 bg-surface text-muted"><tr>{['Record','Category','Status / stage','Month',pretty(currentMetric),'Authority'].map(x=><th key={x} className="p-3 font-semibold">{x}</th>)}</tr></thead>
         <tbody>{filtered.slice(0,100).map(row=><tr key={row.id} className="border-t border-border/50 text-fg"><td className="p-3">{row.id}</td><td className="p-3">{row.category}</td><td className="p-3">{row.stage}</td><td className="p-3">{row.month===null?'Unassigned':'M'+row.month}</td><td className="p-3 tabular-nums">{Object.hasOwn(row.metrics,currentMetric)?number(row.metrics[currentMetric]):'—'}</td><td className="p-3 text-muted">{row.source}</td></tr>)}</tbody>
       </table></div>:<Empty text="No matching authorized records."/>}
     {filtered.length>100&&<p className="mt-2 text-xs text-muted">Showing 100 of {number(filtered.length)}. CSV export includes all selected source observations.</p>}
   </section>
   <div className="flex items-start gap-2 rounded-xl border border-border bg-surface/40 p-4 text-xs leading-5 text-muted"><CheckCircle2 size={17} className="shrink-0 text-green"/>
   <span>Read-only analysis. Source systems retain sole business authority. Kanban stages are summaries derived from persisted linked records, not manual workflow state. Forecast sensitivity is advisory; no new purchase order, production release, ledger posting or approval is generated.</span></div>
 </div>;
}
