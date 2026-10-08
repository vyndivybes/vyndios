import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalVaosBridgeSignatureInput,
  verifyVaosBridgeSignature,
  VAOS_BRIDGE_KEY_ID,
  VAOS_BRIDGE_PUBLIC_JWK,
} from "./vaos-bridge-auth.ts";

const previousQualifiedSignature = Buffer.from([
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

test("VAOS bridge verifier is pinned to the user-generated production public key", () => {
  assert.deepEqual(VAOS_BRIDGE_PUBLIC_JWK, {
    kty: "EC",
    crv: "P-256",
    x: "DFaCAfAgd13wLoSMY36epFb8rD5UzI0qTi0dwnQZ_t0",
    y: "OK9F-36OhVA2dwgawJFolk5VAgCJ2IjOSR3LrgdQ_Ls",
    key_ops: ["verify"],
    ext: true,
  });
});

test("the previously qualified key can no longer authenticate after rotation", async () => {
  const result = await verifyVaosBridgeSignature({
    timestamp: "1760000000000",
    nonce: "nonce-test-1234567890",
    bodySha256: "a".repeat(64),
    signature: previousQualifiedSignature,
    keyId: VAOS_BRIDGE_KEY_ID,
    now: new Date(1760000000000),
  });
  assert.deepEqual(result, { ok: false, error: "signature_invalid" });
});

test("stale signed requests fail before bridge execution", async () => {
  const result = await verifyVaosBridgeSignature({
    timestamp: "1760000000000",
    nonce: "nonce-test-1234567890",
    bodySha256: "a".repeat(64),
    signature: previousQualifiedSignature,
    keyId: VAOS_BRIDGE_KEY_ID,
    now: new Date(1760001000000),
  });
  assert.deepEqual(result, { ok: false, error: "timestamp_out_of_window" });
});

test("signed bridge context validator binds protocol, route and execution identity", () => {
  const payload = {
    protocolVersion: "vaos-vyndi-bridge.v2",
    serviceIdentity: "vaos",
    audience: "vyndi-os",
    method: "POST",
    path: "/api/vaos/bridge",
    purpose: "read-observe",
    actionType: "INVENTORY.OBSERVE_STOCK",
    employeeId: "inventory",
    intentId: "intent-v2-1",
    executionJobId: "job-v2-1",
    approvalId: null,
    missionId: "mission-v2-1",
    input: { limit: 1 },
  };

  assert.deepEqual(
    validateVaosBridgeSignedContext({
      payload,
      requestMethod: "POST",
      requestPath: "/api/vaos/bridge",
      expectedPurpose: "read-observe",
    }),
    { ok: true },
  );

  const cases = [
    [{ ...payload, protocolVersion: "vaos-vyndi-bridge.v1" }, "protocol_version_mismatch"],
    [{ ...payload, serviceIdentity: "other-service" }, "service_identity_mismatch"],
    [{ ...payload, audience: "other-audience" }, "audience_mismatch"],
    [{ ...payload, method: "GET" }, "method_binding_mismatch"],
    [{ ...payload, path: "/api/other" }, "path_binding_mismatch"],
    [{ ...payload, purpose: "write-execute" }, "purpose_mismatch"],
    [{ ...payload, actionType: "" }, "action_type_missing"],
    [{ ...payload, intentId: "" }, "intent_id_missing"],
    [{ ...payload, executionJobId: "" }, "execution_job_id_missing"],
    [{ ...payload, approvalId: "APP-READ" }, "read_approval_forbidden"],
  ];

  for (const [candidate, error] of cases) {
    assert.deepEqual(
      validateVaosBridgeSignedContext({
        payload: candidate,
        requestMethod: "POST",
        requestPath: "/api/vaos/bridge",
        expectedPurpose: "read-observe",
      }),
      { ok: false, error },
    );
  }

  assert.deepEqual(
    validateVaosBridgeSignedContext({
      payload,
      requestMethod: "GET",
      requestPath: "/api/vaos/bridge",
      expectedPurpose: "read-observe",
    }),
    { ok: false, error: "request_method_mismatch" },
  );

  assert.deepEqual(
    validateVaosBridgeSignedContext({
      payload,
      requestMethod: "POST",
      requestPath: "/api/vaos/other",
      expectedPurpose: "read-observe",
    }),
    { ok: false, error: "request_path_mismatch" },
  );
});

