import assert from "node:assert/strict";
import test from "node:test";
import { createRequestMemoizer } from "./request-memo.server.ts";

test("request memoizer executes one resolver per request/key and isolates requests", async () => {
  const memo = createRequestMemoizer<number>();
  const requestA = new Request("https://example.test/a");
  const requestB = new Request("https://example.test/b");
  let calls = 0;

  const resolve = async () => {
    calls += 1;
    return calls;
  };

  const [a1, a2] = await Promise.all([
    memo(requestA, "role:user-1", resolve),
    memo(requestA, "role:user-1", resolve),
  ]);
  const b1 = await memo(requestB, "role:user-1", resolve);

  assert.equal(a1, 1);
  assert.equal(a2, 1);
  assert.equal(b1, 2);
  assert.equal(calls, 2);
});

test("request memoizer evicts rejected work so a later retry can recover", async () => {
  const memo = createRequestMemoizer<number>();
  const request = new Request("https://example.test/a");
  let calls = 0;

  await assert.rejects(
    memo(request, "session", async () => {
      calls += 1;
      throw new Error("temporary");
    }),
  );

  const value = await memo(request, "session", async () => {
    calls += 1;
    return 7;
  });

  assert.equal(value, 7);
  assert.equal(calls, 2);
});
