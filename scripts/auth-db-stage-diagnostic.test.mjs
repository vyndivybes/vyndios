import assert from "node:assert/strict";
import test from "node:test";
import { reportAuthDriverFailure } from "../src/lib/auth/db-stage-diagnostic.ts";

test("auth connection errors expose only allowlisted stage, category and safe code", () => {
  const calls = [];
  const original = console.error;
  console.error = (...args) => calls.push(args);
  try {
    const error = Object.assign(new Error("connection terminated: password=TOPSECRET; postgres://user:secret@db/abc"), { code: "ECONNRESET" });
    reportAuthDriverFailure("connect", error);
  } finally { console.error = original; }
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "[auth] postgres stage failure");
  assert.deepEqual(calls[0][1], { stage: "connect", category: "database-connection", code: "ECONNRESET", causeDepth: 0 });
  assert.doesNotMatch(JSON.stringify(calls), /TOPSECRET|postgres:\/\/|user:secret|password=/);
});

test("driver error logging rejects arbitrary stages and never prints unknown error details", () => {
  const calls = [];
  const original = console.error;
  console.error = (...args) => calls.push(args);
  try { reportAuthDriverFailure("sql=select secret from session", new Error("password=unprintable")); }
  finally { console.error = original; }
  assert.deepEqual(calls[0][1], { stage: "unknown", category: "unknown", code: null, causeDepth: 0 });
  assert.doesNotMatch(JSON.stringify(calls), /password=|unprintable|select secret/);
});
