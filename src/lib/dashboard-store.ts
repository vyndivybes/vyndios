import type {Sql} from './db.ts';
import type {z} from 'zod';
import {authorizeDashboard,definitionSchema} from './dashboard-policy.ts';
import type {CommandRole} from './page-access.ts';
type Actor={userId:string;role:CommandRole};
export async function listStoredDashboards(sql:Sql,actor:Actor){
 const rows=await sql.query<{id:string;title:string;definition:unknown}>(`select id,definition->>'title' as title,definition from vyndi_private.bi_dashboards where owner_id=$1 or visibility='authorized' order by updated_at desc limit 100`,[actor.userId]);
 return rows.filter(r=>{try{authorizeDashboard(actor.role,r.definition);return true;}catch{return false;}}).map(({id,title})=>({id,title}));
}
export async function openStoredDashboard(sql:Sql,actor:Actor,id:string){
 const [row]=await sql.query<{id:string;revision:number;visibility:'private'|'authorized';definition:unknown}>(`select id,revision,visibility,definition from vyndi_private.bi_dashboards where id=$1 and (owner_id=$2 or visibility='authorized')`,[id,actor.userId]);
 if(!row)throw Error('Dashboard unavailable or access denied.');return {...row,definition:authorizeDashboard(actor.role,row.definition)};
}
export async function saveStoredDashboard(sql:Sql,actor:Actor,data:{id:string|null;revision:number;visibility:'private'|'authorized';definition:z.infer<typeof definitionSchema>}){
 const d=authorizeDashboard(actor.role,data.definition),id=data.id??crypto.randomUUID();
 const [row]=await sql.query<{id:string;revision:number}>(`insert into vyndi_private.bi_dashboards(id,owner_id,visibility,definition) values($1,$2,$3,$4::jsonb) on conflict(id) do update set definition=excluded.definition,visibility=excluded.visibility,revision=bi_dashboards.revision+1,updated_at=now() where bi_dashboards.owner_id=$2 and bi_dashboards.revision=$5 returning id,revision`,[id,actor.userId,data.visibility,JSON.stringify(d),data.revision]);
 if(!row)throw Error('Save conflict or owner permission denied. Reopen the dashboard.');return row;
}
