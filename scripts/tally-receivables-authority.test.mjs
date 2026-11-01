import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { z } from "zod";
test("receivable read/mutation authority checks route scope and independent-approval permission before SQL",async()=>{
 const source=await readFile(new URL("../src/lib/shipment-authority.ts",import.meta.url),"utf8");
 const code=ts.transpileModule(source.replace(/^import .*;\r?$/gm,""),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
 let allowed=false;let opened=0;const permissions=[];const exports={};
 const chain={validator:()=>chain,handler:fn=>fn};
 new Function("exports","createServerFn","z","getSql","requireBusinessActor","getCommandRole","canPerform","getRouteMeta","postDispatch","reverseDispatch",code)(
  exports,()=>chain,z,async()=>{opened++;return{query:async()=>[]};},async permission=>{permissions.push(permission);return{userId:"test",role:"finance"};},async()=>"finance",
  (_role,_permission,meta)=>{assert.equal(meta.route,"/command/receivables");return allowed;},route=>({route}),()=>{},()=>{});
 await assert.rejects(()=>exports.listShipmentRevenueLedger(),/permission denied/);
 await assert.rejects(()=>exports.postCollection({data:{id:"C",invoiceId:"I",planMonth:1,amountLakh:1,sourceReference:"EVID"}}),/permission denied/);
 await assert.rejects(()=>exports.reverseCollection({data:{id:"C",reason:"test"}}),/permission denied/);
 await assert.rejects(()=>exports.voidInvoice({data:{id:"I",reason:"test"}}),/permission denied/);
 assert.deepEqual(permissions,["edit","approve","approve"]);assert.equal(opened,0);
 allowed=true;await exports.reverseCollection({data:{id:"C",reason:"test"}});assert.equal(opened,1);
});
