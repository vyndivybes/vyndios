import {useState} from 'react';
import {Bar,BarChart,CartesianGrid,ResponsiveContainer,XAxis,YAxis,Tooltip,Pie,PieChart,Cell,ComposedChart,Line,ReferenceLine} from 'recharts';
import {Building2,ShieldAlert,CheckCircle2,ExternalLink} from 'lucide-react';
import {Link} from '@tanstack/react-router';
import {GROUP_SOURCE_KINDS,GROUP_UNITS,type GroupUnitId,type GroupSourceKind} from '@/lib/group-consolidation';
import {
 getGroupPortfolio,listPendingGroupAttributions,proposeGroupAttribution,decideGroupAttribution,
} from '@/lib/group-consolidation-authority';

type Snapshot=Awaited<ReturnType<typeof getGroupPortfolio>>;
const palette=['#F9AB55','#97CB8A','#5BA6DD','#D78CD8','#ECC86F','#75C7BB'];
const measures={
 orders:'Sales orders',units:'Ordered product units',jobCards:'Manufacturing job cards',
 purchaseOrders:'Supplier purchase orders',salesInvoices:'Customer invoices',
 supplierInvoices:'Supplier invoices',crmCustomers:'CRM customer records',
 peopleRecords:'People / HR records',
} as const;
type Measure=keyof typeof measures;
const sources:Record<Measure,GroupSourceKind>={
 orders:'sales_order',units:'sales_order',jobCards:'job_card',purchaseOrders:'purchase_order',
 salesInvoices:'sales_invoice',supplierInvoices:'supplier_invoice',
 crmCustomers:'crm_customer',peopleRecords:'people_record',
};
const format=(x:number)=>x.toLocaleString('en-IN',{maximumFractionDigits:2});
const box='rounded-2xl border border-border bg-surface/60 p-4 shadow-sm';
export function GroupPortfolio({snapshot}:{snapshot:Snapshot}){
 const [unit,setUnit]=useState<GroupUnitId|null>(null);
 const [measure,setMeasure]=useState<Measure>('orders');
 const [mode,setMode]=useState<'bar'|'pie'|'pareto'>('bar');
 const [governance,setGovernance]=useState(false);
 const key=sources[measure],sourceReady=snapshot.sourceCoverage[key]==='PASS';
 const selected=unit?snapshot.divisions.find(x=>x.id===unit):null;
 const measured=snapshot.divisions.map(x=>({name:x.name,value:x[measure],id:x.id})); 
 const sorted=[...measured].sort((a,b)=>b.value-a.value);
 const total=sorted.reduce((x,y)=>x+y.value,0),ranked=sorted.reduce<Array<{name:string;value:number;cumulative:number}>>((all,x)=>{
  const previous=all.at(-1)?.cumulative||0;all.push({name:x.name,value:x.value,cumulative:previous+(total>0?x.value/total*100:0)});return all;
 },[]);
 return <section className="space-y-5" aria-label="Group portfolio management consolidation">
   <div className={box+' border-amber-500/40'}>
     <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="flex items-center gap-2 text-lg font-semibold text-fg"><Building2 size={18} className="text-accent"/> Vāyú Shastr · Six-division management portfolio</h2>
       <span className="rounded-full border border-border px-3 py-1 text-xs font-semibold text-fg">{snapshot.groupStatus}</span>
     </div>
     <p className="mt-3 text-sm leading-6 text-fg">This is a <strong>management-unit view</strong>, not a consolidated financial statement. VYNDI OS retains the authoritative business data. Records appear in a division only when they have independently approved cost-centre attribution.</p>
     <p className="mt-2 text-xs leading-5 text-muted">Business divisions are not separate incorporated companies. No revenue, cash, expenditure or profit is claimed at group level without source-ledger coverage and approved internal-transfer eliminations.</p>
     <div className="mt-4 grid gap-3 sm:grid-cols-3">
       <div className="rounded-xl border border-border bg-bg/60 p-4"><p className="text-xs uppercase tracking-wide text-muted">Division count</p><strong className="mt-2 block text-2xl text-fg">6</strong><p className="text-xs text-muted">Management units, not legal entities</p></div>
       <div className="rounded-xl border border-border bg-bg/60 p-4"><p className="text-xs uppercase tracking-wide text-muted">Source coverage</p><strong className="mt-2 block text-2xl text-fg">{Object.values(snapshot.sourceCoverage).filter(x=>x==='PASS').length} / {GROUP_SOURCE_KINDS.length}</strong><p className="text-xs text-muted">VYNDI ERP source families readable</p></div>
       <div className="rounded-xl border border-border bg-bg/60 p-4"><p className="text-xs uppercase tracking-wide text-muted">Group financial totals</p><strong className="mt-2 block text-2xl text-fg">HOLD</strong><p className="text-xs text-muted">Requires journal attribution and internal eliminations</p></div>
     </div>
     {snapshot.sourceCoverage.sales_order==='PASS'&&<p className="mt-4 rounded-lg border border-border bg-bg/60 px-4 py-3 text-xs text-fg">Sales orders: <strong>{format(snapshot.totalAttributed.orders)} attributed</strong> · <strong>{format(snapshot.unattributed.orders)} unattributed</strong>. The latter are not silently counted under Carbon or any other division.</p>}
     {!snapshot.divisionAttributionComplete&&<div role="status" className="mt-3 flex gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs leading-5 text-fg"><ShieldAlert className="shrink-0" size={17}/> Division attribution remains incomplete. Unassigned or unavailable records cannot be used to certify full group consolidation.</div>}
   </div>

   <div className={box}>
     <div className="flex flex-wrap items-start justify-between gap-4"><div><h3 className="text-lg font-semibold text-fg">Compare business divisions</h3>
       <p className="mt-1 text-xs text-muted">Select a measurable source and chart. A blank division does not prove that it has no business activity.</p></div>
       <div className="flex flex-wrap gap-2">
         <select aria-label="Group measure" value={measure} onChange={e=>setMeasure(e.target.value as Measure)} className="rounded-lg border border-border bg-bg p-2 text-sm text-fg">
           {Object.entries(measures).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select>
         <select aria-label="Group chart type" value={mode} onChange={e=>setMode(e.target.value as typeof mode)} className="rounded-lg border border-border bg-bg p-2 text-sm text-fg">
           <option value="bar">Bar chart</option><option value="pie">Pie chart</option><option value="pareto">Pareto chart</option></select>
       </div>
     </div>
     {!sourceReady?<p role="status" className="mt-5 rounded-xl border border-border p-5 text-sm text-muted">HOLD: the {measures[measure]} source could not be verified. No group figure is available.</p>
     :total<=0?<p className="mt-5 rounded-xl border border-border p-5 text-sm text-muted">No approved division-attributed {measures[measure].toLowerCase()} appear in the source. This is not evidence of zero enterprise activity.</p>
     :<div className="mt-4 h-[320px] w-full" role="img" aria-label={'Division comparison for '+measures[measure]}>
       <ResponsiveContainer width="100%" height="100%">
         {mode==='pie'?<PieChart><Pie data={measured} dataKey="value" nameKey="name" innerRadius="35%" outerRadius="75%" label={({name,percent})=>String(name).slice(0,14)+' '+format((percent||0)*100)+'%'}>
           {measured.map((x,i)=><Cell key={x.id} fill={palette[i]}/>)}</Pie><Tooltip/></PieChart>
         :mode==='pareto'?<ComposedChart data={ranked} margin={{bottom:50,right:12}}>
           <CartesianGrid strokeDasharray="3 5" opacity={.18}/><XAxis dataKey="name" angle={-18} textAnchor="end" height={70} tick={{fontSize:10}}/><YAxis yAxisId="left"/><YAxis yAxisId="right" orientation="right" domain={[0,100]} unit="%"/>
           <Tooltip/><Bar yAxisId="left" dataKey="value" name={measures[measure]} fill={palette[0]}/><Line yAxisId="right" dataKey="cumulative" name="Cumulative %" stroke={palette[1]}/><ReferenceLine yAxisId="right" y={80} strokeDasharray="4 4" stroke={palette[3]}/></ComposedChart>
         :<BarChart data={measured} margin={{bottom:60,right:12}}><CartesianGrid strokeDasharray="3 5" opacity={.18}/><XAxis dataKey="name" angle={-18} textAnchor="end" height={75} tick={{fontSize:10}}/><YAxis/><Tooltip/><Bar dataKey="value" name={measures[measure]}>{measured.map((x,i)=><Cell key={x.id} fill={palette[i]}/>)}</Bar></BarChart>}
       </ResponsiveContainer></div>}
     <p className="mt-3 text-xs text-muted">Chart scope: approved attributions in VYNDI OS only. Company-wide data without assignment remain excluded. All figures are counts except “Ordered product units”; monetary data are not consolidated.</p>
   </div>

   <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
     {snapshot.divisions.map(x=><button type="button" key={x.id} onClick={()=>setUnit(unit===x.id?null:x.id)}
       aria-pressed={unit===x.id} className={'rounded-2xl border bg-surface/70 p-4 text-left transition '+(unit===x.id?'border-accent ring-1 ring-accent':'border-border hover:border-accent/50')}>
       <p className="text-sm font-semibold text-fg">{x.name}</p>
       <p className="mt-3 text-2xl font-semibold text-accent">{format(x.orders)} <span className="text-xs font-normal text-muted">assigned sales orders</span></p>
       <p className="mt-2 text-xs text-muted">{format(x.jobCards)} job cards · {format(x.purchaseOrders)} purchase orders</p>
       <p className="mt-1 text-xs text-muted">{format(x.crmCustomers)} CRM records · {format(x.peopleRecords)} HR records</p>
       <p className="mt-3 text-xs font-semibold text-accent">{unit===x.id?'Hide breakdown ↑':'Show breakdown ↓'}</p>
     </button>)}
   </div>
   {selected&&<div className={box}>
     <h3 className="text-lg font-semibold text-fg">{selected.name} · Attributed records</h3>
     <p className="mt-1 text-xs text-muted">Division drill-down uses approved source assignments; no customer or employee identifiers are disclosed.</p>
     <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{Object.entries(measures).map(([metric,label])=>{
       const kind=sources[metric as Measure];
       return <div key={metric} className="rounded-lg border border-border bg-bg/60 p-3">
         <p className="text-xs text-muted">{label}</p><strong className="mt-1 block text-xl text-fg">{snapshot.sourceCoverage[kind]==='PASS'?format(selected[metric as Measure]):'HOLD'}</strong>
       </div>;
     })}</div>
     <div className="mt-4 flex flex-wrap gap-4 text-xs"><Link to="/command/sales" className="text-accent">CRM / sales <ExternalLink size={12} className="inline"/></Link>
       <Link to="/command/people-office" className="text-accent">HR / workforce <ExternalLink size={12} className="inline"/></Link>
       <Link to="/command/control-tower" className="text-accent">Supply chain / production <ExternalLink size={12} className="inline"/></Link></div>
   </div>}
   <div className={box}>
     <h3 className="flex items-center gap-2 text-lg font-semibold text-fg"><ShieldAlert size={18}/> Group consolidation qualification</h3>
     <p className="mt-2 text-sm text-muted">A complete group view requires separately approved attribution for material, customer, HR, project and financial records; controlled shared-cost allocation; and evidence-backed elimination of internal transfers. Existing customer and workforce totals remain available in the separate VYNDI OS view.</p>
     <div className="mt-3 grid gap-3 md:grid-cols-2">
       <div className="rounded-xl border border-border bg-bg/60 p-3 text-xs text-muted"><strong className="text-fg">Source and attribution gaps</strong>
         <div className="mt-2 max-h-44 overflow-auto space-y-1">{snapshot.coverage.holds.length?snapshot.coverage.holds.map((h,i)=><p key={i}>{h}</p>):<p>Seven VYNDI source families are readable and attribution gaps are zero. External division data still require independent connection.</p>}</div></div>
       <div className="rounded-xl border border-border bg-bg/60 p-3 text-xs text-muted"><strong className="text-fg">Formal group totals</strong>
         <p className="mt-2">Revenue, costs, cash, profit and six-month forecasts: <strong>HOLD</strong>. Existing VYNDI forecasts are not divided among businesses without authoritative unit budgets and transfer eliminations.</p>
         <p className="mt-2">Internal transfer duplicates cannot be removed based on matching amounts alone; independent source references and approval are required.</p></div>
     </div>
     <button type="button" aria-expanded={governance} onClick={()=>setGovernance(x=>!x)} className="mt-4 rounded-lg border border-border px-4 py-2 text-sm font-semibold text-accent">{governance?'Close assignment controls':'Open governed division attribution controls'}</button>
     {governance&&<GroupAttributionControls/>}
   </div>
 </section>;
}

function GroupAttributionControls(){
 const [kind,setKind]=useState<GroupSourceKind>('sales_order');
 const [sourceId,setSourceId]=useState(''),[division,setDivision]=useState<GroupUnitId>('carbon');
 const [costCenter,setCostCenter]=useState('GENERAL'),[evidence,setEvidence]=useState('');
 const [pending,setPending]=useState<Awaited<ReturnType<typeof listPendingGroupAttributions>>>([]);
 const [note,setNote]=useState(''),[busy,setBusy]=useState(false);
 const [decisionEvidence,setDecisionEvidence]=useState('');
 const reload=async()=>{try{setPending(await listPendingGroupAttributions())}catch{setNote('Pending-review list unavailable for this role.')}};
 const submit=async()=>{
  setBusy(true);setNote('');
  try{const r=await proposeGroupAttribution({data:{sourceKind:kind,sourceId,divisionId:division,costCenter,evidenceRef:evidence}});
   setNote(r.id+' proposed. Separate checker approval is mandatory before it appears in totals.');
   setSourceId('');setEvidence('');await reload();
  }catch(e){setNote(e instanceof Error?e.message:'Attribution proposal HOLD');}finally{setBusy(false);}
 };
 const decide=async(id:string,decision:'approved'|'rejected')=>{
  setBusy(true);setNote('');
  try{await decideGroupAttribution({data:{id,decision,evidenceRef:decisionEvidence}});
   setNote('Decision persisted with separate checker audit evidence. Refresh the dashboard to re-read division totals.');
   setDecisionEvidence('');await reload();
  }catch(e){setNote(e instanceof Error?e.message:'Checker decision HOLD');}finally{setBusy(false);}
 };
 return <div className="mt-4 rounded-xl border border-border bg-bg/40 p-4">
   <p className="text-sm font-semibold text-fg">Attribution request · maker/checker required</p>
   <p className="mt-2 text-xs text-muted">Map existing source records to a management division without changing the ERP transactions. You must provide independent evidence and a different approving operator; pending requests never affect reported group metrics.</p>
   <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
     <label className="text-xs text-muted">Source type<select aria-label="Attribution source type" value={kind} onChange={e=>setKind(e.target.value as GroupSourceKind)} className="mt-1 w-full rounded-lg border border-border bg-bg p-2 text-fg">{GROUP_SOURCE_KINDS.map(x=><option key={x} value={x}>{x.replaceAll('_',' ')}</option>)}</select></label>
     <label className="text-xs text-muted">Source record ID<input aria-label="Attribution source ID" value={sourceId} onChange={e=>setSourceId(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-bg p-2 text-fg"/></label>
     <label className="text-xs text-muted">Division<select aria-label="Attribution division" value={division} onChange={e=>setDivision(e.target.value as GroupUnitId)} className="mt-1 w-full rounded-lg border border-border bg-bg p-2 text-fg">{GROUP_UNITS.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
     <label className="text-xs text-muted">Cost centre<input aria-label="Attribution cost center" value={costCenter} onChange={e=>setCostCenter(e.target.value.toUpperCase())} className="mt-1 w-full rounded-lg border border-border bg-bg p-2 text-fg"/></label>
     <label className="text-xs text-muted xl:col-span-2">Evidence reference<input aria-label="Attribution evidence" value={evidence} onChange={e=>setEvidence(e.target.value)} placeholder="Signed source reference / business rationale" className="mt-1 w-full rounded-lg border border-border bg-bg p-2 text-fg"/></label>
   </div>
   <div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={busy||!sourceId.trim()||evidence.trim().length<5} onClick={()=>void submit()} className="rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-bg disabled:opacity-40">Submit for independent approval</button>
     <button type="button" onClick={()=>void reload()} disabled={busy} className="rounded-lg border border-border px-3 py-2 text-xs text-fg">Load pending proposals</button></div>
   {note&&<p role="status" className="mt-3 text-xs text-fg">{note}</p>}
   {pending.length>0&&<div className="mt-4 space-y-2"><label className="block text-xs text-muted">Separate checker evidence<input aria-label="Checker evidence" value={decisionEvidence} onChange={e=>setDecisionEvidence(e.target.value)} placeholder="Independent approval evidence" className="mt-1 w-full rounded-lg border border-border bg-bg p-2 text-fg"/></label>
     {pending.map(row=><div key={row.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3 text-xs text-fg">
       <div>{row.source_kind} · {row.source_id} → {row.division_id} / {row.cost_center}</div>
       <div className="flex gap-2"><button disabled={busy||decisionEvidence.trim().length<5} onClick={()=>void decide(row.id,'approved')} className="text-green disabled:opacity-40">Approve</button><button disabled={busy||decisionEvidence.trim().length<5} onClick={()=>void decide(row.id,'rejected')} className="text-red-500 disabled:opacity-40">Reject</button></div>
     </div>)}</div>}
 </div>;
}
