// Forge's in-memory campaign: episodes of the maps you've added.
// Export and Workshop publish turn this into a campaign bundle.

import {
  bundleCampaign,
  campaignIndex,
  flattenCampaignChapters,
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

export function addEpisode(draft, name) {
  draft.episodes.push({ name: String(name || '').trim() || `Episode ${draft.episodes.length + 1}`, theme: '', chapters: [] });
  draft.episodeIndex = draft.episodes.length - 1;
  return currentEpisode(draft);
}

/** Remember this map as the next chapter of the open episode. */
export function addChapter(draft, { name, garden }) {
  const ep = currentEpisode(draft);
  if (!ep || !garden || typeof garden !== 'object') return null;
  const used = new Set(flattenCampaignChapters(draftToIndex(draft)).map((ch) => ch.file));
  const title = String(name || garden.n || '').trim() || 'Chapter';
  const file = safeFile(title, used);
  const chapter = { file, name: title, garden };
  ep.chapters.push(chapter);
  return chapter;
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

export function draftToIndex(draft) {
  return campaignIndex(draft?.name || 'Campaign', (draft?.episodes || []).map((ep) => ({
    name: ep.name,
    theme: ep.theme || '',
    chapters: (ep.chapters || []).map((ch) => ({ file: ch.file, name: ch.name })),
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
        garden: bundle.gardens[ch.file],
      })),
    })),
  };
  return draft.episodes.some((ep) => ep.chapters.length) ? draft : null;
}

export function draftChapterCount(draft) {
  return flattenCampaignChapters(draftToIndex(draft)).length;
}
