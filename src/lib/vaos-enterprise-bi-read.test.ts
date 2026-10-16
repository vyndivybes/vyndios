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

test("release decisions, people lifecycles and business values retain source semantics",()=>{
 assert.equal(classifyBiSample({decision:"blocked",decided_at:"2026-10-10T00:00:00Z"}).status,"blocked");
 assert.equal(classifyBiSample({lifecycle_status:"approved",operational_status:"active"}).status,"active");
 const row=classifyBiSample({id:"SO",units:0,asp_lakh:2.5,notes:"private"});
 assert.equal(row.fields.units,0);
 assert.equal(row.fields.asp_lakh,2.5);
 assert.equal(row.fields.notes,undefined);
});

test("impossible dates and inherited object names are rejected",()=>{
 for(const input of [{employeeId:"toString",from:"2026-10-01",to:"2026-10-15"},
  {employeeId:"all",from:"2026-02-30",to:"2026-03-01"}])assert.throws(()=>validateBiScope(input));
});
test("BI counts use entire scoped source, not the page size; one query per ledger",async()=>{
 const calls:{query:string;params:unknown[]}[]=[];
 const fake={query:async(query:string,params:unknown[])=>{
  if(query.includes("with latest_close"))return [];
  calls.push({query,params});
  return [{summary:[{status:"OPEN",quantity:113,current:113,undated:0,training:2,unknown:113},
   {status:"COMPLETED",quantity:44,current:44,undated:0,training:0,unknown:44}],
   records:[{id:"A",status:"OPEN",updated_at:"2026-10-12T00:00:00Z"}]}];
 }};
 const result=await readEnterpriseBi(fake as never,{employeeId:"production",from:"2026-10-01",to:"2026-10-15",limit:1});
 const first=result.departments[0];
 assert.equal(first.status,"OBSERVED");
 if(first.status!=="OBSERVED")throw Error();
 assert.equal(first.periodEventCount,157);
 assert.equal(first.records.length,1);
 assert.equal(first.detailPage.hasMore,true);
 assert.equal(calls.length,2);
 assert.deepEqual(calls[0].params.slice(0,4),["2026-10-01","2026-10-15",1,0]);
 assert.equal(first.currentSourceCount,157);
 assert.equal(first.currentAttentionCount,113);
 assert.equal(first.excludedTrainingCount,2);
 assert.equal(first.sources.length,2);
 assert.equal(first.query.sql,calls[0].query);
 assert.deepEqual(first.query.parameters,calls[0].params);
 assert.ok(calls.every(x=>x.query.includes('not training')));
});

test('dashboard refresh uses one primary query, with a bounded CRM exception',async()=>{
 const calls:string[]=[];
 const sql={query:async(q:string)=>{calls.push(q);return [{summary:[],records:[]}];}};
 await readEnterpriseBi(sql as never,{employeeId:'finance',from:'2026-10-01',to:'2026-10-15',limit:5},{primaryOnly:true});
 assert.equal(calls.length,1);assert.match(calls[0],/epr_finance_journals/);
 calls.length=0;
 const packet=await readEnterpriseBi(sql as never,{employeeId:'commercial',from:'2026-10-01',to:'2026-10-15',limit:5},{primaryOnly:true,crm:true});
 assert.equal(calls.length,2);assert.equal(packet.departments[0].sources[1].sourceTable,'vyndi_crm_activities');
});

test("undated pending cases remain visible in current backlog when no period event occurred",async()=>{
 const source={query:async()=>[{summary:[{status:"OPEN",quantity:0,current:10,undated:10,training:0,unknown:10}],records:[]}]};
 const r=await readEnterpriseBi(source as never,{employeeId:"risk",from:"2026-10-01",to:"2026-10-15"});
 const x=r.departments[0];
 assert.equal(x.status,"OBSERVED");
 if(x.status!=="OBSERVED")throw Error();
 assert.equal(x.periodEventCount,0);
 assert.equal(x.currentSourceCount,10);
 assert.equal(x.currentAttentionCount,10);
 assert.equal(x.undatedCount,10);
});

test("missing authoritative schema is unavailable, never zero",async()=>{
 const fake={query:async()=>{throw new Error("missing source")}};
 const result=await readEnterpriseBi(fake as never,{employeeId:"security",from:"2026-10-01",to:"2026-10-15"});
 assert.equal(result.departments[0].status,"UNAVAILABLE");
 assert.equal("periodEventCount" in result.departments[0],false);
});


test("specialist source scope cannot escape its employee's governed sources",()=>{
 assert.equal(validateBiScope({employeeId:'qa',sourceTable:'vyndi_quality_capas',from:'2026-10-01',to:'2026-10-15'}).sourceTable,'vyndi_quality_capas');
 for(const employeeId of ['all','commercial'])assert.throws(()=>validateBiScope({employeeId,sourceTable:'vyndi_quality_capas',from:'2026-10-01',to:'2026-10-15'}),/BI_SOURCE/);
});
