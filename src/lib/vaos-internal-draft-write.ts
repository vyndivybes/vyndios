/**
 * The only commissioned VAOS write intent for the pre-operational VYNDI OS.
 * Scope is genuine persisted INTERNAL_DRAFT data, never operational ERP effects.
 * Cryptographic service identity and replay protection are enforced by the route.
 */
export const VAOS_INTERNAL_DRAFT_ACTION = 'STARTUP.PERSIST_INTERNAL_DRAFT';
export const VAOS_INTERNAL_DRAFT_APPROVAL = 'founder:internal-startup-writes:20261123';

const CATEGORIES = new Set([
  'SIMULATION_CLASSIFICATION_REGISTER',
  'ENGINEERING_EVIDENCE_REGISTER',
  'CASH_RUNWAY_REVIEW',
  'FOUNDER_INTERNAL_ACTION_PLAN',
  'PURCHASE_REQUEST_DRAFT',
  'SUPPLIER_OUTREACH_DRAFT',
]);

const held = new Set(['PURCHASE_REQUEST_DRAFT', 'SUPPLIER_OUTREACH_DRAFT']);
const safe = (v: unknown, max: number, min = 1) =>
  typeof v === 'string' && v.trim().length >= min &&
  v.length <= max && !/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(v);
const exact = (keys: string[], expected: string[]) =>
  keys.length === expected.length && expected.every(k => keys.includes(k));

export function validateInternalDraftWrite(payload: Record<string, unknown>) {
  const input = payload.input;
  if (!input || typeof input !== 'object' || Array.isArray(input))
    return {ok: false as const, error: 'internal_draft_invalid_input'};
  const v = input as Record<string, unknown>;
  if (!exact(Object.keys(v), [
    'recordId', 'category', 'title', 'content', 'classification', 'state',
  ]) ||
      payload.purpose !== 'write-execute' ||
      payload.actionType !== VAOS_INTERNAL_DRAFT_ACTION ||
      payload.employeeId !== 'orchestrator' ||
      payload.approvalId !== VAOS_INTERNAL_DRAFT_APPROVAL ||
      !safe(payload.executionJobId, 160) ||
      !safe(payload.intentId, 160) ||
      !safe(payload.missionId, 160) ||
      !safe(payload.idempotencyKey, 160, 8) ||
      !/^[A-Za-z0-9:_-]+$/.test(String(payload.idempotencyKey || '')) ||
      !/^VAOS-DRAFT-[A-Za-z0-9_-]{5,110}$/.test(String(v.recordId || '')) ||
      !CATEGORIES.has(String(v.category || '')) ||
      !safe(v.title, 160) ||
      !safe(v.content, 8000, 8) ||
      v.classification !== 'INTERNAL_DRAFT' ||
      v.state !== (held.has(String(v.category)) ? 'AWAITING_FOUNDER_APPROVAL' : 'DRAFT_PREPARED')
  ) return {ok: false as const, error: 'internal_draft_scope_denied'};
  return {
    ok: true as const,
    value: Object.freeze({
      recordId: String(v.recordId),
      category: String(v.category),
      title: String(v.title).trim(),
      content: String(v.content),
      classification: 'INTERNAL_DRAFT' as const,
      state: v.state as 'DRAFT_PREPARED' | 'AWAITING_FOUNDER_APPROVAL',
      approvalId: VAOS_INTERNAL_DRAFT_APPROVAL,
      executionJobId: String(payload.executionJobId),
      intentId: String(payload.intentId),
      missionId: String(payload.missionId),
      idempotencyKey: String(payload.idempotencyKey),
    }),
  };
}
