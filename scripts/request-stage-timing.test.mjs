import test from "node:test";
import assert from "node:assert/strict";
import { timeStage, traceRequest } from "../src/lib/request-timing.server.ts";

test("parallel requests keep independent trace IDs and never log private inputs", async () => {
  const logs = [];
  const original = console.log;
  console.log = (line) => logs.push(JSON.parse(line));
  try {
    await Promise.all(["a", "b"].map((id) => traceRequest(new Request(`https://example.com/private/${id}?secret=hidden`, {
      headers: { cookie: "secret-cookie", authorization: "Bearer secret-token", "cf-ray": "a49ae5a399f4f5f0-AMS" },
    }), () => timeStage("session.verify", async () => { await Promise.resolve(); return id; }))));
  } finally { console.log = original; }
  assert.equal(new Set(logs.map((log) => log.traceId)).size, 2);
  for (const traceId of new Set(logs.map((log) => log.traceId))) {
    const events = logs.filter((log) => log.traceId === traceId);
    assert.deepEqual(events.map((log) => log.sequence), [1, 2, 3, 4]);
    assert.deepEqual(events.map((log) => log.state), ["start", "start", "end", "end"]);
  }
  assert.doesNotMatch(JSON.stringify(logs), /secret|hidden|private|Bearer|cookie/);
});

test("failures log only a stage category and propagate the original error", async () => {
  const logs = [];
  const original = console.log;
  const error = new Error("private SQL and credentials");
  console.log = (line) => logs.push(JSON.parse(line));
  try {
    await assert.rejects(traceRequest(new Request("https://example.com"), () => timeStage("db.query", async () => { throw error; })), (caught) => caught === error);
  } finally { console.log = original; }
  assert.equal(logs.filter((log) => log.state === "error").length, 2);
  assert.doesNotMatch(JSON.stringify(logs), /private|credentials|SQL/);
});
