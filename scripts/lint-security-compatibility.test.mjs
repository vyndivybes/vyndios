import test from "node:test";
import assert from "node:assert/strict";
import {ESLint} from "eslint";
test("patched minimatch preserves lint config matching, rules and TypeScript parsing",async()=>{
 const rules=new ESLint({overrideConfigFile:true,overrideConfig:[{files:["**/*.mjs"],rules:{"no-debugger":"error"}}]});
 const [bad]=await rules.lintText("debugger;",{filePath:"security-probe.mjs"});
 assert.ok(bad.messages.some(m=>m.ruleId==="no-debugger"));
 const [good]=await rules.lintText("const x = 1;",{filePath:"security-probe.mjs"});
 assert.equal(good.errorCount,0);
 const repo=new ESLint();
 for(const filePath of ["src/lib/security-probe.ts","src/routes/security-probe.tsx"]){
  assert.ok(await repo.calculateConfigForFile(filePath));
  const [result]=await repo.lintText("export const auditProbe: number = 1;\n",{filePath});
  assert.ok(!result.messages.some(m=>m.fatal));
 }
});
