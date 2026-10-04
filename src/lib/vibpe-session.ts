import type { Sql } from "@/lib/db";
import type { IbpeScenarioRequest } from "@/lib/ibpe-scenario-lab";
import { loadPersistedVibpeSession, persistVibpeSession } from "@/lib/vibpe-persistence";

export type VibpeSessionState = {
  governedRunId?: string;
  selectedUiScenarioKey?: string;
  activeScenario?: IbpeScenarioRequest;
  previousScenario?: IbpeScenarioRequest;
  planningHorizonMonths?: number;
  referencedProducts: string[];
  assumptions?: string[];
  contradictionKeys?: string[];
  lastAnswerId?: string;
  lastIntent?: string;
  lastQuestion?: string;
};

const sessions = new Map<string, VibpeSessionState>();

export function getVibpeSession(sessionKey: string): VibpeSessionState {
  return sessions.get(sessionKey) ?? { referencedProducts: [] };
}

export function updateVibpeSession(sessionKey: string, patch: Partial<VibpeSessionState>) {
  const current = getVibpeSession(sessionKey);
  const next = { ...current, ...patch };
  sessions.set(sessionKey, next);
  return next;
}

export async function hydrateVibpeSession(
  sql: Sql,
  ownerKey: string,
  sessionKey: string,
): Promise<VibpeSessionState> {
  const persisted = await loadPersistedVibpeSession(sql, ownerKey, sessionKey);
  if (persisted) {
    const normalized: VibpeSessionState = {
      ...persisted,
      referencedProducts: persisted.referencedProducts ?? [],
    };
    sessions.set(JSON.stringify([ownerKey, sessionKey]), normalized);
    return normalized;
  }
  sessions.delete(JSON.stringify([ownerKey, sessionKey]));
  return { referencedProducts: [] };
}

export async function updatePersistedVibpeSession(
  sql: Sql,
  ownerKey: string,
  sessionKey: string,
  patch: Partial<VibpeSessionState>,
): Promise<VibpeSessionState> {
  const key = JSON.stringify([ownerKey, sessionKey]);
  const next = { ...getVibpeSession(key), ...patch };
  await persistVibpeSession(sql, ownerKey, sessionKey, next);
  sessions.set(key, next);
  return next;
}

export function clearVibpeSession(sessionKey: string) {
  sessions.delete(sessionKey);
}

// The owner-scoped in-memory map is a warm-process cache; hydration always reads durable state. Durable advisory decision
// context is persisted separately and remains non-transactional. Approved plans,
// releases, finance postings and procurement commitments stay in owning services.

