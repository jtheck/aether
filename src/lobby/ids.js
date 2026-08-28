// Lobby identity — GetFire userId only. Never peerId, never display name.

/** Exact match only. Suffix / endsWith matching is how two peers collapse into one. */
export function sameUserId(a, b) {
  if (a == null || b == null) return false;
  return String(a) === String(b);
}

/** Sender of a lobby payload. Prefer stamped `userId`; ignore signaling `from` if both disagree. */
export function senderUserId(msg) {
  if (!msg || typeof msg !== 'object') return null;
  const id = msg.userId;
  if (id == null || id === '') return null;
  return String(id);
}

/** @param {string | null | undefined} id */
export function shortUserId(id) {
  const s = String(id ?? '');
  if (!s) return '?';
  return s.length <= 6 ? s : s.slice(-6);
}
