/**
 * Campaign runtime that lives in the bootGame closures.
 * World reset does not clear this — callers must wipe it when leaving adventure.
 */

/** @param {{ mode?: string } | null | undefined} cfg */
export function liveConfigKeepsAdventure(cfg) {
  return cfg?.mode === 'adventure';
}

/**
 * Drop objective tick, chapter votes, and party carry so another mode cannot
 * keep EXIT rings or load the next chapter.
 * @param {object} rt
 */
export function resetAdventureRuntime(rt) {
  if (rt.chapterFlushTimer) {
    clearTimeout(rt.chapterFlushTimer);
    rt.chapterFlushTimer = null;
  }
  rt.story = null;
  rt.objectives = [];
  rt.carriedParty = null;
  rt.carriedBank = null;
  rt.chapterWon = false;
  rt.chapterAdvanceBusy = false;
  rt.pendingChapterUrl = null;
  rt.objectivesArmedAt = 0;
  rt.chapterVotes?.clear?.();
  rt.chapterVoteUrl = '';
  rt.chapterProposeSent = false;
  return rt;
}
