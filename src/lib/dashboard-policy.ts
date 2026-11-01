import {z} from 'zod';
import {canAccessRoute,type CommandRole} from './page-access.ts';
import {VYNDI_BI_DEPARTMENTS,biToday} from './vaos-enterprise-bi-read.ts';
const ids=Object.keys(VYNDI_BI_DEPARTMENTS);
export const definitionSchema=z.object({version:z.literal(1),title:z.string().trim().min(1).max(120),metric:z.enum(['activity','backlog','statuses','crm']),chart:z.enum(['bar','table']),agents:z.array(z.string().refine(x=>ids.includes(x))).min(1).max(16),from:z.string().date(),to:z.string().date()}).strict();
const routes:Record<string,string>={orchestrator:'governance',project:'planning',vibpe:'engineering',risk:'risk',knowledge:'engineering',release:'quality',qa:'quality',commercial:'sales',procurement:'purchase-execution',inventory:'inventory',production:'production',maintenance:'operations',finance:'financial-cockpit',people:'people-office','engineering-configuration':'engineering',security:'users'};
export function allowed(role:CommandRole,id:string){return canAccessRoute(role,'/command/'+routes[id]);}
export function authorizeDashboard(role:CommandRole,value:unknown){
 const d=definitionSchema.parse(value);
 if(d.from>d.to||d.to>biToday()||Date.parse(d.to)-Date.parse(d.from)>366*86400000||new Set(d.agents).size!==d.agents.length)throw Error('Invalid dashboard period or repeated department.');
 if(d.agents.some(id=>!allowed(role,id)))throw Error('Dashboard contains a department outside your current permissions.');
 return d;
}
