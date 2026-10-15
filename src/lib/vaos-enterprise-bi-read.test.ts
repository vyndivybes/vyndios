import test from "node:test";
import assert from "node:assert/strict";
import {validateBiScope,classifyBiSample,readEnterpriseBi,VYNDI_BI_DEPARTMENTS} from "./vaos-enterprise-bi-read.ts";
test("all 16 departmental ledgers are explicitly mapped",()=>{
 assert.equal(Object.keys(VYNDI_BI_DEPARTMENTS).length,16);
 assert.equal(new Set(Object.values(VYNDI_BI_DEPARTMENTS).map(x=>x.table)).size,16);
});
test("scope is bounded and never interpolates untrusted source identifiers",()=>{
 assert.equal(validateBiScope({employeeId:"finance",from:"2026-10-01",to:"2026-10-15"}).employeeId,"finance");
 for(const x of [{employeeId:"finance; drop table x",from:"2026-10-01",to:"2026-10-15"},
 {employeeId:"all",from:"2024-01-01",to:"2026-10-15"},
 {employeeId:"all",from:"2026-10-10",to:"2026-10-15",limit:101},
 {employeeId:"all",from:"2026-10-10",to:"2026-10-15",offset:-1},
 {employeeId:"all",from:"2026-10-20",to:"2026-10-21"}])
 assert.throws(()=>validateBiScope(x),/INVALID_BI_SCOPE/);
});
test("source field projection never leaks free-text PII or secrets",()=>{
 const item=classifyBiSample({id:"REV-1",status:"OPEN",updated_at:"2026-10-12T12:00:00Z",
  email:"private@example.com",salary:999,notes:"secret",token:"x"});
 assert.equal(item.date,"2026-10-12");
 assert.equal(item.status,"OPEN");
 assert.deepEqual(Object.keys(item.fields).sort(),["id","status","updated_at"]);
});
test("BI counts use entire scoped source, not the page size",async()=>{
 const calls:{query:string;params:unknown[]}[]=[];
 const fake={query:async(query:string,params:unknown[])=>{
  calls.push({query,params});
  if(query.includes("group by 1"))return [{status:"OPEN",quantity:"113"},{status:"COMPLETED",quantity:"44"}];
  return [{rec:{id:"A",status:"OPEN",updated_at:"2026-10-12T00:00:00Z"}}];
 }};
 const result=await readEnterpriseBi(fake as never,{employeeId:"production",from:"2026-10-01",to:"2026-10-15",limit:1});
 const first=result.departments[0] as {status:string;periodEventCount:number;flaggedStatusCount:number;currentSourceCount:number;currentAttentionCount:number;detailPage:{hasMore:boolean};records:unknown[]};
 assert.equal(first.status,"OBSERVED");
 assert.equal(first.periodEventCount,157);
 assert.equal(first.flaggedStatusCount,113);
 assert.equal(first.records.length,1);
 assert.equal(first.detailPage.hasMore,true);
 assert.equal(calls.length,3);
 assert.ok(calls.every(x=>x.query.includes("epr_production_job_cards")));
 assert.deepEqual(calls[0].params,["2026-10-01","2026-10-15"]);
 assert.equal(first.currentSourceCount,157);
 assert.equal(first.currentAttentionCount,113);
});
test("undated pending cases remain visible in current backlog when no period event occurred",async()=>{
 const source={query:async(query:string)=>{
  if(query.includes("group by 1")&&!query.includes(" where "))return [{status:"OPEN",quantity:"10"}];
  return [];
 }};
 const r=await readEnterpriseBi(source as never,{employeeId:"risk",from:"2026-10-01",to:"2026-10-15"});
 const x=r.departments[0] as {status:string;periodEventCount:number;currentSourceCount:number;currentAttentionCount:number};
 assert.equal(x.status,"OBSERVED");
 assert.equal(x.periodEventCount,0);
 assert.equal(x.currentSourceCount,10);
 assert.equal(x.currentAttentionCount,10);
});
test("missing authoritative schema is unavailable, never zero",async()=>{
 const fake={query:async()=>{throw new Error("missing source")}};
 const result=await readEnterpriseBi(fake as never,{employeeId:"security",from:"2026-10-01",to:"2026-10-15"});
 assert.equal(result.departments[0].status,"UNAVAILABLE");
 assert.equal("periodEventCount" in result.departments[0],false);
});
