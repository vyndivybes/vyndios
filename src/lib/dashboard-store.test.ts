import test from 'node:test';import assert from 'node:assert/strict';import {PGlite} from '@electric-sql/pglite';import {readFile} from 'node:fs/promises';
import {listStoredDashboards,openStoredDashboard,saveStoredDashboard} from './dashboard-store.ts';import type {Sql} from './db.ts';
test('definitions persist; private, role-changed, stale and non-owner access is rejected',async()=>{
 const db=new PGlite();const sql={query:async(text:string,params:unknown[]) => (await db.query(text,params)).rows} as Sql;
 const owner={userId:'owner',role:'admin' as const},reader={userId:'reader',role:'finance' as const},engineer={userId:'engineer',role:'engineering' as const};
 const definition={version:1 as const,title:'Finance records',metric:'activity' as const,chart:'bar' as const,agents:['finance'],from:'2026-10-01',to:'2026-10-15'};
 try{
  await db.exec(await readFile(new URL('../../migrations/0194_conversational_bi.sql',import.meta.url),'utf8'));
  const first=await saveStoredDashboard(sql,owner,{id:null,revision:0,visibility:'private',definition});
  assert.equal((await openStoredDashboard(sql,owner,first.id)).definition.title,definition.title);
  await assert.rejects(()=>openStoredDashboard(sql,reader,first.id),/access denied/);
  const shared=await saveStoredDashboard(sql,owner,{...first,visibility:'authorized',definition});
  assert.equal(shared.revision,2);assert.equal((await listStoredDashboards(sql,reader)).length,1);
  assert.equal((await listStoredDashboards(sql,engineer)).length,0);
  await assert.rejects(()=>openStoredDashboard(sql,engineer,first.id),/permissions/);
  await assert.rejects(()=>saveStoredDashboard(sql,reader,{...shared,visibility:'private',definition}),/conflict/);
  await assert.rejects(()=>saveStoredDashboard(sql,owner,{...first,visibility:'private',definition}),/conflict/);
 }finally{await db.close();}
});
