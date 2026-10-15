// Forge's in-memory campaign: episodes of the maps you've added.
// Export and Workshop publish turn this into a campaign bundle.

import {
  bundleCampaign,
  campaignIndex,
  normalizeCampaignIndex,
} from '../story/campaignPack.js';

function safeFile(name, used) {
  let base = String(name || 'chapter').replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '') || 'chapter';
  if (/^\d/.test(base)) base = `ch_${base}`;
  let file = `${base}.garden`;
  let n = 2;
  while (used.has(file)) {
    file = `${base}_${n}.garden`;
    n += 1;
  }
  used.add(file);
  return file;
}

export function createCampaignDraft(name = 'Campaign') {
  return {
    name,
    episodeIndex: 0,
    episodes: [{ name: 'Episode 1', theme: '', chapters: [] }],
  };
}

export function currentEpisode(draft) {
  if (!draft?.episodes?.length) return null;
  const i = Math.max(0, Math.min(draft.episodes.length - 1, draft.episodeIndex | 0));
  return draft.episodes[i];
}

export function renameCampaign(draft, name) {
  draft.name = String(name || '').trim() || 'Campaign';
}

export function renameCurrentEpisode(draft, name) {
  const ep = currentEpisode(draft);
  if (ep) ep.name = String(name || '').trim() || 'Episode';
}

export function renameEpisode(draft, index, name) {
  const ep = draft?.episodes?.[index];
  if (ep) ep.name = String(name || '').trim() || `Episode ${index + 1}`;
}

export function setCurrentEpisode(draft, index) {
  if (!draft?.episodes?.length) return;
  draft.episodeIndex = Math.max(0, Math.min(draft.episodes.length - 1, index | 0));
}

export function removeEpisode(draft, index) {
  const eps = draft?.episodes;
  if (!eps || eps.length <= 1 || index < 0 || index >= eps.length) return false;
  eps.splice(index, 1);
  draft.episodeIndex = Math.max(0, Math.min(eps.length - 1, draft.episodeIndex > index ? draft.episodeIndex - 1 : draft.episodeIndex));
  return true;
}

export function moveEpisode(draft, index, dir) {
  const eps = draft?.episodes;
  const j = index + dir;
  if (!eps || index < 0 || index >= eps.length || j < 0 || j >= eps.length) return false;
  const current = eps[draft.episodeIndex];
  [eps[index], eps[j]] = [eps[j], eps[index]];
  draft.episodeIndex = eps.indexOf(current);
  return true;
}

/** Find a chapter by file, returning its episode/chapter indices. */
export function locateChapter(draft, file) {
  const eps = draft?.episodes || [];
  for (let e = 0; e < eps.length; e += 1) {
    const c = eps[e].chapters.findIndex((ch) => ch.file === file);
    if (c >= 0) return { epIndex: e, chIndex: c, episode: eps[e], chapter: eps[e].chapters[c] };
  }
  return null;
}

export function renameChapter(draft, file, name) {
  const loc = locateChapter(draft, file);
  if (!loc) return false;
  loc.chapter.name = String(name || '').trim() || loc.chapter.name;
  return true;
}

/** Move a chapter up (dir -1) or down (dir +1); crosses into the neighbouring episode at an edge. */
export function moveChapter(draft, file, dir) {
  const loc = locateChapter(draft, file);
  if (!loc) return false;
  const eps = draft.episodes;
  const { epIndex, chIndex } = loc;
  const chapters = eps[epIndex].chapters;
  if (dir < 0) {
    if (chIndex > 0) {
      [chapters[chIndex - 1], chapters[chIndex]] = [chapters[chIndex], chapters[chIndex - 1]];
    } else if (epIndex > 0) {
      eps[epIndex - 1].chapters.push(chapters.splice(chIndex, 1)[0]);
    } else return false;
  } else if (chIndex < chapters.length - 1) {
    [chapters[chIndex + 1], chapters[chIndex]] = [chapters[chIndex], chapters[chIndex + 1]];
  } else if (epIndex < eps.length - 1) {
    eps[epIndex + 1].chapters.unshift(chapters.splice(chIndex, 1)[0]);
  } else return false;
  return true;
}

export function addEpisode(draft, name) {
  draft.episodes.push({ name: String(name || '').trim() || `Episode ${draft.episodes.length + 1}`, theme: '', chapters: [] });
  draft.episodeIndex = draft.episodes.length - 1;
  return currentEpisode(draft);
}

/** Remember this map as the next chapter of the open episode. */
export function addChapter(draft, { name, garden }) {
  const ep = currentEpisode(draft);
  if (!ep || !garden || typeof garden !== 'object') return null;
  const used = new Set();
  for (const episode of draft.episodes || []) {
    for (const ch of episode.chapters || []) used.add(ch.file);
  }
  const title = String(name || garden.n || '').trim() || 'Chapter';
  const file = safeFile(title, used);
  const chapter = { file, name: title, garden, live: true };
  ep.chapters.push(chapter);
  return chapter;
}

/** Players skip a chapter while `live` is false. The map stays in the file. */
export function setChapterLive(draft, file, live) {
  const loc = locateChapter(draft, file);
  if (!loc) return false;
  loc.chapter.live = live !== false;
  return true;
}

export function removeChapter(draft, file) {
  for (const ep of draft.episodes || []) {
    const i = ep.chapters.findIndex((ch) => ch.file === file);
    if (i >= 0) {
      ep.chapters.splice(i, 1);
      return true;
    }
  }
  return false;
}

/** Refresh a chapter that was saved under this name after further edits. */
export function syncChapterGarden(draft, name, garden) {
  const title = String(name || '').trim();
  if (!title || !garden) return false;
  let hit = false;
  for (const ep of draft.episodes || []) {
    for (const ch of ep.chapters) {
      if (ch.name === title) {
        ch.garden = garden;
        hit = true;
      }
    }
  }
  return hit;
}

export function draftToIndex(draft, { liveOnly = false } = {}) {
  return campaignIndex(draft?.name || 'Campaign', (draft?.episodes || []).map((ep) => ({
    name: ep.name,
    theme: ep.theme || '',
    chapters: (ep.chapters || [])
      .filter((ch) => !liveOnly || ch.live !== false)
      .map((ch) => {
        const row = { file: ch.file, name: ch.name };
        if (ch.live === false) row.live = false;
        return row;
      }),
  })));
}

export function draftToBundle(draft) {
  const gardens = {};
  for (const ep of draft?.episodes || []) {
    for (const ch of ep.chapters || []) gardens[ch.file] = ch.garden;
  }
  return bundleCampaign(draftToIndex(draft), gardens);
}

export function draftFromBundle(bundle) {
  const index = normalizeCampaignIndex(bundle);
  if (!index || !bundle?.gardens) return null;
  const draft = {
    name: index.name,
    episodeIndex: 0,
    episodes: index.episodes.map((ep) => ({
      name: ep.name,
      theme: ep.theme || '',
      chapters: ep.chapters.map((ch) => ({
        file: ch.file,
        name: ch.name,
        live: ch.live !== false,
        garden: bundle.gardens[ch.file],
      })),
    })),
  };
  return draft.episodes.some((ep) => ep.chapters.length) ? draft : null;
}

export function draftChapterCount(draft) {
  let n = 0;
  for (const ep of draft?.episodes || []) n += ep.chapters?.length || 0;
  return n;
}
