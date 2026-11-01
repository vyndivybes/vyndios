import {useEffect,useRef} from 'react';
import {readDashboardEvidence,listDashboards,openDashboard,saveDashboard} from '@/lib/dashboard-authority';

export function BusinessIntelligenceStudio(){
 const host=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  let stop:(()=>void)|undefined,cancelled=false;
  const path='/bi-studio.mjs';
  import(/* @vite-ignore */path).then(({mountBiStudio})=>{
   if(cancelled||!host.current)return;
   stop=mountBiStudio(host.current,{
    supportsAgents:false,
    read:async(definition:Record<string,unknown>)=>{
     if(definition.metric==='agents')throw Error('Verified agent closures are available in VAOS Intelligence, using its existing workforce permissions.');
     const response=await readDashboardEvidence({data:definition as never});
     return {...JSON.parse(response.packet),permittedAgents:response.permittedAgents,allowedAgents:response.allowedAgents};
    },list:()=>listDashboards(),open:(id:string)=>openDashboard({data:{id}}),save:(data:unknown)=>saveDashboard({data:data as never}),
   });
  }).catch(()=>{if(host.current)host.current.textContent='Business intelligence could not load. Refresh to retry.';});
  return()=>{cancelled=true;stop?.();};
 },[]);
 return <div id="business-intelligence"><link rel="stylesheet" href="/bi-studio.css"/><div ref={host}/></div>;
}
