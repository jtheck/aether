// Official adventure campaign. Forge exports this file; the lobby lists its
// live chapters. Episodes with nothing switched on never appear.

import { readCampaignPack, writeCampaignPack } from '../app/gardenSession.js';
import {
  flattenCampaignChapters,
  formatPackRef,
  isCampaignBundle,
} from '../story/campaignPack.js';

import { ADVENTURE_CAMPAIGN_URL } from '../houseMaps.js';

export { ADVENTURE_CAMPAIGN_URL };

/** @type {{ id: string, name: string, episode: string, garden: string }[]} */
let chapters = [];

export function adventureChapters() {
  return chapters;
}

/** Replace the lobby list from a campaign bundle. Off chapters are omitted. */
export function installAdventureCampaign(bundle) {
  if (!isCampaignBundle(bundle)) {
    chapters = [];
    return chapters;
  }
  const flat = flattenCampaignChapters(bundle);
  chapters = flat.map((ch) => ({
    id: formatPackRef(ch.file),
    name: ch.name || ch.file,
    episode: ch.episode || '',
    garden: formatPackRef(ch.file),
  }));
  return chapters;
}

/**
 * Fetch the shipped campaign, install its live chapters, and keep the pack
 * so play and chapter-to-chapter continuation read the same file.
 * Online, the fetch wins and replaces the stored pack. The service worker
 * caches that response, so the same fetch succeeds offline. If it still
 * fails, the last stored pack is what plays.
 * @param {{
 *   fetchCampaign?: () => Promise<string>,
 *   readPack?: () => Promise<string | null>,
 *   writePack?: (text: string) => Promise<void>,
 * }} [opts]
 */
export async function loadAdventureCampaign(opts = {}) {
  const fetchCampaign = opts.fetchCampaign || (async () => {
    const res = await fetch(ADVENTURE_CAMPAIGN_URL);
    if (!res.ok) throw new Error(`campaign ${res.status}`);
    return res.text();
  });
  const readPack = opts.readPack || readCampaignPack;
  let text;
  try {
    text = await fetchCampaign();
  } catch (err) {
    text = await readPack();
    if (!text) throw err;
  }
  const bundle = JSON.parse(text);
  const list = installAdventureCampaign(bundle);
  if (!list.length) throw new Error('campaign has no live chapters');
  if (opts.writePack) await opts.writePack(text);
  else await writeCampaignPack(text);
  return list;
}
