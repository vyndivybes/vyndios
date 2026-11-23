import assert from "node:assert/strict";
import test from "node:test";
import { withSessionDeadline, SessionVerificationTimeoutError } from "../src/lib/auth/session-deadline.ts";

test("a stalled lookup rejects with a service error and never supplies a user",async()=>{
  let calls=0;
  await assert.rejects(()=>withSessionDeadline(()=>{calls++;return new Promise(()=>{});},10),
    e=>e instanceof SessionVerificationTimeoutError && e.status===503 && e.code==="SESSION_VERIFICATION_TIMEOUT");
  assert.equal(calls,1);
});
test("a verified result or authentication rejection is preserved unchanged",async()=>{
  const user={id:"verified-test-user"};
  assert.equal(await withSessionDeadline(async()=>user,100),user);
  const rejected=new Error("invalid session");
  await assert.rejects(()=>withSessionDeadline(async()=>{throw rejected;},100),e=>e===rejected);
});
test("late identity cannot turn a timed-out request into an authenticated result",async()=>{
  let finish; const underlying=new Promise(resolve=>{finish=resolve;});
  const result=withSessionDeadline(()=>underlying,10);
  await assert.rejects(()=>result,SessionVerificationTimeoutError);
  finish({id:"late-user"});
  await assert.rejects(()=>result,SessionVerificationTimeoutError);
});
test("synchronous errors remain fail-closed; invalid budgets never start work",async()=>{
  const error=new Error("lookup failed");
  await assert.rejects(()=>withSessionDeadline(()=>{throw error;},100),e=>e===error);
  let calls=0;
  await assert.rejects(()=>withSessionDeadline(async()=>{calls++;},0),RangeError);
  assert.equal(calls,0);
});
