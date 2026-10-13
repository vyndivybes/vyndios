import test from "node:test";
import assert from "node:assert/strict";
import { timeStage, traceRequest } from "../src/lib/request-timing.server.ts";

test("parallel requests keep independent trace IDs and never log private inputs", async () => {
  const logs = [];
  const original = console.info;
  console.info = (line) => logs.push(JSON.parse(line));
  try {
    await Promise.all(["a", "b"].map((id) => traceRequest(new Request(`https://example.com/private/${id}?secret=hidden`, {
      headers: { cookie: "secret-cookie", authorization: "Bearer secret-token", "cf-ray": "a49ae5a399f4f5f0-AMS" },
    }), () => timeStage("session.verify", async () => { await Promise.resolve(); return id; }), { emitSuccessful: true })));
  } finally { console.info = original; }
  assert.equal(new Set(logs.map((log) => log.traceId)).size, 2);
  for (const traceId of new Set(logs.map((log) => log.traceId))) {
    const events = logs.find((log) => log.traceId === traceId).events;
    assert.deepEqual(events.map((log) => log.sequence), [1, 2, 3, 4]);
    assert.deepEqual(events.map((log) => log.state), ["start", "start", "end", "end"]);
  }
  assert.doesNotMatch(JSON.stringify(logs), /secret|hidden|private|Bearer|cookie/);
});

test("failures log only a stage category and propagate the original error", async () => {
  const logs = [];
  const original = console.info;
  const error = new Error("private SQL and credentials");
  console.info = (line) => logs.push(JSON.parse(line));
  try {
    await assert.rejects(traceRequest(new Request("https://example.com"), () => timeStage("db.query", async () => { throw error; })), (caught) => caught === error);
  } finally { console.info = original; }
  assert.equal(logs.flatMap((log) => log.events).filter((log) => log.state === "error").length, 2);
  assert.doesNotMatch(JSON.stringify(logs), /private|credentials|SQL/);
});

test("routine requests emit no stage logs and successful detailed capture is bounded", async () => {
  const logs = [];
  const original = console.info;
  console.info = (line) => logs.push(JSON.parse(line));
  try {
    await traceRequest(new Request("https://example.com"), () => timeStage("db.query", async () => 1));
    assert.equal(logs.length, 0, "routine requests must not serialize or log each stage");
    await traceRequest(new Request("https://example.com"), async () => {
      for (let i = 0; i < 200; i++) await timeStage("db.query", async () => 1);
    }, { emitSuccessful: true });
    assert.equal(logs.length, 1);
    assert.equal(logs[0].events.length, 128);
    assert.equal(logs[0].truncated, true);
    assert.equal(logs[0].last.sequence, 402);
  } finally { console.info = original; }
});

test("slow requests expose their pending stage before completion or cancellation", async () => {
  const logs = [];
  const original = console.info;
  console.info = (line) => logs.push(JSON.parse(line));
  let finish;
  try {
    const pending = traceRequest(new Request("https://example.com"), () => timeStage("schema.ready", () =>
      new Promise((resolve) => { finish = resolve; })), { slowAfterMs: 1 });
    await new Promise((resolve) => setTimeout(resolve, 15));
    assert.equal(logs[0].reason, "slow");
    assert.equal(logs[0].last.stage, "schema.ready");
    assert.equal(logs[0].last.state, "start");
    finish();
    await pending;
    assert.equal(logs.at(-1).reason, "complete");
  } finally { console.info = original; }
});
