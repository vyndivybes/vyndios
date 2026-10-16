import {createServerFn} from '@tanstack/react-start';
import {z} from 'zod';
import {requireBusinessActor} from './business-actor';
import {getSql} from './db';
import {listStoredDashboards,openStoredDashboard,saveStoredDashboard} from './dashboard-store';
import {readEnterpriseBi,VYNDI_BI_DEPARTMENTS} from './vaos-enterprise-bi-read';
import {definitionSchema,authorizeDashboard,allowed} from './dashboard-policy';

export const readDashboardEvidence=createServerFn({method:'POST'}).validator(definitionSchema).handler(async({data})=>{
 const actor=await requireBusinessActor('view');
 // The client defaults to all departments. Filter before touching any source.
 const permitted=data.agents.filter(id=>allowed(actor.role,id));
 if(!permitted.length)throw Error('No permitted sources.');
 const d=authorizeDashboard(actor.role,{...data,agents:permitted});const sql=await getSql();
 const packets=[];for(const employeeId of d.agents)packets.push(await readEnterpriseBi(sql,{...d,employeeId,limit:5,offset:0},{primaryOnly:true,crm:d.metric==='crm'}));
 // Explicit JSON transport prevents unknown source field values crossing the
 // server-function serialization boundary as unvalidated class instances.
 return {packet:JSON.stringify({enterprise:{...packets[0],scope:'permitted',departments:packets.flatMap(p=>p.departments)},workforce:null}),permittedAgents:permitted,allowedAgents:Object.keys(VYNDI_BI_DEPARTMENTS).filter(id=>allowed(actor.role,id))};
});
const uuid=z.string().uuid();
export const listDashboards=createServerFn({method:'GET'}).handler(async()=>{
 const actor=await requireBusinessActor('view');return listStoredDashboards(await getSql(),actor);
});
export const openDashboard=createServerFn({method:'GET'}).validator(z.object({id:uuid})).handler(async({data})=>{
 const actor=await requireBusinessActor('view');return openStoredDashboard(await getSql(),actor,data.id);
});
export const saveDashboard=createServerFn({method:'POST'}).validator(z.object({id:uuid.nullable(),revision:z.number().int().min(0),visibility:z.enum(['private','authorized']),definition:definitionSchema}).strict()).handler(async({data})=>{
 const actor=await requireBusinessActor('edit');return saveStoredDashboard(await getSql(),actor,data);
});
