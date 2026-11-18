import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { classifyAuthFailure } from "../src/lib/auth/safe-error-diagnostic.ts";

test("Cross-request Worker I/O errors are classified without leaking connection secrets", () => {
  const error = new Error("Cannot perform I/O on behalf of a different request. postgresql://account:secret@db.example");
  const classification = classifyAuthFailure(error);
  assert.equal(classification.category, "worker-request-io");
  assert.equal(classification.code, null);
  assert.doesNotMatch(JSON.stringify(classification), /secret|postgresql|db\.example|account/);
});

test("Nested database failures preserve only allowlisted stable error codes", () => {
  const inner = Object.assign(new Error("database credential password=confidential"), { code: "ECONNRESET" });
  const error = new Error("session failed", { cause: inner });
  const result = classifyAuthFailure(error);
  assert.equal(result.category, "database-connection");
  assert.equal(result.code, "ECONNRESET");
  assert.equal(result.causeDepth, 1);
  assert.doesNotMatch(JSON.stringify(result), /password|confidential|session failed/);
});

test("Unknown exception content never becomes a log field", () => {
  const error = Object.assign(new Error("private-text-should-not-escape"), { code: "private-invalid-code", userToken: "ultra-secret" });
  const result = classifyAuthFailure(error);
  assert.equal(result.category, "unknown");
  assert.equal(result.code, null);
  assert.doesNotMatch(JSON.stringify(result), /private|token|secret/);
});

test("Better Auth diagnostic logger never prints the raw Better Auth message or error arguments", async () => {
  const source = await readFile(new URL("../src/lib/auth/server.ts", import.meta.url), "utf8");
  assert.match(source, /logger:\s*\{/);
  assert.match(source, /classifyAuthFailure\(/);
  assert.match(source, /requestTransportSource/);
  assert.doesNotMatch(source, /console\.error\([^\n]*\.\.\.args/);
});
