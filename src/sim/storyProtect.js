// Party invincibility while a story reel is playing.
// Seat 0 is the adventure table; same-team owners (the four heroes, trained
// leftovers, allied waves) skip incoming damage. Hostiles still fight each other.

import { isAlly } from './teams.js';

/** Adventure / story party seats share this team id. */
export const STORY_PROTECT_OWNER = 0;

export function gardenHasStartCinematic(garden) {
  const reels = garden?.story?.reels;
  if (!Array.isArray(reels)) return false;
  for (let i = 0; i < reels.length; i++) {
    const r = reels[i];
    if (!r || r.when === 'win') continue;
    if (r.clips?.length && Number(r.duration) > 0) return true;
  }
  return false;
}

export function armStoryProtectFromGarden(w, garden) {
  w.storyProtect = gardenHasStartCinematic(garden) ? 1 : 0;
}

export function setStoryProtect(w, on) {
  w.storyProtect = on ? 1 : 0;
}

/** Party / allied-to-seat-0 units while a cinematic is armed. */
export function storyProtectsOwner(w, owner) {
  return !!(w?.storyProtect && isAlly(owner, STORY_PROTECT_OWNER));
}
