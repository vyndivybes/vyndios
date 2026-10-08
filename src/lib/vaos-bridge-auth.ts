const PUBLIC_JWK = Object.freeze({
  kty: "EC",
  crv: "P-256",
  x: "EPPCpFNPK2tsOkPD-X9GrG2Uc5c2rzyPx5Kl79wmllE",
  y: "jPWjZtC_IuNPJ_0Uc12iV7__fjGGexTl-xY_1K8dUtA",
  key_ops: ["verify"],
  ext: true,
});

export const VAOS_BRIDGE_KEY_ID = "vyndi-primary-p256-v1";
export const VAOS_BRIDGE_MAX_SKEW_SECONDS = 300;

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
    PUBLIC_JWK,
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
