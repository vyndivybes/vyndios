import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalVaosBridgeSignatureInput,
  verifyVaosBridgeSignature,
  VAOS_BRIDGE_KEY_ID,
} from "./vaos-bridge-auth.ts";

const qualifiedSignature = Buffer.from([
  60,111,95,114,167,76,96,81,175,237,244,1,146,181,4,215,
  103,133,90,30,227,179,47,121,18,227,172,34,72,86,244,179,
  200,172,110,125,41,162,194,145,124,88,125,237,8,154,214,40,
  18,202,249,3,106,255,181,180,113,176,11,229,208,255,204,5,
]).toString("base64url");

test("canonical VAOS bridge signature input is stable", () => {
  assert.equal(
    canonicalVaosBridgeSignatureInput({
      timestamp: "1760000000000",
      nonce: "nonce-test-1234567890",
      bodySha256: "a".repeat(64),
    }),
    `1760000000000\nnonce-test-1234567890\n${"a".repeat(64)}`,
  );
});

test("qualified P-256 signature verifies and rejects tampering", async () => {
  const base = {
    timestamp: "1760000000000",
    nonce: "nonce-test-1234567890",
    bodySha256: "a".repeat(64),
    signature: qualifiedSignature,
    keyId: VAOS_BRIDGE_KEY_ID,
    now: new Date(1760000000000),
  };
  assert.deepEqual(await verifyVaosBridgeSignature(base), { ok: true });
  assert.equal(
    (await verifyVaosBridgeSignature({ ...base, bodySha256: "b".repeat(64) })).ok,
    false,
  );
});

test("stale signed requests fail before bridge execution", async () => {
  const result = await verifyVaosBridgeSignature({
    timestamp: "1760000000000",
    nonce: "nonce-test-1234567890",
    bodySha256: "a".repeat(64),
    signature: qualifiedSignature,
    keyId: VAOS_BRIDGE_KEY_ID,
    now: new Date(1760001000000),
  });
  assert.deepEqual(result, { ok: false, error: "timestamp_out_of_window" });
});
