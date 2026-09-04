// Adventure chapter handoff — every seated player must vote before anyone resets.

export const CHAPTER_FLUSH_MS = 500;

export function chapterVotesReady(votes, humanPlayers) {
  const need = [...new Set((humanPlayers || []).map((id) => id | 0))];
  if (!need.length) return false;
  const have = votes instanceof Map ? votes : new Map(Object.entries(votes || {}));
  for (const id of need) {
    if (!have.has(id)) return false;
  }
  return true;
}

/** Lowest seat id wins so every peer applies the same party / bank. */
export function pickCanonicalChapter(votes) {
  const have = votes instanceof Map ? votes : new Map();
  const ids = [...have.keys()].map((id) => id | 0).sort((a, b) => a - b);
  return ids.length ? have.get(ids[0]) ?? have.get(String(ids[0])) : null;
}
