export const VAOS_BRIDGE_PUBLIC_JWK = Object.freeze({
  kty: "EC",
  crv: "P-256",
  x: ["DFaCAfAg","d13wLoSM","Y36epFb8","rD5UzI0q","Ti0dwnQZ","_t0"].join(""),
  y: ["OK9F-36O","hVA2dwga","wJFolk5V","AgCJ2IjO","SR3LrgdQ","_Ls"].join(""),
  key_ops: ["verify"],
  ext: true,
});

export const VAOS_BRIDGE_KEY_ID = "vyndi-primary-p256-v1";
export const VAOS_BRIDGE_MAX_SKEW_SECONDS = 300;
export const VAOS_BRIDGE_PROTOCOL_VERSION = "vaos-vyndi-bridge.v2";
export const VAOS_BRIDGE_SERVICE_IDENTITY = "vaos";
export const VAOS_BRIDGE_AUDIENCE = "vyndi-os";
export const VAOS_BRIDGE_METHOD = "POST";
export const VAOS_BRIDGE_PATH = "/api/vaos/bridge";

export function validateVaosBridgeSignedContext(input: {
  payload: Record<string, unknown>;
  requestMethod: string;
  requestPath: string;
  expectedPurpose: "read-observe" | "write-execute" | "write-qualify";
}) {
  const payload = input.payload ?? {};
  if (payload.protocolVersion !== VAOS_BRIDGE_PROTOCOL_VERSION) {
    return { ok: false as const, error: "protocol_version_mismatch" };
  }
  if (payload.serviceIdentity !== VAOS_BRIDGE_SERVICE_IDENTITY) {
    return { ok: false as const, error: "service_identity_mismatch" };
  }
  if (payload.audience !== VAOS_BRIDGE_AUDIENCE) {
    return { ok: false as const, error: "audience_mismatch" };
  }
  if (payload.method !== VAOS_BRIDGE_METHOD) {
    return { ok: false as const, error: "method_binding_mismatch" };
  }
  if (String(input.requestMethod || "").toUpperCase() !== payload.method) {
    return { ok: false as const, error: "request_method_mismatch" };
  }
  if (payload.path !== VAOS_BRIDGE_PATH) {
    return { ok: false as const, error: "path_binding_mismatch" };
  }
  if (input.requestPath !== payload.path) {
    return { ok: false as const, error: "request_path_mismatch" };
  }
  if (payload.purpose !== input.expectedPurpose) {
    return { ok: false as const, error: "purpose_mismatch" };
  }
  if (typeof payload.actionType !== "string" || !payload.actionType.trim()) {
    return { ok: false as const, error: "action_type_missing" };
  }
  if (typeof payload.intentId !== "string" || !payload.intentId.trim()) {
    return { ok: false as const, error: "intent_id_missing" };
  }
  if (typeof payload.executionJobId !== "string" || !payload.executionJobId.trim()) {
    return { ok: false as const, error: "execution_job_id_missing" };
  }
  if (typeof payload.employeeId !== "string" || !payload.employeeId.trim()) {
    return { ok: false as const, error: "employee_id_missing" };
  }
  if (typeof payload.missionId !== "string" || !payload.missionId.trim()) {
    return { ok: false as const, error: "mission_id_missing" };
  }
  if (input.expectedPurpose === "read-observe") {
    if (payload.approvalId !== null) {
      return { ok: false as const, error: "read_approval_forbidden" };
    }
  } else if (typeof payload.approvalId !== "string" || !payload.approvalId.trim()) {
    return { ok: false as const, error: "write_approval_required" };
  }

  if (
    input.expectedPurpose === "write-qualify"
    && payload.qualificationProfile !== "COMMERCIAL_WRITE_CANARY_V1"
  ) {
    return { ok: false as const, error: "write_qualification_profile_invalid" };
  }
  if (
    input.expectedPurpose === "write-execute"
    && payload.operationalWriteProfile !== "PEOPLE_DRAFT_MASTER_V1"
  ) {
    return { ok: false as const, error: "operational_write_profile_invalid" };
  }
  return { ok: true as const };
}

function base64urlBytes(value: string): ArrayBuffer {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (value) => value.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(value: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

export function canonicalVaosBridgeSignatureInput(input: {
  timestamp: string;
  nonce: string;
  bodySha256: string;
}) {
  return `${input.timestamp}\n${input.nonce}\n${input.bodySha256}`;
}

export async function verifyVaosBridgeSignature(input: {
  timestamp: string;
  nonce: string;
  bodySha256: string;
  signature: string;
  keyId: string;
  now?: Date;
}) {
  if (input.keyId !== VAOS_BRIDGE_KEY_ID) return { ok: false as const, error: "unknown_key_id" };
  if (!/^\d{10,13}$/.test(input.timestamp)) return { ok: false as const, error: "invalid_timestamp" };
  if (!/^[A-Za-z0-9_-]{16,160}$/.test(input.nonce)) return { ok: false as const, error: "invalid_nonce" };
  if (!/^[0-9a-f]{64}$/i.test(input.bodySha256)) return { ok: false as const, error: "invalid_body_hash" };
  if (!/^[A-Za-z0-9_-]{40,200}$/.test(input.signature)) return { ok: false as const, error: "invalid_signature_encoding" };

  const timestampMs = Number(input.timestamp.length === 10 ? Number(input.timestamp) * 1000 : Number(input.timestamp));
  if (!Number.isFinite(timestampMs)) return { ok: false as const, error: "invalid_timestamp" };
  const current = (input.now ?? new Date()).getTime();
  if (Math.abs(current - timestampMs) > VAOS_BRIDGE_MAX_SKEW_SECONDS * 1000) {
    return { ok: false as const, error: "timestamp_out_of_window" };
  }

  const key = await crypto.subtle.importKey(
    "jwk",
    VAOS_BRIDGE_PUBLIC_JWK,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );

  const canonical = canonicalVaosBridgeSignatureInput({
    timestamp: input.timestamp,
    nonce: input.nonce,
    bodySha256: input.bodySha256.toLowerCase(),
  });

  const verified = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    base64urlBytes(input.signature),
    new TextEncoder().encode(canonical),
  );

  return verified ? { ok: true as const } : { ok: false as const, error: "signature_invalid" };
}
