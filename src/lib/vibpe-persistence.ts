import type { Sql } from "@/lib/db";
import type { VibpeSessionState } from "@/lib/vibpe-session";
import type { VibpeAnswerReceipt } from "@/lib/vibpe-reasoning-core";

function json<T>(value: unknown): T | undefined {
  if (value == null) return undefined;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return undefined;
    }
  }
  if (typeof value === "object") return value as T;
  return undefined;
}

export async function loadPersistedVibpeSession(
  sql: Sql,
  ownerKey: string,
  sessionKey: string,
): Promise<VibpeSessionState | undefined> {
  const rows = await sql.query<{ state_json: unknown }>(
    `select state_json
       from vyndi_vibpe_decision_sessions
      where owner_key=$1 and session_key=$2
      limit 1`,
    [ownerKey, sessionKey],
  );
  return json<VibpeSessionState>(rows[0]?.state_json);
}

export async function persistVibpeSession(
  sql: Sql,
  ownerKey: string,
  sessionKey: string,
  state: VibpeSessionState,
): Promise<void> {
  await sql.query(
    `insert into vyndi_vibpe_decision_sessions
       (owner_key,session_key,state_json,updated_at)
     values ($1,$2,$3::jsonb,now())
     on conflict (owner_key,session_key) do update
       set state_json=excluded.state_json,
           updated_at=excluded.updated_at`,
    [ownerKey, sessionKey, JSON.stringify(state)],
  );
}

export async function persistVibpeAnswerReceipt(
  sql: Sql,
  ownerKey: string,
  sessionKey: string,
  receipt: VibpeAnswerReceipt,
): Promise<void> {
  await sql.query(
    `insert into vyndi_vibpe_answer_receipts
       (answer_id,owner_key,session_key,intent,data_mode,receipt_json,created_at)
     values ($1,$2,$3,$4,$5,$6::jsonb,$7::timestamptz)
     on conflict (answer_id) do nothing`,
    [
      receipt.answerId,
      ownerKey,
      sessionKey,
      receipt.intent,
      receipt.dataMode,
      JSON.stringify(receipt),
      receipt.createdAt,
    ],
  );
}

export async function recordVibpeAnswerQualityEvent(
  sql: Sql,
  input: {
    answerId: string;
    eventType: "accepted" | "corrected" | "rejected" | "outcome";
    predictedConfidence?: number;
    observedCorrect?: boolean;
    details?: Record<string, unknown>;
  },
): Promise<void> {
  await sql.query(
    `insert into vyndi_vibpe_answer_quality_events
       (answer_id,event_type,predicted_confidence,observed_correct,details_json,created_at)
     values ($1,$2,$3,$4,$5::jsonb,now())`,
    [
      input.answerId,
      input.eventType,
      input.predictedConfidence ?? null,
      input.observedCorrect ?? null,
      JSON.stringify(input.details ?? {}),
    ],
  );
}
