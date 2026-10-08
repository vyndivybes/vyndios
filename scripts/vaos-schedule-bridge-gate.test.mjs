import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("signed VAOS schedule route requires the existing ECDSA signature, canonical context and anti-replay",async()=>{
 const path=new URL("../src/routes/api/vaos/bridge.ts",import.meta.url);
 const src=await readFile(path,"utf8");
 assert.match(src,/PROJECT\.OBSERVE_SCHEDULE/);
 assert.match(src,/verifyVaosBridgeSignature/);
 assert.match(src,/validateVaosBridgeSignedContext/);
 assert.match(src,/expectedPurpose:\s*"read-observe"/);
 assert.match(src,/claim_vyndi_vaos_bridge_nonce/);
 assert.match(src,/sourceAuthority: SOURCE_AUTHORITY\[actionType\]/);
 assert.match(src,/validateScheduleProjectInput\(input\)/);
 assert.match(src,/where t\.program_id=\$1/);
 assert.match(src,/limit \$2/);
 assert.match(src,/normalizeVaosScheduleExport/);
 assert.doesNotMatch(src,/update\s+vyndi_program_tasks|insert\s+into\s+vyndi_program_tasks/);
});
