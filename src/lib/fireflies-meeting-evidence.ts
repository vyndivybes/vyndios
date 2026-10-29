import type { VibpeKnowledgeEvidence } from "./vibpe-external-knowledge";

type FirefliesContent = { type: "text"; text: string };
type FirefliesReadback = {
  source: string;
  endpoint: string;
  operation: string;
  advisoryOnly: boolean;
  trustedInstructions: boolean;
  accountId: string;
  observedAt: string;
  content: FirefliesContent[];
};
type EvidenceAuthority = {
  tenantId: string;
  actorId: string;
  accountId: string;
  authorised: boolean;
  approvedEvidenceReference: string;
};
const ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,179}$/;
function fail(code: string): never { throw new Error(code); }

/**
 * Maps an independently authorized VAOS Fireflies summary readback into VIBPE's
 * external-reference class. Not a public route, credential broker or H5 writer.
 * Only a reviewed server-side H5 integration may call this after verifying actor
 * identity, tenant isolation, approved evidence contract and provider readback.
 */
export function toFirefliesExternalEvidence(
  readback: FirefliesReadback,
  authority: EvidenceAuthority,
  meetingId: string,
): VibpeKnowledgeEvidence {
  if (typeof meetingId !== "string" || !ID.test(meetingId) ||
      !authority || typeof authority.tenantId !== "string" || !ID.test(authority.tenantId) ||
      typeof authority.actorId !== "string" || !ID.test(authority.actorId) ||
      authority.authorised !== true ||
      authority.approvedEvidenceReference !== `fireflies:${meetingId}`) {
    return fail("FIREFLIES_EVIDENCE_AUTH_REQUIRED");
  }
  if (readback?.accountId !== authority.accountId || !authority.accountId ||
      typeof authority.accountId !== "string" || !ID.test(authority.accountId)) {
    return fail("FIREFLIES_EVIDENCE_ACCOUNT_MISMATCH");
  }
  if (readback?.source !== "fireflies" ||
      readback?.endpoint !== "https://api.fireflies.ai/mcp" ||
      readback?.operation !== "getSummary" ||
      readback?.advisoryOnly !== true ||
      readback?.trustedInstructions !== false ||
      !Array.isArray(readback?.content) || readback.content.length < 1 ||
      readback.content.length > 5 ||
      !Number.isFinite(Date.parse(readback.observedAt))) {
    return fail("FIREFLIES_EVIDENCE_INVALID");
  }
  const first = readback.content[0];
  if (first?.type !== "text" || typeof first.text !== "string" || first.text.length > 10000) {
    return fail("FIREFLIES_EVIDENCE_INVALID");
  }
  let parsed: unknown;
  try { parsed = JSON.parse(first.text); }
  catch { return fail("FIREFLIES_EVIDENCE_INVALID"); }
  const overview = (parsed && typeof parsed === "object" && !Array.isArray(parsed))
    ? (parsed as Record<string, unknown>).overview : undefined;
  if (typeof overview !== "string" || overview.trim() !== overview ||
      overview.length < 1 || overview.length > 600 ||
      /[<>\x00-\x08\x0b\x0c\x0e-\x1f]/.test(overview)) {
    return fail("FIREFLIES_EVIDENCE_INVALID");
  }
  return {
    class: "external-reference",
    source: "fireflies-mcp",
    observedAt: new Date(readback.observedAt).toISOString(),
    citation: `fireflies:${meetingId}`,
    value: {
      actionAuthorized: false,
      meetingId,
      rawTranscriptIncluded: false,
      summary: overview,
    },
  };
}
