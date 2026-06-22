// Match ID persistence — quick reconnect after refresh / brief disconnect.

const STORAGE_KEY = 'aether-koth-match-v2';
const SESSION_STORAGE_KEY = 'aether-koth-tab-match-v2';
export const REJOIN_TTL_MS = 120_000;

/** @typedef {{ matchId: string, savedAt: number, slot?: number, userId?: string }} SavedMatch */

export function generateMatchId() {
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 10);
  return `koth-${t}-${r}`;
}

/** @returns {SavedMatch | null} */
export function loadSavedMatch(now = Date.now()) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const tabRaw = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw && !tabRaw) return null;
    const sharedRaw = raw ? JSON.parse(raw) : {};
    const shared = { matchId: sharedRaw.matchId, savedAt: sharedRaw.savedAt };
    const tab = tabRaw ? JSON.parse(tabRaw) : {};
    const data = { ...shared, ...tab };
    if (!data?.matchId || !data.savedAt) return null;
    if (now - data.savedAt > REJOIN_TTL_MS) {
      localStorage.removeItem(STORAGE_KEY);
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

/** @param {Partial<SavedMatch> & { matchId: string }} patch */
export function saveMatch(patch, now = Date.now()) {
  const prev = loadSavedMatch(now) ?? {};
  const next = { ...prev, ...patch, savedAt: now };
  if (Object.prototype.hasOwnProperty.call(patch, 'slot') && patch.slot == null) delete next.slot;
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ matchId: next.matchId, savedAt: next.savedAt }),
    );
    sessionStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({
        matchId: next.matchId,
        savedAt: next.savedAt,
        slot: next.slot,
        userId: next.userId,
      }),
    );
  } catch {
    /* quota / private mode */
  }
  return next;
}

export function clearSavedMatch() {
  try {
    localStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function touchSavedMatch(now = Date.now()) {
  const saved = loadSavedMatch(now);
  if (!saved) return null;
  return saveMatch(saved, now);
}
